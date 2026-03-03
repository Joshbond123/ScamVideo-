import axios from 'axios';
import fs from 'fs-extra';
import path from 'path';
import { getKeyValueByTypeAndName } from './supabaseKeyStore';

const DEFAULT_BUCKET = process.env.SUPABASE_MEDIA_BUCKET || 'temp-media';

async function resolveRenderFunctionUrls() {
  const envConfigured = process.env.SUPABASE_RENDER_FUNCTION_URL;
  const dbConfigured = await getKeyValueByTypeAndName('config', 'SUPABASE_RENDER_FUNCTION_URL').catch(() => null);
  const configured = (envConfigured || dbConfigured || '').trim();
  if (configured) {
    if (configured.includes(',')) {
      return configured
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
    }
    return [configured];
  }

  const functionName = (
    process.env.SUPABASE_RENDER_FUNCTION_NAME ||
    (await getKeyValueByTypeAndName('config', 'SUPABASE_RENDER_FUNCTION_NAME').catch(() => null)) ||
    ''
  ).trim();

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return [] as string[];
  const base = `${url.replace(/\/$/, '')}/functions/v1`;

  if (functionName) {
    return [`${base}/${functionName}`];
  }

  return [`${base}/render-video`, `${base}/video-render`, `${base}/render`];
}

type StorageFile = {
  name: string;
  id?: string;
  metadata?: { size?: number };
  updated_at?: string;
};

function getConfig() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for storage operations');
  return { url, key };
}

function makeClient() {
  const { url, key } = getConfig();
  return axios.create({
    baseURL: `${url}/storage/v1`,
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    timeout: 60_000,
  });
}

async function ensureMediaBucket() {
  const client = makeClient();
  try {
    await client.get(`/bucket/${DEFAULT_BUCKET}`);
  } catch (error: any) {
    if (error?.response?.status === 404 || error?.response?.data?.error === 'Bucket not found') {
      await client.post('/bucket', { id: DEFAULT_BUCKET, name: DEFAULT_BUCKET, public: false });
      return;
    }
    throw error;
  }
}

export async function uploadLocalAssetToSupabase(localPath: string, remotePath: string, contentType: string) {
  await ensureMediaBucket();
  const client = makeClient();
  const bytes = await fs.readFile(localPath);
  await client.post(`/object/${DEFAULT_BUCKET}/${remotePath}`, bytes, {
    headers: {
      'Content-Type': contentType,
      'x-upsert': 'true',
    },
  });

  return remotePath;
}

export async function deleteSupabaseAssets(paths: string[]) {
  if (!paths.length) return;
  const client = makeClient();
  await client.delete(`/object/${DEFAULT_BUCKET}`, { data: { prefixes: paths } });
}

export async function pruneSupabaseTempAssets(prefix = 'jobs/', maxAgeHours = 24, maxBytes = 1_500_000_000) {
  const client = makeClient();
  const response = await client.post(`/object/list/${DEFAULT_BUCKET}`, {
    prefix,
    limit: 1000,
    sortBy: { column: 'updated_at', order: 'asc' },
  });

  const files = (Array.isArray(response.data) ? response.data : []) as StorageFile[];
  const now = Date.now();
  let runningBytes = files.reduce((acc, file) => acc + Number(file?.metadata?.size || 0), 0);
  const toDelete: string[] = [];

  for (const file of files) {
    const updatedAtMs = new Date(file.updated_at || 0).getTime();
    const ageHours = Number.isFinite(updatedAtMs) ? (now - updatedAtMs) / (1000 * 60 * 60) : Number.POSITIVE_INFINITY;
    const size = Number(file?.metadata?.size || 0);

    if (ageHours > maxAgeHours || runningBytes > maxBytes) {
      toDelete.push(path.posix.join(prefix, file.name));
      runningBytes -= size;
    }
  }

  await deleteSupabaseAssets(toDelete);
  return { deleted: toDelete.length };
}


export async function validateSupabaseRenderFunctionEndpoint() {
  const fnUrls = await resolveRenderFunctionUrls();
  if (!fnUrls.length) {
    throw new Error('Supabase render function URL is not configured');
  }

  const { key } = getConfig();
  let lastError: any = null;

  for (const fnUrl of fnUrls) {
    try {
      const response = await axios.post(
        fnUrl,
        { healthcheck: true },
        {
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          timeout: 15_000,
          validateStatus: () => true,
        }
      );

      if (response.status === 404) {
        lastError = new Error(`404 at ${fnUrl}`);
        continue;
      }

      console.info(`[render:preflight] render_provider=supabase_only endpoint=${fnUrl} probe_status=${response.status}`);
      return { functionUrl: fnUrl, status: response.status };
    } catch (error: any) {
      lastError = error;
    }
  }

  throw new Error(`Supabase render function unavailable. Tried URLs: ${fnUrls.join(', ')}. Last error: ${lastError?.message || lastError}`);
}

