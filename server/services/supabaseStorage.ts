import axios from 'axios';
import fs from 'fs-extra';
import { HttpsProxyAgent } from 'https-proxy-agent';

const DEFAULT_BUCKET = process.env.SUPABASE_MEDIA_BUCKET || 'temp-media';

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
  const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
  const httpsAgent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined;

  return axios.create({
    baseURL: `${url}/storage/v1`,
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    httpsAgent,
    proxy: false,
    timeout: 60_000,
  });
}

async function listObjectsRecursively(client: ReturnType<typeof makeClient>, folder: string) {
  const queue = [folder.replace(/^\/+|\/+$/g, '')];
  const files: Array<{ path: string; size: number; updatedAt: number }> = [];

  while (queue.length) {
    const current = queue.shift() || '';
    const response = await client.post(`/object/list/${DEFAULT_BUCKET}`, {
      prefix: current ? `${current}/` : '',
      limit: 1000,
      sortBy: { column: 'updated_at', order: 'desc' },
    });

    const items: StorageFile[] = Array.isArray(response.data) ? response.data : [];
    for (const item of items) {
      const itemName = String(item.name || '').trim();
      if (!itemName) continue;
      const itemPath = current ? `${current}/${itemName}` : itemName;
      const isFolder = !item.id && itemName.endsWith('/');
      if (isFolder) {
        queue.push(itemPath.replace(/\/+$/, ''));
        continue;
      }
      const size = Number(item.metadata?.size || 0);
      const updatedAt = new Date(item.updated_at || 0).getTime();
      files.push({ path: itemPath, size, updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0 });
    }
  }

  return files;
}

export async function uploadLocalAssetToSupabase(localPath: string, remotePath: string, contentType: string) {
  const client = makeClient();
  const data = await fs.readFile(localPath);
  const normalized = remotePath.replace(/^\/+/, '');

  await client.post(`/object/${DEFAULT_BUCKET}/${normalized}`, data, {
    headers: {
      'Content-Type': contentType,
      'x-upsert': 'true',
    },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });

  return normalized;
}

export async function deleteSupabaseAssets(paths: string[]) {
  if (!paths.length) return;
  const client = makeClient();
  const normalized = paths.map((p) => p.replace(/^\/+/, '')).filter(Boolean);
  if (!normalized.length) return;
  await client.delete(`/object/${DEFAULT_BUCKET}`, { data: { prefixes: normalized } });
}

export async function pruneSupabaseTempAssets(prefix = 'jobs/', maxAgeHours = 24, maxBytes = 1_500_000_000) {
  const client = makeClient();
  const all = await listObjectsRecursively(client, prefix);
  if (!all.length) return;

  const now = Date.now();
  const maxAgeMs = maxAgeHours * 60 * 60 * 1000;

  const old = all.filter((x) => now - x.updatedAt > maxAgeMs).map((x) => x.path);
  if (old.length) {
    await deleteSupabaseAssets(old);
  }

  const sorted = [...all].sort((a, b) => b.updatedAt - a.updatedAt);
  let total = sorted.reduce((sum, file) => sum + Math.max(0, file.size), 0);
  if (total <= maxBytes) return;

  const overflow: string[] = [];
  for (let i = sorted.length - 1; i >= 0 && total > maxBytes; i--) {
    const file = sorted[i];
    overflow.push(file.path);
    total -= Math.max(0, file.size);
  }

  if (overflow.length) {
    await deleteSupabaseAssets(overflow);
  }
}
