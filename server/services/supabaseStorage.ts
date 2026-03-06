import axios from 'axios';
import fs from 'fs-extra';
import path from 'path';
import { getKeyValueByTypeAndName } from './supabaseKeyStore';

type StorageFile = {
  name: string;
  id?: string;
  metadata?: { size?: number };
  updated_at?: string;
};

const DEFAULT_BUCKET = process.env.SUPABASE_MEDIA_BUCKET || 'temp-media';

async function resolveConfigValue(name: 'SUPABASE_URL' | 'SUPABASE_SERVICE_ROLE_KEY') {
  const fromEnv = String(process.env[name] || '').trim();
  if (fromEnv) return fromEnv;

  try {
    const fromConfig = String((await getKeyValueByTypeAndName('config', name)) || '').trim();
    if (fromConfig) return fromConfig;
  } catch {
    // Continue to throw clear error below.
  }

  throw new Error(`Missing required configuration ${name}. Set env or save it in Settings → Infrastructure.`);
}

async function makeClient() {
  const url = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim() || await resolveConfigValue('SUPABASE_URL');
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim() || await resolveConfigValue('SUPABASE_SERVICE_ROLE_KEY');
  return axios.create({
    baseURL: `${url}/storage/v1`,
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    timeout: 60_000,
  });
}

async function ensureMediaBucket() {
  const client = await makeClient();
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
  const client = await makeClient();
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
  const client = await makeClient();
  await client.delete(`/object/${DEFAULT_BUCKET}`, { data: { prefixes: paths } });
}

export async function downloadSupabaseAssetToLocal(remotePath: string, localPath: string) {
  const client = await makeClient();
  const download = await client.get(`/object/${DEFAULT_BUCKET}/${remotePath}`, { responseType: 'arraybuffer' });
  await fs.ensureDir(path.dirname(localPath));
  await fs.writeFile(localPath, Buffer.from(download.data));
  return localPath;
}

export async function pruneSupabaseTempAssets(prefix = 'jobs/', maxAgeHours = 24, maxBytes = 1_500_000_000) {
  const client = await makeClient();
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
