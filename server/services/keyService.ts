import { readJson, writeJson, PATHS } from '../db';
import { ApiKey } from '../../src/types';

export async function getKeys(provider: ApiKey['provider']): Promise<ApiKey[]> {
  return await readJson<ApiKey[]>(PATHS.keys[provider]);
}

export async function getNextKey(provider: ApiKey['provider']): Promise<ApiKey | null> {
  const keys = await getKeys(provider);
  const activeKeys = keys.filter(k => k.status === 'active');
  if (activeKeys.length === 0) return null;

  // Sort by lastUsed (nulls first) to ensure round-robin rotation
  activeKeys.sort((a, b) => {
    if (!a.lastUsed) return -1;
    if (!b.lastUsed) return 1;
    return new Date(a.lastUsed).getTime() - new Date(b.lastUsed).getTime();
  });

  return activeKeys[0];
}

export async function trackKeyUsage(id: string, provider: ApiKey['provider'], success: boolean) {
  await updateKey(id, provider, (key) => ({
    ...key,
    successCount: key.successCount + (success ? 1 : 0),
    failCount: key.failCount + (success ? 0 : 1),
    lastUsed: new Date().toISOString(),
    status: !success && key.failCount >= 5 ? 'inactive' : 'active' // Auto-deactivate after 5 fails
  }));
}

export async function updateKey(id: string, provider: ApiKey['provider'], updater: (key: ApiKey) => ApiKey) {
  const filePath = PATHS.keys[provider];
  const keys = await readJson<ApiKey[]>(filePath);
  const index = keys.findIndex(k => k.id === id);
  if (index !== -1) {
    keys[index] = updater(keys[index]);
    await writeJson(filePath, keys);
  }
}