export async function renderVideoViaSupabaseFunction(payload: {
  jobId: string;
  audioPath: string;
  imagePaths: string[];
  subtitleLines: string[];
  subtitleEvents?: Array<{ text: string; start: number; end: number }>;
  subtitleAss?: string;
  voiceoverMeta?: { voiceId: string; timingSource: string; durationSec: number } | null;
}) {
  const fnUrls = await resolveRenderFunctionUrls();
  if (!fnUrls.length) {
    throw new Error('Supabase render function URL is not configured');
  }

  const client = makeClient();

  const uploadedAudio = await uploadLocalAssetToSupabase(payload.audioPath, `jobs/${payload.jobId}/audio.mp3`, 'audio/mpeg');

  let uploadedSubtitleAss = '';
  if (payload.subtitleAss) {
    const subtitleLocal = path.join(process.cwd(), 'database/assets/videos', `${payload.jobId}.ass`);
    await fs.ensureDir(path.dirname(subtitleLocal));
    await fs.writeFile(subtitleLocal, payload.subtitleAss, 'utf8');
    uploadedSubtitleAss = await uploadLocalAssetToSupabase(subtitleLocal, `jobs/${payload.jobId}/subtitles.ass`, 'text/x-ass');
  }

  const uploadedImages: string[] = [];
  for (let i = 0; i < payload.imagePaths.length; i++) {
    uploadedImages.push(await uploadLocalAssetToSupabase(payload.imagePaths[i], `jobs/${payload.jobId}/scene_${i}.png`, 'image/png'));
  }

  const { key } = getConfig();
  let response: any = null;
  let lastError: any = null;
  let usedUrl = "";

  for (const fnUrl of fnUrls) {
    try {
      response = await axios.post(
        fnUrl,
        {
          jobId: payload.jobId,
          bucket: DEFAULT_BUCKET,
          audioPath: uploadedAudio,
          imagePaths: uploadedImages,
          subtitleLines: payload.subtitleLines,
          subtitleEvents: payload.subtitleEvents || [],
          subtitleAss: payload.subtitleAss || "",
          voiceoverMeta: payload.voiceoverMeta || null,
          renderProvider: "supabase_only",
          outputPath: `jobs/${payload.jobId}/render.mp4`,
        },
        {
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          timeout: 600_000,
        }
      );
      usedUrl = fnUrl;
      console.info(`[render:${payload.jobId}] render_provider=supabase_only supabase_function_url=${fnUrl} status=${response.status}`);
      break;
    } catch (error: any) {
      lastError = error;
      const status = error?.response?.status;
      if (status === 404) {
        console.warn(`[render:${payload.jobId}] Supabase function not found at ${fnUrl}; trying next candidate`);
        continue;
      }
      throw error;
    }
  }

  if (!response) {
    throw new Error(`Supabase render function unavailable. Tried URLs: ${fnUrls.join(', ')}. Last error: ${lastError?.message || lastError}`);
  }

  const renderedPath = (response?.data?.outputPath || response?.data?.result?.outputPath) as string | undefined;
  if (!renderedPath) {
    throw new Error(`Supabase render function response missing outputPath: ${JSON.stringify(response?.data || {})}`);
  }

  const download = await client.get(`/object/${DEFAULT_BUCKET}/${renderedPath}`, { responseType: 'arraybuffer' });
  const localOutput = path.join(process.cwd(), 'database/assets/videos', `${payload.jobId}.mp4`);
  await fs.ensureDir(path.dirname(localOutput));
  await fs.writeFile(localOutput, Buffer.from(download.data));


  const renderStatus = String(response?.data?.status || response?.data?.result?.status || 'success');
  const renderLogs = response?.data?.logs || response?.data?.result?.logs || null;
  const outputDurationSec = Number(response?.data?.durationSec || response?.data?.result?.durationSec || 0);
  const subtitlesBurned = Boolean(response?.data?.subtitlesBurned ?? response?.data?.result?.subtitlesBurned ?? payload.subtitleEvents?.length);
  if (renderLogs) {
    console.info(`[render:${payload.jobId}] render_provider=supabase_only render_logs=${JSON.stringify(renderLogs)}`);
  }
  return {
    localOutput,
    tempPaths: [uploadedAudio, ...uploadedImages, ...(uploadedSubtitleAss ? [uploadedSubtitleAss] : []), renderedPath],
    outputPath: renderedPath,
    renderProvider: "supabase_only",
    renderStatus,
    renderLogs,
    functionUrl: usedUrl,
    outputDurationSec,
    subtitlesBurned,
  };
}
