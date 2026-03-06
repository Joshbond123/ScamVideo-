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
  const workflow = (process.env.GITHUB_RENDER_WORKFLOW || 'gstreamer-render.yml').trim();
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

async function triggerWorkflow(jobId: string, inputs: Record<string, string>) {
  const { token, repo, workflow, ref } = await getConfig();
  const client = ghClient(token);
  try {
    await client.post(`/repos/${repo}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`, {
      ref,
      inputs: {
        ...inputs,
        job_id: jobId,
      },
    });
  } catch (error: any) {
    const status = error?.response?.status;
    const message = String(error?.response?.data?.message || error?.message || '');
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
    } else {
      throw error;
    }
  }
}

async function waitForWorkflow(jobId: string, startedAt: number) {
  const { token, repo } = await getConfig();
  const client = ghClient(token);
  const timeoutMs = 25 * 60_000;
  const pollMs = 10_000;
  const runDetectTimeoutMs = 90_000;

  let runId: number | null = null;
  while (Date.now() - startedAt < timeoutMs) {
    const runs = await client.get(`/repos/${repo}/actions/runs`, { params: { per_page: 50 } });
    const all = Array.isArray(runs.data?.workflow_runs) ? runs.data.workflow_runs : [];
    const found = all.find((r: any) => {
      const title = String(r?.display_title || r?.name || '');
      const created = new Date(r?.created_at || 0).getTime();
      const wfName = String(r?.name || '');
      const evt = String(r?.event || '');
      return created >= startedAt - 30_000 && title.includes(jobId) && wfName.toLowerCase().includes('gstreamer-render') && (evt === 'workflow_dispatch' || evt === 'repository_dispatch');
    });

    if (found) {
      runId = found.id;
      console.info(`[render:${jobId}] github_run_detected id=${found.id} event=${found.event} status=${found.status} conclusion=${found.conclusion || 'n/a'} url=${found.html_url}`);
    } else {
      const elapsed = Date.now() - startedAt;
      console.info(`[render:${jobId}] github_run_waiting elapsedMs=${elapsed}`);
      if (elapsed > runDetectTimeoutMs) {
        throw new Error(`No GitHub Actions run detected for ${jobId} within ${runDetectTimeoutMs}ms after dispatch. Check repo Actions settings/triggers.`);
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

  await triggerWorkflow(payload.jobId, inputs);
  const run = await waitForWorkflow(payload.jobId, startedAt);
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
