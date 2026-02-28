import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { ApiKey, FacebookPage } from '../types';
import { Badge, Button, Card, Input, Label } from '../components/ui';

type Tab = 'keys' | 'facebook' | 'catbox';

type EditKeyState = {
  id: string;
  provider: ApiKey['provider'];
  name: string;
  key: string;
} | null;

type EditPageState = {
  id: string;
  name: string;
  accessToken: string;
} | null;

const providers: Array<{ id: ApiKey['provider']; title: string }> = [
  { id: 'cerebras', title: 'Cerebras API Keys' },
  { id: 'unrealspeech', title: 'UnrealSpeech API Keys' },
  { id: 'workers-ai', title: 'Cloudflare Workers AI Keys' },
];

export default function Settings() {
  const [tab, setTab] = useState<Tab>('keys');
  const [loading, setLoading] = useState(true);

  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [pages, setPages] = useState<FacebookPage[]>([]);
  const [catboxHash, setCatboxHash] = useState('');

  const [addProvider, setAddProvider] = useState<ApiKey['provider'] | null>(null);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyValue, setNewKeyValue] = useState('');
  const [editingKey, setEditingKey] = useState<EditKeyState>(null);

  const [facebookToken, setFacebookToken] = useState('');
  const [editingPage, setEditingPage] = useState<EditPageState>(null);

  useEffect(() => {
    void loadAll();
  }, []);

  async function loadAll() {
    setLoading(true);
    try {
      const [k1, k2, k3, fbPages, hash] = await Promise.all([
        api.getKeys('cerebras'),
        api.getKeys('unrealspeech'),
        api.getKeys('workers-ai'),
        api.getFacebookPages(),
        api.getCatboxHash(),
      ]);
      setKeys([...(k1 || []), ...(k2 || []), ...(k3 || [])]);
      setPages(Array.isArray(fbPages) ? fbPages : []);
      setCatboxHash(typeof hash === 'string' ? hash : '');
    } finally {
      setLoading(false);
    }
  }

  const grouped = useMemo(() => {
    return providers.map((p) => ({
      ...p,
      keys: keys.filter((k) => k.provider === p.id),
    }));
  }, [keys]);

  async function onAddKey(provider: ApiKey['provider']) {
    if (!newKeyValue.trim()) return;
    await api.addKey(provider, newKeyName.trim(), newKeyValue.trim());
    setNewKeyName('');
    setNewKeyValue('');
    setAddProvider(null);
    await loadAll();
  }

  async function onSaveKeyEdit() {
    if (!editingKey) return;
    await api.updateKey(editingKey.provider, editingKey.id, {
      name: editingKey.name,
      key: editingKey.key || undefined,
    });
    setEditingKey(null);
    await loadAll();
  }

  async function onDeleteKey(id: string, provider: ApiKey['provider']) {
    if (!confirm('Delete this key?')) return;
    await api.deleteKey(id, provider);
    await loadAll();
  }

  async function onConnectFacebook() {
    if (!facebookToken.trim()) return;
    await api.connectFacebook(facebookToken.trim());
    setFacebookToken('');
    await loadAll();
  }

  async function onSavePageEdit() {
    if (!editingPage) return;
    await api.updateFacebookPage(editingPage.id, {
      name: editingPage.name,
      accessToken: editingPage.accessToken,
    });
    setEditingPage(null);
    await loadAll();
  }

  async function onRefreshPage(id: string) {
    await api.refreshFacebookPage(id);
    await loadAll();
  }

  async function onRemovePage(id: string) {
    await api.removeFacebookPage(id);
    await loadAll();
  }

  async function onSaveCatbox() {
    await api.saveCatboxHash(catboxHash);
    await loadAll();
  }

  async function onDeleteCatbox() {
    if (!confirm('Delete Catbox hash?')) return;
    await api.deleteCatboxHash();
    await loadAll();
  }

  if (loading) return <div className="text-slate-500">Loading settings...</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-slate-500">Persistent provider, Facebook, and Catbox configuration.</p>
      </div>

      <div className="flex gap-2 overflow-x-auto">
        <Button variant={tab === 'keys' ? 'primary' : 'outline'} onClick={() => setTab('keys')}>API Keys</Button>
        <Button variant={tab === 'facebook' ? 'primary' : 'outline'} onClick={() => setTab('facebook')}>Facebook Pages</Button>
        <Button variant={tab === 'catbox' ? 'primary' : 'outline'} onClick={() => setTab('catbox')}>Catbox</Button>
      </div>

      {tab === 'keys' && (
        <div className="space-y-4">
          {grouped.map((group) => (
            <Card key={group.id} className="p-4 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <h3 className="font-semibold">{group.title}</h3>
                <Button variant="outline" onClick={() => setAddProvider(group.id)}>Add Key</Button>
              </div>

              {addProvider === group.id && (
                <div className="space-y-2 rounded-lg border p-3">
                  <Label>Key Label (optional)</Label>
                  <Input value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)} />
                  <Label>API Key Value</Label>
                  <Input type="password" value={newKeyValue} onChange={(e) => setNewKeyValue(e.target.value)} />
                  <div className="flex gap-2 justify-end">
                    <Button variant="ghost" onClick={() => setAddProvider(null)}>Cancel</Button>
                    <Button onClick={() => void onAddKey(group.id)}>Save</Button>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                {group.keys.length === 0 && <p className="text-sm text-slate-400">No keys configured.</p>}
                {group.keys.map((k) => (
                  <div key={k.id} className="border rounded-lg p-3 space-y-2">
                    <div className="flex justify-between gap-2 items-center">
                      <div className="font-medium">{k.name}</div>
                      <Badge variant={k.status === 'active' ? 'success' : 'default'}>{k.status}</Badge>
                    </div>
                    <div className="text-sm text-slate-600">
                      Success: {k.successCount} · Failure: {k.failCount} · Last used: {k.lastUsed || 'Never'}
                    </div>
                    <div className="flex gap-2 justify-end">
                      <Button
                        variant="outline"
                        onClick={() => setEditingKey({ id: k.id, provider: k.provider, name: k.name, key: '' })}
                      >
                        Edit
                      </Button>
                      <Button variant="danger" onClick={() => void onDeleteKey(k.id, k.provider)}>Delete</Button>
                    </div>

                    {editingKey && editingKey.id === k.id && (
                      <div className="space-y-2 border-t pt-2">
                        <Label>Edit Label</Label>
                        <Input
                          value={editingKey.name}
                          onChange={(e) => setEditingKey({ ...editingKey, name: e.target.value })}
                        />
                        <Label>Replace Key (optional)</Label>
                        <Input
                          type="password"
                          value={editingKey.key}
                          onChange={(e) => setEditingKey({ ...editingKey, key: e.target.value })}
                        />
                        <div className="flex gap-2 justify-end">
                          <Button variant="ghost" onClick={() => setEditingKey(null)}>Cancel</Button>
                          <Button onClick={() => void onSaveKeyEdit()}>Save</Button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}

      {tab === 'facebook' && (
        <div className="space-y-4">
          <Card className="p-4 space-y-2">
            <Label>Facebook Page Access Token</Label>
            <Input value={facebookToken} onChange={(e) => setFacebookToken(e.target.value)} />
            <Button onClick={() => void onConnectFacebook()}>Connect</Button>
          </Card>

          <Card className="p-4 space-y-2">
            <h3 className="font-semibold">Connected Pages</h3>
            {pages.length === 0 && <p className="text-sm text-slate-400">No pages connected.</p>}
            {pages.map((p) => (
              <div key={p.id} className="border rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="font-medium">{p.name}</div>
                    <div className="text-sm font-mono text-slate-500">{p.id}</div>
                  </div>
                  <Badge variant={p.status === 'valid' ? 'success' : 'error'}>{p.status}</Badge>
                </div>
                <div className="text-xs text-slate-500">Last checked: {p.lastChecked}</div>
                <div className="flex gap-2 justify-end">
                  <Button variant="outline" onClick={() => void onRefreshPage(p.id)}>Refresh</Button>
                  <Button variant="outline" onClick={() => setEditingPage({ id: p.id, name: p.name, accessToken: p.accessToken })}>Edit</Button>
                  <Button variant="danger" onClick={() => void onRemovePage(p.id)}>Remove</Button>
                </div>

                {editingPage && editingPage.id === p.id && (
                  <div className="space-y-2 border-t pt-2">
                    <Label>Page Name</Label>
                    <Input
                      value={editingPage.name}
                      onChange={(e) => setEditingPage({ ...editingPage, name: e.target.value })}
                    />
                    <Label>Page Token</Label>
                    <Input
                      value={editingPage.accessToken}
                      onChange={(e) => setEditingPage({ ...editingPage, accessToken: e.target.value })}
                    />
                    <div className="flex gap-2 justify-end">
                      <Button variant="ghost" onClick={() => setEditingPage(null)}>Cancel</Button>
                      <Button onClick={() => void onSavePageEdit()}>Save</Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </Card>
        </div>
      )}

      {tab === 'catbox' && (
        <Card className="p-4 space-y-2 max-w-2xl">
          <Label>Catbox User Hash</Label>
          <Input type="password" value={catboxHash} onChange={(e) => setCatboxHash(e.target.value)} />
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => void onDeleteCatbox()}>Delete</Button>
            <Button onClick={() => void onSaveCatbox()}>Save</Button>
          </div>
        </Card>
      )}
    </div>
  );
}
