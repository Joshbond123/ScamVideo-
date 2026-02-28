import { ApiKey } from '../../src/types';
import { listApiKeys, patchApiKey } from './supabaseKeyStore';

export async function getKeys(provider: ApiKey['provider']): Promise<ApiKey[]> {
  return await listApiKeys(provider);
}

export async function getActiveKeys(provider: ApiKey['provider']): Promise<ApiKey[]> {
  const keys = await getKeys(provider);
  return keys
    .filter((k) => k.status === 'active')
    .sort((a, b) => {
      if (!a.lastUsed) return -1;
      if (!b.lastUsed) return 1;
      return new Date(a.lastUsed).getTime() - new Date(b.lastUsed).getTime();
    });
}

export async function getNextKey(provider: ApiKey['provider']): Promise<ApiKey | null> {
  const activeKeys = await getActiveKeys(provider);
  return activeKeys[0] || null;
}

export async function trackKeyUsage(id: string, provider: ApiKey['provider'], success: boolean) {
  const keys = await getKeys(provider);
  const key = keys.find((k) => k.id === id);
  if (!key) return;

  await patchApiKey(provider, id, {
    successCount: key.successCount + (success ? 1 : 0),
    failCount: key.failCount + (success ? 0 : 1),
    lastUsed: new Date().toISOString(),
    status: key.status,
  });
}

export async function withKeyFailover<T>(
  provider: ApiKey['provider'],
  executor: (key: ApiKey) => Promise<T>
): Promise<T> {
  const activeKeys = await getActiveKeys(provider);
  if (activeKeys.length === 0) throw new Error(`No active ${provider} keys`);

  let lastError: unknown;

  for (const key of activeKeys) {
    try {
      const result = await executor(key);
      await trackKeyUsage(key.id, provider, true);
      return result;
    } catch (error) {
      lastError = error;
      await trackKeyUsage(key.id, provider, false);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`All ${provider} keys failed`);
}

export async function updateKey(id: string, provider: ApiKey['provider'], updater: (key: ApiKey) => ApiKey) {
  const keys = await getKeys(provider);
  const current = keys.find((k) => k.id === id);
  if (!current) return;

  const updated = updater(current);
  await patchApiKey(provider, id, updated);
}
