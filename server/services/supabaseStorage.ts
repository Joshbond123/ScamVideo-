import axios from 'axios';
import fs from 'fs-extra';
import path from 'path';

const DEFAULT_BUCKET = process.env.SUPABASE_MEDIA_BUCKET || 'temp-media';

function resolveRenderFunctionUrl() {
  if (process.env.SUPABASE_RENDER_FUNCTION_URL) return process.env.SUPABASE_RENDER_FUNCTION_URL;
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!baseUrl) return '';
  return `${baseUrl.replace(/\/$/, '')}/functions/v1/render-video`;
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

export async function renderVideoViaSupabaseFunction(payload: {
  jobId: string;
  audioPath: string;
  imagePaths: string[];
  subtitleLines: string[];
  subtitleEvents?: Array<{ text: string; start: number; end: number }>;
  voiceover?: { voiceId: string; timingSource: string; durationSec: number } | null;
}) {
  const fnUrl = resolveRenderFunctionUrl();
  if (!fnUrl) return null;

  const client = makeClient();

  const uploadedAudio = await uploadLocalAssetToSupabase(payload.audioPath, `jobs/${payload.jobId}/audio.mp3`, 'audio/mpeg');
  const uploadedImages: string[] = [];
  for (let i = 0; i < payload.imagePaths.length; i++) {
    uploadedImages.push(await uploadLocalAssetToSupabase(payload.imagePaths[i], `jobs/${payload.jobId}/scene_${i}.png`, 'image/png'));
  }

  const { key } = getConfig();
  const response = await axios.post(
    fnUrl,
    {
      jobId: payload.jobId,
      bucket: DEFAULT_BUCKET,
      audioPath: uploadedAudio,
      imagePaths: uploadedImages,
      subtitleLines: payload.subtitleLines,
      subtitleEvents: payload.subtitleEvents || [],
      voiceover: payload.voiceover || null,
      outputPath: `jobs/${payload.jobId}/render.mp4`,
    },
    {
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      timeout: 600_000,
    }
  );

  const renderedPath = (response?.data?.outputPath || response?.data?.result?.outputPath) as string | undefined;
  if (!renderedPath) {
    throw new Error(`Supabase render function response missing outputPath: ${JSON.stringify(response?.data || {})}`);
  }

  const download = await client.get(`/object/${DEFAULT_BUCKET}/${renderedPath}`, { responseType: 'arraybuffer' });
  const localOutput = path.join(process.cwd(), 'database/assets/videos', `${payload.jobId}.mp4`);
  await fs.writeFile(localOutput, Buffer.from(download.data));

  return {
    localOutput,
    tempPaths: [uploadedAudio, ...uploadedImages, renderedPath],
  };
}
