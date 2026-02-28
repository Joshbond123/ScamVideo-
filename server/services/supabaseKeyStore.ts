import { createClient } from '@supabase/supabase-js';
import { ApiKey } from '../../src/types';
import { PATHS, readJson, updateJson } from '../db';

type ApiKeyRow = {
  id: string;
  provider: ApiKey['provider'];
  name: string;
  key: string;
  last_used: string | null;
  success_count: number;
  fail_count: number;
  status: 'active' | 'inactive';
};

let supabase: ReturnType<typeof createClient> | null = null;
let supabaseUnavailable = false;

function getSupabase() {
  if (supabaseUnavailable) return null;
  if (supabase) return supabase;

  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return null;
  }

  supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return supabase;
}

function rowToApiKey(row: ApiKeyRow): ApiKey {
  return {
    id: row.id,
    provider: row.provider,
    name: row.name,
    key: row.key,
    lastUsed: row.last_used ?? undefined,
    successCount: row.success_count,
    failCount: row.fail_count,
    status: row.status,
  };
}

function providerPath(provider: ApiKey['provider']) {
  return PATHS.keys[provider];
}

async function listFromFile(provider: ApiKey['provider']): Promise<ApiKey[]> {
  return await readJson<ApiKey[]>(providerPath(provider));
}

async function withSupabaseFallback<T>(operation: (client: ReturnType<typeof createClient>) => Promise<T>): Promise<T | null> {
  const client = getSupabase();
  if (!client) return null;

  try {
    return await operation(client);
  } catch (error: any) {
    supabaseUnavailable = true;
    console.warn('Supabase api_keys operation failed, falling back to file storage:', error?.message || error);
    return null;
  }
}

export async function listApiKeys(provider: ApiKey['provider']): Promise<ApiKey[]> {
  const fromSupabase = await withSupabaseFallback(async (client) => {
    const { data, error } = await (client as any)
      .from('api_keys')
      .select('*')
      .eq('provider', provider)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data || []).map((r: ApiKeyRow) => rowToApiKey(r));
  });

  if (fromSupabase !== null) return fromSupabase;
  return await listFromFile(provider);
}

export async function insertApiKey(key: ApiKey): Promise<ApiKey> {
  const fromSupabase = await withSupabaseFallback(async (client) => {
    const { data, error } = await (client as any)
      .from('api_keys')
      .insert({
        id: key.id,
        provider: key.provider,
        name: key.name,
        key: key.key,
        success_count: key.successCount,
        fail_count: key.failCount,
        last_used: key.lastUsed ?? null,
        status: key.status,
      })
      .select('*')
      .single();

    if (error) throw error;
    return rowToApiKey(data as ApiKeyRow);
  });

  if (fromSupabase) return fromSupabase;

  await updateJson<ApiKey[]>(providerPath(key.provider), (existing) => [key, ...existing]);
  return key;
}

export async function patchApiKey(provider: ApiKey['provider'], id: string, values: Partial<ApiKey>): Promise<ApiKey | null> {
  const fromSupabase = await withSupabaseFallback(async (client) => {
    const payload: Record<string, unknown> = {};
    if (values.name !== undefined) payload.name = values.name;
    if (values.key !== undefined) payload.key = values.key;
    if (values.status !== undefined) payload.status = values.status;
    if (values.successCount !== undefined) payload.success_count = values.successCount;
    if (values.failCount !== undefined) payload.fail_count = values.failCount;
    if (values.lastUsed !== undefined) payload.last_used = values.lastUsed;

    const { data, error } = await (client as any)
      .from('api_keys')
      .update(payload)
      .eq('provider', provider)
      .eq('id', id)
      .select('*')
      .maybeSingle();

    if (error) throw error;
    return data ? rowToApiKey(data as ApiKeyRow) : null;
  });

  if (fromSupabase !== null) return fromSupabase;

  let updated: ApiKey | null = null;
  await updateJson<ApiKey[]>(providerPath(provider), (existing) =>
    existing.map((key) => {
      if (key.id !== id) return key;
      updated = {
        ...key,
        ...values,
        provider,
      };
      return updated;
    })
  );

  return updated;
}

export async function deleteApiKey(provider: ApiKey['provider'], id: string): Promise<void> {
  const fromSupabase = await withSupabaseFallback(async (client) => {
    const { error } = await (client as any).from('api_keys').delete().eq('provider', provider).eq('id', id);
    if (error) throw error;
    return true;
  });

  if (fromSupabase) return;

  await updateJson<ApiKey[]>(providerPath(provider), (existing) => existing.filter((key) => key.id !== id));
}
