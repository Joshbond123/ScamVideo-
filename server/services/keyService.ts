import { ApiKey } from '../../src/types';
import { listApiKeys, patchApiKey } from './supabaseKeyStore';

const providerRotationOffsets: Record<ApiKey['provider'], number> = {
  cerebras: 0,
  unrealspeech: 0,
  'workers-ai': 0,
};

export async function getKeys(provider: ApiKey['provider']): Promise<ApiKey[]> {
  return await listApiKeys(provider);
}

export async function getActiveKeys(provider: ApiKey['provider']): Promise<ApiKey[]> {
  const keys = await getKeys(provider);
  return keys.filter((k) => k.status === 'active');
}

function rotateKeys<T>(arr: T[], offset: number) {
  if (arr.length === 0) return arr;
  const idx = offset % arr.length;
  return [...arr.slice(idx), ...arr.slice(0, idx)];
}

export async function getNextKey(provider: ApiKey['provider']): Promise<ApiKey | null> {
  const activeKeys = await getActiveKeys(provider);
  if (activeKeys.length === 0) return null;
  const rotated = rotateKeys(activeKeys, providerRotationOffsets[provider]);
  return rotated[0] || null;
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

  const startOffset = providerRotationOffsets[provider] % activeKeys.length;
  const orderedKeys = rotateKeys(activeKeys, startOffset);

  providerRotationOffsets[provider] = (providerRotationOffsets[provider] + 1) % Math.max(activeKeys.length, 1);

  let lastError: unknown;
  for (const key of orderedKeys) {
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
