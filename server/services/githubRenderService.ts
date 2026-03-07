import axios from 'axios';
import fs from 'fs-extra';
import path from 'path';
import { uploadLocalAssetToSupabase } from './supabaseStorage';
import { getKeyValueByTypeAndName } from './supabaseKeyStore';

type SubtitleEvent = { text: string; start: number; end: number };

type RenderRequest = {
  jobId: string;
  audioPath: string;
  imagePaths: string[];
  subtitleEvents: SubtitleEvent[];
  voiceoverMeta: { voiceId: string; timingSource: string; durationSec: number };
};

type WorkflowRef = {
  id: number;
  name: string;
  path: string;
  state: string;
};

type DispatchAttempt = {
  mode: 'workflow_dispatch' | 'repository_dispatch';
  workflowName?: string;
  workflowId?: number;
  ref: string;
};

async function readConfigValue(name: string) {
  const fromEnv = String(process.env[name] || '').trim();
  if (fromEnv) return fromEnv;

  try {
    const fromSupabase = String((await getKeyValueByTypeAndName('config', name)) || '').trim();
    if (fromSupabase) return fromSupabase;
  } catch {
    // Ignore lookup failures and throw a clear error below.
  }

  throw new Error(`Missing required configuration ${name}. Set env or save it in Settings → Infrastructure.`);
}

async function getConfig() {
  const repo = (process.env.GITHUB_RENDER_REPO || process.env.RENDER_REPO || '').trim() || await readConfigValue('GITHUB_RENDER_REPO');
  const token = (process.env.GITHUB_PAT || process.env.RENDER_GITHUB_PAT || '').trim() || await readConfigValue('GITHUB_PAT');
  const workflow = (process.env.GITHUB_RENDER_WORKFLOW || 'render-dispatch.yml').trim();
  const ref = (process.env.GITHUB_RENDER_REF || 'main').trim();
  const bucket = (process.env.SUPABASE_MEDIA_BUCKET || 'temp-media').trim();
  const supabaseUrl = await readConfigValue('SUPABASE_URL');
  const supabaseServiceRole = await readConfigValue('SUPABASE_SERVICE_ROLE_KEY');
  return { repo, token, workflow, ref, bucket, supabaseUrl, supabaseServiceRole };
}

