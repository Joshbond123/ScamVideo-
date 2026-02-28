import fs from 'fs-extra';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

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

// Initialize folders
export async function initDb() {
  await fs.ensureDir(DB_ROOT);
  await fs.ensureDir(path.join(DB_ROOT, 'keys'));
  await fs.ensureDir(path.join(DB_ROOT, 'facebook'));
  await fs.ensureDir(path.join(DB_ROOT, 'schedules'));
  await fs.ensureDir(path.join(DB_ROOT, 'content'));
  await fs.ensureDir(path.join(DB_ROOT, 'topics'));
  await fs.ensureDir(path.join(DB_ROOT, 'usage'));
  await fs.ensureDir(path.join(DB_ROOT, 'assets/audio'));
  await fs.ensureDir(path.join(DB_ROOT, 'assets/images'));
  await fs.ensureDir(path.join(DB_ROOT, 'assets/videos'));
  await fs.ensureDir(path.join(DB_ROOT, 'locks'));

  // Ensure files exist
  const ensureFile = async (p: string) => {
    if (!(await fs.pathExists(p))) {
      await fs.writeJson(p, p.includes('settings') ? {} : []);
    }
  };

  for (const p of Object.values(PATHS)) {
    if (typeof p === 'string') {
      await ensureFile(p);
    } else {
      for (const subP of Object.values(p)) {
        if (typeof subP === 'string') {
          await ensureFile(subP);
        }
      }
    }
  }
}

export async function readJson<T>(filePath: string): Promise<T> {
  if (!filePath) {
    console.error('readJson called with undefined or empty filePath');
    return [] as T;
  }
  try {
    if (!(await fs.pathExists(filePath))) {
      const defaultData = filePath.includes('settings') ? {} : [];
      await fs.writeJson(filePath, defaultData);
      return defaultData as T;
    }
    return await fs.readJson(filePath);
  } catch (error) {
    console.error(`Error reading JSON from ${filePath}:`, error);
    return (filePath && filePath.includes('settings') ? {} : []) as T;
  }
}

export async function writeJson<T>(filePath: string, data: T): Promise<void> {
  const tempPath = `${filePath}.${uuidv4()}.tmp`;
  await fs.writeJson(tempPath, data);
  await fs.rename(tempPath, filePath);
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
