import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import crypto from 'crypto';
import { ApiKey } from '../../src/types';

type ApiKeyRow = {
  id: string;
  key_type: string;
  key_name: string | null;
  encrypted_key: string;
  metadata: Record<string, any> | null;
  created_at?: string;
  updated_at?: string;
};

type GenericKeyRow = {
  id: string;
  key_type: string;
  key_name: string | null;
  encrypted_key: string;
  updated_at?: string;
};

export type ConfigCredentialRow = {
  id: string;
  keyName: string;
  value: string;
  updatedAt?: string;
};

function getSupabaseConfigOrThrow() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    throw new Error('Supabase api_keys storage requires SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  }

  return { supabaseUrl, serviceKey };
}


function getSupabaseAgent() {
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  if (!proxyUrl) return undefined;
  return new HttpsProxyAgent(proxyUrl);
}

function getSupabaseRestClient() {
  const { supabaseUrl, serviceKey } = getSupabaseConfigOrThrow();
  const httpsAgent = getSupabaseAgent();

  return axios.create({
    baseURL: `${supabaseUrl}/rest/v1`,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    timeout: 30_000,
    httpsAgent,
    proxy: false,
  });
}

function rowToApiKey(row: ApiKeyRow): ApiKey {
  const metadata = row.metadata || {};
  return {
    id: row.id,
    provider: row.key_type as ApiKey['provider'],
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

export async function getKeyValueByTypeAndName(keyType: string, keyName: string): Promise<string | null> {
  const client = getSupabaseRestClient();
  const response = await client.get('/api_keys', {
    params: {
      key_type: `eq.${keyType}`,
      key_name: `eq.${keyName}`,
      select: 'id,key_type,key_name,encrypted_key',
      order: 'updated_at.desc',
      limit: 1,
    },
  });

  const rows = Array.isArray(response.data) ? response.data : [];
  const row = (rows[0] as GenericKeyRow | undefined) || null;
  return row?.encrypted_key || null;
}

export async function listConfigCredentialsByName(keyNames: string[]): Promise<ConfigCredentialRow[]> {
  if (!Array.isArray(keyNames) || keyNames.length === 0) return [];

  const client = getSupabaseRestClient();
  const response = await client.get('/api_keys', {
    params: {
      key_type: 'eq.config',
      select: 'id,key_type,key_name,encrypted_key,updated_at',
      key_name: `in.(${keyNames.map((k) => `"${k}"`).join(',')})`,
      order: 'updated_at.desc',
    },
  });

  const rows = Array.isArray(response.data) ? response.data : [];
  const deduped = new Map<string, ConfigCredentialRow>();

  for (const row of rows as GenericKeyRow[]) {
    const keyName = String(row.key_name || '').trim();
    if (!keyName || deduped.has(keyName)) continue;
    deduped.set(keyName, {
      id: row.id,
      keyName,
      value: row.encrypted_key,
      updatedAt: row.updated_at,
    });
  }

  return Array.from(deduped.values());
}

export async function upsertConfigCredential(keyName: string, value: string): Promise<void> {
  const existing = await getConfigCredentialRow(keyName);
  const client = getSupabaseRestClient();

  if (existing) {
    await client.patch(
      '/api_keys',
      { encrypted_key: value, updated_at: new Date().toISOString() },
      {
        params: {
          key_type: 'eq.config',
          key_name: `eq.${keyName}`,
        },
      }
    );
    return;
  }

  await client.post('/api_keys', [
    {
      id: crypto.randomUUID(),
      key_type: 'config',
      key_name: keyName,
      encrypted_key: value,
      metadata: {},
    },
  ]);
}

export async function deleteConfigCredential(keyName: string): Promise<void> {
  const client = getSupabaseRestClient();
  await client.delete('/api_keys', {
    params: {
      key_type: 'eq.config',
      key_name: `eq.${keyName}`,
    },
  });
}

async function getConfigCredentialRow(keyName: string): Promise<GenericKeyRow | null> {
  const client = getSupabaseRestClient();
  const response = await client.get('/api_keys', {
    params: {
      key_type: 'eq.config',
      key_name: `eq.${keyName}`,
      select: 'id,key_type,key_name,encrypted_key,updated_at',
      order: 'updated_at.desc',
      limit: 1,
    },
  });

  const rows = Array.isArray(response.data) ? response.data : [];
  return (rows[0] as GenericKeyRow | undefined) || null;
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