function ghClient(token: string) {
  return axios.create({
    baseURL: 'https://api.github.com',
    timeout: 30_000,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
}

function isRetryableGithubError(error: any) {
  const status = Number(error?.response?.status || 0);
  const code = String(error?.code || '');
  if (status >= 500) return true;
  return ['ECONNRESET', 'ECONNABORTED', 'ETIMEDOUT', 'EAI_AGAIN', 'ERR_NETWORK'].includes(code);
}

async function ghRequestWithRetry<T>(label: string, fn: () => Promise<T>, jobId?: string) {
  const maxAttempts = Number(process.env.GITHUB_API_MAX_ATTEMPTS || 4);
  let lastError: any;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      if (!isRetryableGithubError(error) || attempt === maxAttempts) throw error;
      const backoffMs = attempt * 1500;
      console.warn(`[render:${jobId || 'n/a'}] ${label}_retry attempt=${attempt}/${maxAttempts} backoffMs=${backoffMs} status=${error?.response?.status || 'n/a'} code=${error?.code || 'n/a'}`);
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  throw lastError;
}

async function getRepoMeta(token: string, repo: string) {
  const client = ghClient(token);
  const response = await ghRequestWithRetry('get_repo_meta', () => client.get(`/repos/${repo}`));
  return {
    defaultBranch: String(response.data?.default_branch || 'main'),
  };
}

async function listWorkflows(token: string, repo: string): Promise<WorkflowRef[]> {
  const client = ghClient(token);
  const response = await ghRequestWithRetry('list_workflows', () => client.get(`/repos/${repo}/actions/workflows`, { params: { per_page: 100 } }));
  const rows = Array.isArray(response.data?.workflows) ? response.data.workflows : [];
  return rows.map((w: any) => ({
    id: Number(w?.id || 0),
    name: String(w?.name || ''),
    path: String(w?.path || ''),
    state: String(w?.state || ''),
  }));
}

function pickWorkflow(configuredWorkflow: string, workflows: WorkflowRef[]) {
  const configured = configuredWorkflow.trim().toLowerCase();
  const byConfigured = workflows.find((w) => {
    const fileName = w.path.split('/').pop()?.toLowerCase() || '';
    return fileName === configured || w.path.toLowerCase() === configured || w.name.toLowerCase() === configured;
  });
  if (byConfigured) return byConfigured;

  const preferred = ['render-dispatch.yml', 'moviepy-render.yml', 'video-render-dispatch.yml', 'ffmpeg-render.yml'];
  for (const file of preferred) {
    const found = workflows.find((w) => (w.path.split('/').pop() || '').toLowerCase() === file);
    if (found) return found;
  }

  return null;
}

function buildDispatchCandidates(configuredWorkflow: string, workflows: WorkflowRef[]) {
  const ordered: WorkflowRef[] = [];
  const pushUnique = (w: WorkflowRef | null | undefined) => {
    if (!w) return;
    if (ordered.some((x) => x.id === w.id)) return;
    ordered.push(w);
  };

  pushUnique(pickWorkflow(configuredWorkflow, workflows));

  const preferred = ['render-dispatch.yml', 'moviepy-render.yml', 'video-render-dispatch.yml', 'ffmpeg-render.yml', 'gstreamer-render.yml'];
  for (const file of preferred) {
    pushUnique(workflows.find((w) => (w.path.split('/').pop() || '').toLowerCase() === file));
  }

  return ordered;
}

async function triggerWorkflow(jobId: string, inputs: Record<string, string>): Promise<DispatchAttempt> {
  const { token, repo, workflow, ref } = await getConfig();
  const client = ghClient(token);
  const repoMeta = await getRepoMeta(token, repo);
  const workflows = await listWorkflows(token, repo);
  const candidates = buildDispatchCandidates(workflow, workflows);

  if (!candidates.length) {
    const available = workflows.map((w) => `${w.name}:${w.path}`).join(', ') || 'none';
    throw new Error(
      `No matching GitHub Actions workflow found for configured value "${workflow}" in ${repo}. Available workflows: ${available}.` +
      ` Note: workflow_dispatch/repository_dispatch require workflow files on the default branch (${repoMeta.defaultBranch}).`
    );
  }

  console.info(
    `[render:${jobId}] github_dispatch_prepare repo=${repo} ref=${ref} default_branch=${repoMeta.defaultBranch} configured_workflow=${workflow} candidate_workflows=${candidates.map((c) => `${c.path}:${c.id}:${c.state}`).join(',')}`
  );

  let dispatchError: any = null;
  for (const selectedWorkflow of candidates) {
    if (selectedWorkflow.state !== 'active') continue;
    try {
      await ghRequestWithRetry(
        'dispatch_workflow',
        () =>
          client.post(`/repos/${repo}/actions/workflows/${selectedWorkflow.id}/dispatches`, {
            ref,
            inputs: {
              ...inputs,
              job_id: jobId,
            },
          }),
        jobId
      );
      console.info(`[render:${jobId}] github_dispatch_sent mode=workflow_dispatch workflow_id=${selectedWorkflow.id} workflow_path=${selectedWorkflow.path} ref=${ref}`);
      return {
        mode: 'workflow_dispatch',
        workflowId: selectedWorkflow.id,
        workflowName: selectedWorkflow.path,
        ref,
      };
    } catch (error: any) {
      dispatchError = error;
      const status = Number(error?.response?.status || 0);
      const message = String(error?.response?.data?.message || error?.message || '');
      console.warn(`[render:${jobId}] workflow_dispatch_failed workflow_id=${selectedWorkflow.id} workflow_path=${selectedWorkflow.path} status=${status || 'n/a'} message=${message}`);
      if (status === 422 && message.toLowerCase().includes('workflow_dispatch')) {
        continue;
      }
      if (status === 404) continue;
      throw error;
    }
  }

  try {
    const status = dispatchError?.response?.status;
    const message = String(dispatchError?.response?.data?.message || dispatchError?.message || '');
    console.warn(`[render:${jobId}] GitHub workflow dispatch unavailable (status=${status || 'n/a'} message=${message}); trying repository_dispatch fallback`);
    await ghRequestWithRetry(
      'repository_dispatch',
      () =>
        client.post(`/repos/${repo}/dispatches`, {
          event_type: 'render_video',
          client_payload: {
            ...inputs,
            job_id: jobId,
            ref,
          },
        }),
      jobId
    );
    console.info(`[render:${jobId}] github_dispatch_sent mode=repository_dispatch event_type=render_video ref=${ref}`);
    return {
      mode: 'repository_dispatch',
      workflowName: 'repository_dispatch:render_video',
      ref,
    };
  } catch {
    throw dispatchError || new Error(`Failed to dispatch GitHub render workflow for ${jobId}`);
  }
}

async function waitForWorkflow(jobId: string, startedAt: number, dispatch: DispatchAttempt) {
  const { token, repo } = await getConfig();
  const client = ghClient(token);
  const timeoutMs = 25 * 60_000;
  const pollMs = 10_000;
  const runDetectTimeoutMs = Number(process.env.GITHUB_RENDER_RUN_DETECT_TIMEOUT_MS || 6 * 60_000);

  let runId: number | null = null;
  let lastSeenSummary = 'none';
  while (Date.now() - startedAt < timeoutMs) {
    const endpoint = dispatch.mode === 'repository_dispatch'
      ? `/repos/${repo}/actions/runs`
      : dispatch.workflowId
      ? `/repos/${repo}/actions/workflows/${dispatch.workflowId}/runs`
      : `/repos/${repo}/actions/runs`;
    const runs = await ghRequestWithRetry(
      'list_workflow_runs',
      () => client.get(endpoint, { params: { per_page: 100 } }),
      jobId
    );
    const all = Array.isArray(runs.data?.workflow_runs) ? runs.data.workflow_runs : [];
    lastSeenSummary = all
      .slice(0, 5)
      .map((r: any) => `${r?.id || 'n/a'}:${r?.event || 'n/a'}:${r?.status || 'n/a'}:${r?.display_title || r?.name || ''}`)
      .join(' | ');

    const found = all.find((r: any) => {
      const title = String(r?.display_title || r?.name || '');
      const created = new Date(r?.created_at || 0).getTime();
      const evt = String(r?.event || '');
      return created >= startedAt - 5 * 60_000 && title.includes(jobId) && (evt === 'workflow_dispatch' || evt === 'repository_dispatch');
    });

    if (found) {
      runId = found.id;
      console.info(`[render:${jobId}] github_run_detected id=${found.id} event=${found.event} status=${found.status} conclusion=${found.conclusion || 'n/a'} url=${found.html_url}`);
    } else {
      const elapsed = Date.now() - startedAt;
      console.info(`[render:${jobId}] github_run_waiting elapsedMs=${elapsed} detectTimeoutMs=${runDetectTimeoutMs} mode=${dispatch.mode} workflowId=${dispatch.workflowId || 'n/a'}`);
      if (elapsed > runDetectTimeoutMs) {
        throw new Error(
          `No GitHub Actions run detected for ${jobId} within ${runDetectTimeoutMs}ms after dispatch.` +
          ` mode=${dispatch.mode} workflowId=${dispatch.workflowId || 'n/a'} workflow=${dispatch.workflowName || 'n/a'}.` +
          ` Recent runs=${lastSeenSummary}. Check Actions triggers and ensure workflow exists on default branch.`
        );
      }
    }

    if (found?.status === 'completed') {
      if (found.conclusion !== 'success') {
        throw new Error(`GitHub render workflow failed for ${jobId}. conclusion=${found.conclusion} url=${found.html_url}`);
      }
      return { runId: found.id, htmlUrl: found.html_url };
    }

    await new Promise((r) => setTimeout(r, pollMs));
  }

  throw new Error(`Timed out waiting for GitHub render workflow run for ${jobId}. runId=${runId ?? 'unknown'}`);
}

async function downloadOutputFromSupabase(bucket: string, outputPath: string, localPath: string, serviceRole: string, supabaseUrl: string) {
  const response = await axios.get(`${supabaseUrl}/storage/v1/object/${bucket}/${outputPath}`, {
    responseType: 'arraybuffer',
    headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` },
    timeout: 120_000,
  });
  await fs.ensureDir(path.dirname(localPath));
  await fs.writeFile(localPath, Buffer.from(response.data));
}

export async function renderVideoViaGitHubActions(payload: RenderRequest) {
  const cfg = await getConfig();
  const startedAt = Date.now();
  const outputPath = `jobs/${payload.jobId}/render.mp4`;

  console.info(`[render:${payload.jobId}] render_provider=github_actions_moviepy workflow=${cfg.workflow} repo=${cfg.repo}`);

  const uploadedAudio = await uploadLocalAssetToSupabase(payload.audioPath, `jobs/${payload.jobId}/audio.mp3`, 'audio/mpeg');
  const uploadedImages: string[] = [];
  for (let i = 0; i < payload.imagePaths.length; i++) {
    uploadedImages.push(await uploadLocalAssetToSupabase(payload.imagePaths[i], `jobs/${payload.jobId}/scene_${i}.png`, 'image/png'));
  }

  const inputs = {
    supabase_url: cfg.supabaseUrl,
    supabase_service_role_key: cfg.supabaseServiceRole,
    bucket: cfg.bucket,
    audio_path: uploadedAudio,
    image_paths_json: JSON.stringify(uploadedImages),
    subtitle_events_json: JSON.stringify(payload.subtitleEvents || []),
    output_path: outputPath,
    voice_duration_sec: String(payload.voiceoverMeta?.durationSec || 0),
  };

  const dispatch = await triggerWorkflow(payload.jobId, inputs);
  const run = await waitForWorkflow(payload.jobId, startedAt, dispatch);
  const localOutput = path.join(process.cwd(), 'database/assets/videos', `${payload.jobId}.mp4`);
  await downloadOutputFromSupabase(cfg.bucket, outputPath, localOutput, cfg.supabaseServiceRole, cfg.supabaseUrl);

  return {
    localOutput,
    outputPath,
    runUrl: run.htmlUrl,
    renderProvider: 'github_actions_moviepy',
    tempPaths: [uploadedAudio, ...uploadedImages, outputPath],
  };
}
