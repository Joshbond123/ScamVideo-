import React, { useEffect, useMemo, useState } from 'react';
import { Box, Eye, EyeOff, Facebook, Key, Pencil, Plus, RefreshCw, Save, Trash2, X } from 'lucide-react';
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

const providers: Array<{ id: ApiKey['provider']; title: string; description: string }> = [
  { id: 'cerebras', title: 'Cerebras Keys', description: 'Used for script generation.' },
  { id: 'unrealspeech', title: 'UnrealSpeech Keys', description: 'Used for voice generation.' },
  { id: 'workers-ai', title: 'Workers AI Keys', description: 'Used for image generation.' },
];

export default function Settings() {
  const [tab, setTab] = useState<Tab>('keys');
  const [loading, setLoading] = useState(true);

  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [pages, setPages] = useState<FacebookPage[]>([]);
  const [catboxHash, setCatboxHash] = useState('');
  const [showCatboxHash, setShowCatboxHash] = useState(false);

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
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }

  const grouped = useMemo(
    () => providers.map((provider) => ({ ...provider, keys: keys.filter((k) => k.provider === provider.id) })),
    [keys]
  );

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
    if (!confirm('Remove this page?')) return;
    await api.removeFacebookPage(id);
    await loadAll();
  }

  async function onSaveCatbox() {
    await api.saveCatboxHash(catboxHash.trim());
    await loadAll();
  }

  async function onDeleteCatbox() {
    if (!confirm('Delete Catbox hash?')) return;
    await api.deleteCatboxHash();
    await loadAll();
  }

  if (loading) return <div className="text-slate-500">Loading settings...</div>;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
        <p className="text-slate-500">Configure API keys, Facebook pages, and Catbox storage.</p>
      </div>

      <div className="flex items-center gap-2 p-1 bg-slate-100 rounded-xl w-fit">
        <button
          onClick={() => setTab('keys')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
            tab === 'keys' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Key className="w-4 h-4" /> API Keys
        </button>
        <button
          onClick={() => setTab('facebook')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
            tab === 'facebook' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Facebook className="w-4 h-4" /> Facebook
        </button>
        <button
          onClick={() => setTab('catbox')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
            tab === 'catbox' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Box className="w-4 h-4" /> Catbox
        </button>
      </div>

      {tab === 'keys' && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {grouped.map((group) => (
            <Card key={group.id} className="p-5 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-slate-900">{group.title}</h3>
                  <p className="text-xs text-slate-500">{group.description}</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => setAddProvider(group.id)}>
                  <Plus className="w-4 h-4 mr-1" /> Add
                </Button>
              </div>

              {addProvider === group.id && (
                <div className="space-y-2 p-3 rounded-lg bg-slate-50 border">
                  <Label>Key Label</Label>
                  <Input value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)} placeholder="Optional label" />
                  <Label>API Key</Label>
                  <Input value={newKeyValue} onChange={(e) => setNewKeyValue(e.target.value)} placeholder="Paste key" type="password" />
                  <div className="flex gap-2 justify-end">
                    <Button variant="ghost" size="sm" onClick={() => setAddProvider(null)}>Cancel</Button>
                    <Button size="sm" onClick={() => void onAddKey(group.id)}>Save</Button>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                {group.keys.length === 0 ? (
                  <p className="text-sm text-slate-400">No keys added for {group.title}.</p>
                ) : (
                  group.keys.map((k) => (
                    <div key={k.id} className="rounded-lg border p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-sm">{k.name}</span>
                        <Badge variant={k.status === 'active' ? 'success' : 'default'}>{k.status}</Badge>
                      </div>

                      {editingKey?.id === k.id ? (
                        <div className="space-y-2">
                          <Input
                            value={editingKey.name}
                            onChange={(e) => setEditingKey({ ...editingKey, name: e.target.value })}
                            placeholder="Name"
                          />
                          <Input
                            value={editingKey.key}
                            onChange={(e) => setEditingKey({ ...editingKey, key: e.target.value })}
                            placeholder="Optional replacement key"
                            type="password"
                          />
                          <div className="flex gap-2 justify-end">
                            <Button variant="ghost" size="sm" onClick={() => setEditingKey(null)}>
                              <X className="w-4 h-4 mr-1" /> Cancel
                            </Button>
                            <Button size="sm" onClick={() => void onSaveKeyEdit()}>
                              <Save className="w-4 h-4 mr-1" /> Save
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex gap-2 justify-end">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setEditingKey({ id: k.id, provider: k.provider, name: k.name, key: '' })}
                          >
                            <Pencil className="w-4 h-4 mr-1" /> Edit
                          </Button>
                          <Button variant="outline" size="sm" className="text-red-600" onClick={() => void onDeleteKey(k.id, k.provider)}>
                            <Trash2 className="w-4 h-4 mr-1" /> Delete
                          </Button>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {tab === 'facebook' && (
        <div className="space-y-6">
          <Card className="p-5 space-y-3 max-w-2xl">
            <Label>Facebook User Access Token</Label>
            <Input value={facebookToken} onChange={(e) => setFacebookToken(e.target.value)} placeholder="Paste user token" />
            <Button onClick={() => void onConnectFacebook()}>Connect and Fetch Pages</Button>
          </Card>

          <Card className="p-5 space-y-3">
            <h3 className="font-semibold">Connected Pages</h3>
            {pages.length === 0 ? (
              <p className="text-sm text-slate-500">No pages connected yet.</p>
            ) : (
              pages.map((p) => (
                <div key={p.id} className="rounded-lg border p-3 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-medium">{p.name}</div>
                      <div className="text-xs font-mono text-slate-500">{p.id}</div>
                    </div>
                    <Badge variant={p.status === 'valid' ? 'success' : 'error'}>{p.status}</Badge>
                  </div>

                  {editingPage?.id === p.id ? (
                    <div className="space-y-2">
                      <Input
                        value={editingPage.name}
                        onChange={(e) => setEditingPage({ ...editingPage, name: e.target.value })}
                        placeholder="Page name"
                      />
                      <Input
                        value={editingPage.accessToken}
                        onChange={(e) => setEditingPage({ ...editingPage, accessToken: e.target.value })}
                        placeholder="Page access token"
                      />
                      <div className="flex gap-2 justify-end">
                        <Button variant="ghost" size="sm" onClick={() => setEditingPage(null)}>Cancel</Button>
                        <Button size="sm" onClick={() => void onSavePageEdit()}>Save</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-2 justify-end">
                      <Button variant="outline" size="sm" onClick={() => void onRefreshPage(p.id)}>
                        <RefreshCw className="w-4 h-4 mr-1" /> Refresh
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setEditingPage({ id: p.id, name: p.name, accessToken: p.accessToken })}>
                        <Pencil className="w-4 h-4 mr-1" /> Edit
                      </Button>
                      <Button variant="outline" size="sm" className="text-red-600" onClick={() => void onRemovePage(p.id)}>
                        <Trash2 className="w-4 h-4 mr-1" /> Remove
                      </Button>
                    </div>
                  )}
                </div>
              ))
            )}
          </Card>
        </div>
      )}

      {tab === 'catbox' && (
        <Card className="p-5 space-y-3 max-w-2xl">
          <Label>Catbox User Hash</Label>
          <div className="relative">
            <Input
              type={showCatboxHash ? 'text' : 'password'}
              value={catboxHash}
              onChange={(e) => setCatboxHash(e.target.value)}
              placeholder="Paste Catbox userhash"
              className="pr-10"
            />
            <button
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500"
              onClick={() => setShowCatboxHash((s) => !s)}
              type="button"
            >
              {showCatboxHash ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => void onDeleteCatbox()}>Delete</Button>
            <Button onClick={() => void onSaveCatbox()}>Save</Button>
          </div>
        </Card>
      )}
    </div>
  );
}
