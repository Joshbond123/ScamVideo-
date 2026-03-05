import axios from 'axios';
import fs from 'fs-extra';
import path from 'path';
import { uploadLocalAssetToSupabase } from './supabaseStorage';

type SubtitleEvent = { text: string; start: number; end: number };

type RenderRequest = {
  jobId: string;
  audioPath: string;
  imagePaths: string[];
  subtitleEvents: SubtitleEvent[];
  voiceoverMeta: { voiceId: string; timingSource: string; durationSec: number };
};

type TriggerResult = {
  workflowIdOrFile: string;
  workflowPathHint?: string;
  dispatchMode: 'workflow_dispatch' | 'repository_dispatch';
};

type WorkflowWaitResult = {
  runId: number;
  htmlUrl: string;
};

function requireEnv(name: string) {
  const value = (process.env[name] || '').trim();
  if (!value) throw new Error(`Missing required env ${name}`);
  return value;
}

function getConfig() {
  const repo = (process.env.GITHUB_RENDER_REPO || process.env.RENDER_REPO || '').trim() || requireEnv('GITHUB_RENDER_REPO');
  const token = (process.env.GITHUB_RENDER_PAT || process.env.GITHUB_PAT || process.env.RENDER_GITHUB_PAT || '').trim() || requireEnv('GITHUB_PAT');
  const workflow = (process.env.GITHUB_RENDER_WORKFLOW || 'render-dispatch.yml').trim();
  const ref = (process.env.GITHUB_RENDER_REF || 'main').trim();
  const bucket = (process.env.SUPABASE_MEDIA_BUCKET || 'temp-media').trim();
  const supabaseUrl = requireEnv('SUPABASE_URL');
  const supabaseServiceRole = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
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

async function triggerWorkflow(jobId: string, inputs: Record<string, string>): Promise<TriggerResult> {
  const { token, repo, workflow, ref } = getConfig();
  const client = ghClient(token);

  const dispatchViaWorkflow = async (workflowIdOrFile: string) => {
    await client.post(`/repos/${repo}/actions/workflows/${encodeURIComponent(workflowIdOrFile)}/dispatches`, {
      ref,
      inputs: {
        ...inputs,
        job_id: jobId,
      },
    });
  };

  try {
    await dispatchViaWorkflow(workflow);
    return { workflowIdOrFile: workflow, workflowPathHint: workflow, dispatchMode: 'workflow_dispatch' };
  } catch (error: any) {
    const status = error?.response?.status;
    const message = String(error?.response?.data?.message || error?.message || '');

    if (status === 422 && message.toLowerCase().includes('workflow_dispatch')) {
      console.warn(`[render:${jobId}] Workflow ${workflow} is not dispatchable via workflow_dispatch, probing active workflows for fallback`);
      const workflowsRes = await client.get(`/repos/${repo}/actions/workflows`);
      const workflows = Array.isArray(workflowsRes.data?.workflows) ? workflowsRes.data.workflows : [];
      const fallback = workflows.find((wf: any) => {
        const wfPath = String(wf?.path || '').toLowerCase();
        const name = String(wf?.name || '').toLowerCase();
        const state = String(wf?.state || '').toLowerCase();
        return state === 'active' && (wfPath.endsWith('/render-dispatch.yml') || name.includes('gstreamer-render'));
      });

      if (fallback?.id) {
        await dispatchViaWorkflow(String(fallback.id));
        console.info(`[render:${jobId}] fallback_workflow_dispatch id=${fallback.id} path=${fallback.path}`);
        return {
          workflowIdOrFile: String(fallback.id),
          workflowPathHint: String(fallback.path || ''),
          dispatchMode: 'workflow_dispatch',
        };
      }
    }

    if (status === 422 && message.toLowerCase().includes('workflow_dispatch')) {
      console.warn(`[render:${jobId}] GitHub returned 422 on workflow dispatch; trying repository_dispatch fallback`);
      await client.post(`/repos/${repo}/dispatches`, {
        event_type: 'render_video',
        client_payload: {
          ...inputs,
          job_id: jobId,
          ref,
        },
      });
      return { workflowIdOrFile: workflow, workflowPathHint: workflow, dispatchMode: 'repository_dispatch' };
    }

    throw error;
  }
}

async function fetchRunDiagnostics(runId: number) {
  const { token, repo } = getConfig();
  const client = ghClient(token);

  const jobsResponse = await client.get(`/repos/${repo}/actions/runs/${runId}/jobs`, { params: { per_page: 100 } });
  const jobs = Array.isArray(jobsResponse.data?.jobs) ? jobsResponse.data.jobs : [];

  const failedJobs = jobs.filter((job: any) => String(job?.conclusion || '') === 'failure');
  const failedSteps = jobs.flatMap((job: any) => {
    const steps = Array.isArray(job?.steps) ? job.steps : [];
    return steps
      .filter((step: any) => String(step?.conclusion || '') === 'failure')
      .map((step: any) => ({
        jobId: Number(job?.id || 0),
        jobName: String(job?.name || 'unknown'),
        stepName: String(step?.name || 'unknown'),
      }));
  });

  const annotations: Array<{ jobId: number; path: string; level: string; message: string }> = [];

  for (const job of failedJobs) {
    const checkRunId = Number(job?.id || 0);
    if (!checkRunId) continue;

    try {
      const annotationResponse = await client.get(`/repos/${repo}/check-runs/${checkRunId}/annotations`, {
        params: { per_page: 20 },
      });
      const anns = Array.isArray(annotationResponse.data) ? annotationResponse.data : [];
      for (const ann of anns) {
        annotations.push({
          jobId: checkRunId,
          path: String(ann?.path || ''),
          level: String(ann?.annotation_level || ''),
          message: String(ann?.message || ''),
        });
      }
    } catch (error: any) {
      console.warn(`[render:run:${runId}] failed_to_fetch_annotations job=${checkRunId} message=${error?.message || error}`);
    }
  }

  return { jobs, failedJobs, failedSteps, annotations };
}

async function waitForWorkflow(jobId: string, startedAt: number, trigger: TriggerResult): Promise<WorkflowWaitResult> {
  const { token, repo, workflow } = getConfig();
  const client = ghClient(token);
  const timeoutMs = 25 * 60_000;
  const pollMs = 10_000;
  const runDetectTimeoutMs = 90_000;

  let runId: number | null = null;
  while (Date.now() - startedAt < timeoutMs) {
    const runs = await client.get(`/repos/${repo}/actions/runs`, { params: { per_page: 50 } });
    const all = Array.isArray(runs.data?.workflow_runs) ? runs.data.workflow_runs : [];

    const candidates = all.filter((r: any) => {
      const title = String(r?.display_title || r?.name || '');
      const created = new Date(r?.created_at || 0).getTime();
      const evt = String(r?.event || '');
      const runPath = String(r?.path || '').toLowerCase();

      const eventMatches = trigger.dispatchMode === 'repository_dispatch'
        ? evt === 'repository_dispatch' || evt === 'workflow_dispatch'
        : evt === 'workflow_dispatch' || evt === 'repository_dispatch';

      const workflowMatches = trigger.workflowPathHint
        ? runPath.includes(String(trigger.workflowPathHint).toLowerCase())
        : runPath.includes(String(workflow).toLowerCase()) || runPath.includes('render');

      return created >= startedAt - 30_000 && title.includes(jobId) && eventMatches && workflowMatches;
    });

    const found = candidates[0];

    if (found) {
      runId = found.id;
      console.info(`[render:${jobId}] github_run_detected id=${found.id} event=${found.event} status=${found.status} conclusion=${found.conclusion || 'n/a'} url=${found.html_url}`);
    } else {
      const elapsed = Date.now() - startedAt;
      console.info(`[render:${jobId}] github_run_waiting elapsedMs=${elapsed} dispatchMode=${trigger.dispatchMode} workflowHint=${trigger.workflowPathHint || trigger.workflowIdOrFile}`);
      if (elapsed > runDetectTimeoutMs) {
        throw new Error(`No GitHub Actions run detected for ${jobId} within ${runDetectTimeoutMs}ms after dispatch. Check repo Actions settings/triggers.`);
      }
    }

    if (found?.status === 'completed') {
      const diagnostics = await fetchRunDiagnostics(found.id);
      const failedJobSummary = diagnostics.failedJobs.map((job: any) => `${job.name}:${job.conclusion}`).join(', ');
      const failedStepSummary = diagnostics.failedSteps.map((s) => `${s.jobName}/${s.stepName}`).join(', ');
      const annotationSummary = diagnostics.annotations.map((a) => `${a.path}:${a.message}`).join(' | ');

      console.info(
        `[render:${jobId}] github_run_terminal id=${found.id} conclusion=${found.conclusion || 'n/a'} runUrl=${found.html_url} jobs_total=${diagnostics.jobs.length} jobs_failed=${diagnostics.failedJobs.length} failed_steps=${diagnostics.failedSteps.length} annotations=${diagnostics.annotations.length}`
      );

      if (found.conclusion !== 'success' || diagnostics.failedJobs.length > 0) {
        throw new Error(
          `GitHub render workflow failed for ${jobId}. runUrl=${found.html_url} conclusion=${found.conclusion || 'n/a'} failedJobs=[${failedJobSummary || 'none'}] failedSteps=[${failedStepSummary || 'none'}] annotations=[${annotationSummary || 'none'}]`
        );
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
  const cfg = getConfig();
  const startedAt = Date.now();
  const outputPath = `jobs/${payload.jobId}/render.mp4`;

  console.info(`[render:${payload.jobId}] render_provider=github_actions_gstreamer workflow=${cfg.workflow} repo=${cfg.repo}`);

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

  const triggerResult = await triggerWorkflow(payload.jobId, inputs);
  console.info(`[render:${payload.jobId}] dispatch_accepted mode=${triggerResult.dispatchMode} workflow=${triggerResult.workflowPathHint || triggerResult.workflowIdOrFile}`);

  const run = await waitForWorkflow(payload.jobId, startedAt, triggerResult);
  const localOutput = path.join(process.cwd(), 'database/assets/videos', `${payload.jobId}.mp4`);
  await downloadOutputFromSupabase(cfg.bucket, outputPath, localOutput, cfg.supabaseServiceRole, cfg.supabaseUrl);

  return {
    localOutput,
    outputPath,
    runUrl: run.htmlUrl,
    renderProvider: 'github_actions_gstreamer',
    tempPaths: [uploadedAudio, ...uploadedImages, outputPath],
  };
}

export async function validateGitHubRenderWorkflow() {
  const { token, repo, workflow } = getConfig();
  const client = ghClient(token);

  const workflowsRes = await client.get(`/repos/${repo}/actions/workflows`);
  const workflows = Array.isArray(workflowsRes.data?.workflows) ? workflowsRes.data.workflows : [];
  const configured = workflows.find((wf: any) => String(wf?.path || '').endsWith(`/${workflow}`) || String(wf?.name || '').trim() === workflow);
  const dispatchableFallback = workflows.find((wf: any) => {
    const path = String(wf?.path || '').toLowerCase();
    const name = String(wf?.name || '').toLowerCase();
    const state = String(wf?.state || '').toLowerCase();
    return state === 'active' && (path.endsWith('/render-dispatch.yml') || name.includes('gstreamer-render'));
  });

  if (!configured && !dispatchableFallback) {
    throw new Error(`No active render workflow found. configured=${workflow}`);
  }

  const target = configured || dispatchableFallback;
  if (String(target?.state || '').toLowerCase() !== 'active') {
    throw new Error(`Render workflow is not active: ${target?.path || target?.name || workflow}`);
  }

  return {
    workflow,
    resolvedWorkflow: String(target?.path || target?.name || workflow),
    id: target?.id,
  };
}
