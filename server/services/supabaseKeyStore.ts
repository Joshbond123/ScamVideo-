import axios from 'axios';
import { ApiKey } from '../../src/types';

type ApiKeyRow = {
  id: string;
  key_type: ApiKey['provider'];
  key_name: string | null;
  encrypted_key: string;
  metadata: Record<string, any> | null;
  created_at?: string;
  updated_at?: string;
};

function getSupabaseConfigOrThrow() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    throw new Error('Supabase api_keys storage requires SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  }

  return { supabaseUrl, serviceKey };
}

function getSupabaseRestClient() {
  const { supabaseUrl, serviceKey } = getSupabaseConfigOrThrow();
  return axios.create({
    baseURL: `${supabaseUrl}/rest/v1`,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    timeout: 30_000,
    proxy: false,
  });
}

function rowToApiKey(row: ApiKeyRow): ApiKey {
  const metadata = row.metadata || {};
  return {
    id: row.id,
    provider: row.key_type,
    name: row.key_name || `Key ${row.id.slice(0, 8)}`,
    key: row.encrypted_key,
    lastUsed: typeof metadata.lastUsed === 'string' ? metadata.lastUsed : undefined,
    successCount: Number(metadata.successCount || 0),
    failCount: Number(metadata.failCount || 0),
    status: metadata.status === 'inactive' ? 'inactive' : 'active',
  };
}

async function getRow(provider: ApiKey['provider'], id: string): Promise<ApiKeyRow | null> {
  const client = getSupabaseRestClient();
  const response = await client.get('/api_keys', {
    params: {
      key_type: `eq.${provider}`,
      id: `eq.${id}`,
      select: 'id,key_type,key_name,encrypted_key,metadata,created_at,updated_at',
      limit: 1,
    },
  });

  const rows = Array.isArray(response.data) ? response.data : [];
  return (rows[0] as ApiKeyRow | undefined) || null;
}

export async function listApiKeys(provider: ApiKey['provider']): Promise<ApiKey[]> {
  const client = getSupabaseRestClient();
  const response = await client.get('/api_keys', {
    params: {
      key_type: `eq.${provider}`,
      select: 'id,key_type,key_name,encrypted_key,metadata,created_at,updated_at',
      order: 'created_at.desc',
    },
  });

  const rows = Array.isArray(response.data) ? response.data : [];
  return rows.map((r: ApiKeyRow) => rowToApiKey(r));
}

export async function insertApiKey(key: ApiKey): Promise<ApiKey> {
  const client = getSupabaseRestClient();
  const metadata = {
    successCount: key.successCount,
    failCount: key.failCount,
    status: key.status,
    lastUsed: key.lastUsed ?? null,
  };

  const response = await client.post(
    '/api_keys',
    [
      {
        id: key.id,
        key_type: key.provider,
        key_name: key.name,
        encrypted_key: key.key,
        metadata,
      },
    ],
    {
      headers: {
        Prefer: 'return=representation',
      },
    }
  );

  const row = (Array.isArray(response.data) ? response.data[0] : null) as ApiKeyRow | null;
  if (!row) throw new Error(`Failed to insert ${key.provider} key in Supabase`);
  return rowToApiKey(row);
}

export async function patchApiKey(provider: ApiKey['provider'], id: string, values: Partial<ApiKey>): Promise<ApiKey | null> {
  const current = await getRow(provider, id);
  if (!current) return null;

  const metadata = {
    ...(current.metadata || {}),
    ...(values.successCount !== undefined ? { successCount: values.successCount } : {}),
    ...(values.failCount !== undefined ? { failCount: values.failCount } : {}),
    ...(values.status !== undefined ? { status: values.status } : {}),
    ...(values.lastUsed !== undefined ? { lastUsed: values.lastUsed } : {}),
  };

  const payload: Record<string, unknown> = {
    metadata,
  };

  if (values.name !== undefined) payload.key_name = values.name;
  if (values.key !== undefined) payload.encrypted_key = values.key;

  const client = getSupabaseRestClient();
  const response = await client.patch('/api_keys', payload, {
    params: {
      key_type: `eq.${provider}`,
      id: `eq.${id}`,
      select: 'id,key_type,key_name,encrypted_key,metadata,created_at,updated_at',
    },
    headers: {
      Prefer: 'return=representation',
    },
  });

  const row = (Array.isArray(response.data) ? response.data[0] : null) as ApiKeyRow | null;
  return row ? rowToApiKey(row) : null;
}

export async function deleteApiKey(provider: ApiKey['provider'], id: string): Promise<void> {
  const client = getSupabaseRestClient();
  await client.delete('/api_keys', {
    params: {
      key_type: `eq.${provider}`,
      id: `eq.${id}`,
    },
  });
}
