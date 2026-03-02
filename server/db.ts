import fs from 'fs-extra';
import path from 'path';
import axios from 'axios';
import crypto from 'crypto';

const DB_ROOT = path.join(process.cwd(), 'database');

const PATHS = {
  settings: path.join(DB_ROOT, 'settings.json'),
  keys: {
    cerebras: path.join(DB_ROOT, 'keys/cerebras.json'),
    unrealspeech: path.join(DB_ROOT, 'keys/unrealspeech.json'),
    'workers-ai': path.join(DB_ROOT, 'keys/workersai.json'),
  },
  facebook: {
    pages: path.join(DB_ROOT, 'facebook/pages.json'),
  },
  schedules: {
    video: path.join(DB_ROOT, 'schedules/video.json'),
    post: path.join(DB_ROOT, 'schedules/post.json'),
  },
  content: {
    published_videos: path.join(DB_ROOT, 'content/published_videos.json'),
    published_posts: path.join(DB_ROOT, 'content/published_posts.json'),
  },
  topics: {
    history: path.join(DB_ROOT, 'topics/topic_history.json'),
  },
  logs: path.join(DB_ROOT, 'logs.json'),
  usage: path.join(DB_ROOT, 'usage/key_usage.json'),
};

function getSupabaseConfigOrThrow() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Supabase is required. Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  return { url, key };
}

function getSupabaseRestClient() {
  const { url, key } = getSupabaseConfigOrThrow();
  return axios.create({
    baseURL: `${url}/rest/v1`,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    timeout: 30_000,
  });
}

function resolveStateKey(filePath: string): string | null {
  const map: Record<string, string> = {
    [PATHS.settings]: 'settings',
    [PATHS.facebook.pages]: 'facebook_pages',
    [PATHS.schedules.video]: 'schedules_video',
    [PATHS.schedules.post]: 'schedules_post',
    [PATHS.content.published_videos]: 'published_videos',
    [PATHS.content.published_posts]: 'published_posts',
    [PATHS.topics.history]: 'topic_history',
    [PATHS.logs]: 'logs',
  };
  return map[filePath] || null;
}

type StateRow = {
  id: string;
  key_name: string;
  encrypted_key: string;
};

async function getStateRow(stateKey: string): Promise<StateRow | null> {
  const client = getSupabaseRestClient();
  const response = await client.get('/api_keys', {
    params: {
      key_type: 'eq.state',
      key_name: `eq.${stateKey}`,
      select: 'id,key_name,encrypted_key',
      order: 'updated_at.desc',
      limit: 1,
    },
  });

  const rows = Array.isArray(response.data) ? response.data : [];
  return (rows[0] as StateRow | undefined) || null;
}

async function readFromSupabaseState<T>(stateKey: string, fallback: T): Promise<T> {
  const row = await getStateRow(stateKey);
  if (!row) return fallback;

  try {
    return JSON.parse(row.encrypted_key) as T;
  } catch (error) {
    throw new Error(`Failed to parse state payload for ${stateKey}: ${error}`);
  }
}

async function writeToSupabaseState<T>(stateKey: string, data: T): Promise<void> {
  const client = getSupabaseRestClient();
  const payload = JSON.stringify(data);
  const existing = await getStateRow(stateKey);

  if (existing) {
    await client.patch(
      '/api_keys',
      { encrypted_key: payload, updated_at: new Date().toISOString() },
      {
        params: {
          key_type: 'eq.state',
          key_name: `eq.${stateKey}`,
        },
      }
    );
    return;
  }

  await client.post('/api_keys', [
    {
      id: crypto.randomUUID(),
      key_type: 'state',
      key_name: stateKey,
      encrypted_key: payload,
      metadata: {},
    },
  ]);
}

// Initialize folders only for generated runtime assets/locks.
export async function initDb() {
  await fs.ensureDir(path.join(DB_ROOT, 'assets/audio'));
  await fs.ensureDir(path.join(DB_ROOT, 'assets/images'));
  await fs.ensureDir(path.join(DB_ROOT, 'assets/videos'));
  await fs.ensureDir(path.join(DB_ROOT, 'locks'));
}

export async function readJson<T>(filePath: string): Promise<T> {
  if (!filePath) {
    throw new Error('readJson called with undefined or empty filePath');
  }

  const stateKey = resolveStateKey(filePath);
  if (!stateKey) {
    throw new Error(`Unsupported non-Supabase state path: ${filePath}`);
  }

  const defaultData = filePath.includes('settings') ? ({} as T) : ([] as T);
  return readFromSupabaseState<T>(stateKey, defaultData);
}

export async function writeJson<T>(filePath: string, data: T): Promise<void> {
  const stateKey = resolveStateKey(filePath);
  if (!stateKey) {
    throw new Error(`Unsupported non-Supabase state path: ${filePath}`);
  }

  await writeToSupabaseState(stateKey, data);
}

export async function updateJson<T>(filePath: string, updater: (data: T) => T): Promise<void> {
  const data = await readJson<T>(filePath);
  const updated = updater(data);
  await writeJson(filePath, updated);
}

export async function appendJson<T>(filePath: string, item: T): Promise<void> {
  await updateJson<T[]>(filePath, (data) => [item, ...data]);
}

export { PATHS };
