import { createClient } from '@supabase/supabase-js';
import { ApiKey } from '../../src/types';

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

function getSupabase() {
  if (supabase) return supabase;

  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables');
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

export async function listApiKeys(provider: ApiKey['provider']): Promise<ApiKey[]> {
  const { data, error } = await (getSupabase() as any)
    .from('api_keys')
    .select('*')
    .eq('provider', provider)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []).map((r) => rowToApiKey(r as ApiKeyRow));
}

export async function insertApiKey(key: ApiKey): Promise<ApiKey> {
  const { data, error } = await (getSupabase() as any)
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
}

export async function patchApiKey(provider: ApiKey['provider'], id: string, values: Partial<ApiKey>): Promise<ApiKey | null> {
  const payload: Record<string, unknown> = {};
  if (values.name !== undefined) payload.name = values.name;
  if (values.key !== undefined) payload.key = values.key;
  if (values.status !== undefined) payload.status = values.status;
  if (values.successCount !== undefined) payload.success_count = values.successCount;
  if (values.failCount !== undefined) payload.fail_count = values.failCount;
  if (values.lastUsed !== undefined) payload.last_used = values.lastUsed;

  const { data, error } = await (getSupabase() as any)
    .from('api_keys')
    .update(payload)
    .eq('provider', provider)
    .eq('id', id)
    .select('*')
    .maybeSingle();

  if (error) throw error;
  return data ? rowToApiKey(data as ApiKeyRow) : null;
}

export async function deleteApiKey(provider: ApiKey['provider'], id: string): Promise<void> {
  const { error } = await (getSupabase() as any).from('api_keys').delete().eq('provider', provider).eq('id', id);
  if (error) throw error;
}
