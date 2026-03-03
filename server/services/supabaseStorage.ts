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

function makeEdgeFunctionHeaders(key: string) {
  return {
    Authorization: `Bearer ${key}`,
    apikey: key,
    'Content-Type': 'application/json',
  };
}

function normalizeStorageObjectPath(pathOrUrl: string) {
  const trimmed = String(pathOrUrl || '').trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const normalized = trimmed.replace(/^\/+/, '');
  if (normalized.startsWith(`${DEFAULT_BUCKET}/`)) {
    return normalized.slice(DEFAULT_BUCKET.length + 1);
  }
  return normalized;
}

async function downloadRenderedVideo(client: ReturnType<typeof makeClient>, renderedPathOrUrl: string, jobId: string) {
  const normalized = normalizeStorageObjectPath(renderedPathOrUrl);
  const localOutput = path.join(process.cwd(), 'database/assets/videos', `${jobId}.mp4`);
  await fs.ensureDir(path.dirname(localOutput));

  if (/^https?:\/\//i.test(normalized)) {
    const download = await axios.get(normalized, { responseType: 'arraybuffer', timeout: 180_000 });
    await fs.writeFile(localOutput, Buffer.from(download.data));
    return { localOutput, outputPath: renderedPathOrUrl };
  }

  const download = await client.get(`/object/${DEFAULT_BUCKET}/${normalized}`, { responseType: 'arraybuffer', timeout: 180_000 });
  await fs.writeFile(localOutput, Buffer.from(download.data));
  return { localOutput, outputPath: normalized };
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
          headers: makeEdgeFunctionHeaders(key),
          timeout: 15_000,
          validateStatus: () => true,
        }
      );

      if (response.status === 404) {
        lastError = new Error(`404 at ${fnUrl}`);
        continue;
      }

      const fnName = String(response.data?.function || '').trim();
      const timelineMode = String(response.data?.subtitleTimelineMode || '').trim();
      if (fnName !== 'render-video' || timelineMode !== 'concat') {
        lastError = new Error(`Incompatible render function at ${fnUrl}: function=${fnName || 'unknown'} subtitleTimelineMode=${timelineMode || 'unknown'}`);
        continue;
      }

      const rendererVersion = String(response.data?.rendererVersion || 'unknown');
      console.info(`[render:preflight] render_provider=supabase_only endpoint=${fnUrl} probe_status=${response.status} renderer_version=${rendererVersion} subtitle_timeline_mode=${timelineMode}`);
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

  if (!payload.jobId || !uploadedAudio || !uploadedImages.length) {
    throw new Error(
      `render payload incomplete before edge call: jobId=${String(payload.jobId || '')} audioPath=${String(uploadedAudio || '')} imageCount=${uploadedImages.length}`
    );
  }

  const { key } = getConfig();
  let response: any = null;
  let lastError: any = null;
  let usedUrl = "";

  for (const fnUrl of fnUrls) {
    try {
      const renderRequestBody = {
        jobId: payload.jobId,
        bucket: DEFAULT_BUCKET,
        audioPath: uploadedAudio,
        imagePaths: uploadedImages,
        subtitleLines: payload.subtitleLines,
        subtitleEvents: payload.subtitleEvents || [],
        subtitleAssPath: uploadedSubtitleAss || "",
        subtitleAss: payload.subtitleAss || "",
        voiceoverMeta: payload.voiceoverMeta || null,
        renderProvider: "supabase_only",
        outputPath: `jobs/${payload.jobId}/render.mp4`,
      };

      console.info(
        `[render:${payload.jobId}] supabase_request_payload endpoint=${fnUrl} bucket=${renderRequestBody.bucket} audio_path=${renderRequestBody.audioPath} image_count=${renderRequestBody.imagePaths.length} subtitle_events=${renderRequestBody.subtitleEvents.length} has_subtitle_ass=${Boolean(renderRequestBody.subtitleAssPath)}`
      );

      response = await axios.post(
        fnUrl,
        renderRequestBody,
        {
          headers: makeEdgeFunctionHeaders(key),
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

  const renderedPath = (response?.data?.outputPath || response?.data?.result?.outputPath || response?.data?.url || response?.data?.result?.url || response?.data?.signedUrl || response?.data?.result?.signedUrl) as string | undefined;
  const responseFunctionName = String(response?.data?.function || response?.data?.result?.function || '').trim();
  const responseRendererVersion = String(response?.data?.rendererVersion || response?.data?.result?.rendererVersion || 'unknown');
  if (responseFunctionName && responseFunctionName !== 'render-video') {
    throw new Error(`Unexpected Supabase renderer function=${responseFunctionName}; expected render-video`);
  }
  if (!renderedPath) {
    throw new Error(`Supabase render function response missing outputPath: ${JSON.stringify(response?.data || {})}`);
  }

  const { localOutput, outputPath } = await downloadRenderedVideo(client, renderedPath, payload.jobId);


  const renderStatus = String(response?.data?.status || response?.data?.result?.status || 'success');
  const renderLogs = response?.data?.logs || response?.data?.result?.logs || null;
  const outputDurationSec = Number(response?.data?.durationSec || response?.data?.result?.durationSec || 0);
  const subtitlesBurned = Boolean(response?.data?.subtitlesBurned ?? response?.data?.result?.subtitlesBurned ?? payload.subtitleEvents?.length);
  if (renderLogs) {
    console.info(`[render:${payload.jobId}] render_provider=supabase_only render_logs=${JSON.stringify(renderLogs)}`);
  }
  return {
    localOutput,
    tempPaths: [uploadedAudio, ...uploadedImages, ...(uploadedSubtitleAss ? [uploadedSubtitleAss] : []), outputPath],
    outputPath,
    renderProvider: "supabase_only",
    renderStatus,
    renderLogs,
    functionUrl: usedUrl,
    outputDurationSec,
    subtitlesBurned,
    rendererVersion: responseRendererVersion,
  };
}
