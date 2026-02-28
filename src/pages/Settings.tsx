import React, { useEffect, useMemo, useState } from 'react';
import React, { useEffect, useState } from 'react';
import {
  Key,
  Facebook,
  Box,
  Settings as SettingsIcon,
  Plus,
  Trash2,
  RefreshCw,
  Save,
  Pencil,
  Eye,
  EyeOff,
  X,
} from 'lucide-react';
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

type TabId = 'keys' | 'facebook' | 'catbox' | 'system';

export default function Settings() {
  const [tab, setTab] = useState<Tab>('keys');
  const [loading, setLoading] = useState(true);

  const [activeTab, setActiveTab] = useState<TabId>('keys');
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [pages, setPages] = useState<FacebookPage[]>([]);
  const [catboxHash, setCatboxHash] = useState('');

  const [addProvider, setAddProvider] = useState<ApiKey['provider'] | null>(null);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyValue, setNewKeyValue] = useState('');
  const [editingKey, setEditingKey] = useState<EditKeyState>(null);

  const [facebookToken, setFacebookToken] = useState('');
  const [editingPage, setEditingPage] = useState<EditPageState>(null);
  const [addingKeyFor, setAddingKeyFor] = useState<ApiKey['provider'] | null>(null);
  const [newTokenName, setNewTokenName] = useState('');
  const [newTokenValue, setNewTokenValue] = useState('');

  const [editingKey, setEditingKey] = useState<{ id: string; provider: ApiKey['provider'] } | null>(null);
  const [editTokenName, setEditTokenName] = useState('');
  const [editTokenValue, setEditTokenValue] = useState('');

  const [editingKey, setEditingKey] = useState<{ id: string; provider: ApiKey['provider'] } | null>(null);
  const [editTokenName, setEditTokenName] = useState('');
  const [editTokenValue, setEditTokenValue] = useState('');
  const [fbToken, setFbToken] = useState('');
  const [editingPageId, setEditingPageId] = useState<string | null>(null);
  const [editPageName, setEditPageName] = useState('');
  const [editPageToken, setEditPageToken] = useState('');

  const [showCatboxHash, setShowCatboxHash] = useState(false);

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
        api.getCatboxHash()
      ]);
      setKeys([...(k1 || []), ...(k2 || []), ...(k3 || [])]);
      setPages(Array.isArray(p) ? p : []);
      setCatboxHash(typeof h === 'string' ? h : '');
    } catch (error) {
      console.error(error);
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
  const handleAddKey = async (provider: ApiKey['provider']) => {
    if (!newTokenValue.trim()) return;
    await api.addKey(provider, newTokenName, newTokenValue);
    setNewTokenName('');
    setNewTokenValue('');
    setAddingKeyFor(null);
    await loadData();
  };

  const startEditKey = (key: ApiKey) => {
  const startEdit = (key: ApiKey) => {
    setEditingKey({ id: key.id, provider: key.provider });
    setEditTokenName(key.name);
    setEditTokenValue('');
  };
  const saveEditKey = async () => {
  const handleSaveEdit = async () => {
    if (!editingKey) return;
    await api.updateKey(editingKey.provider, editingKey.id, {
      name: editTokenName,
      key: editTokenValue || undefined,
    });
    setEditingKey(null);
    setEditTokenName('');
    setEditTokenValue('');
    await loadData();
  };

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
    await loadData();
  };

  const handleConnectFB = async () => {
    if (!fbToken.trim()) return;
    await api.connectFacebook(fbToken.trim());
    setFbToken('');
    await loadData();
  };

  const handleRemovePage = async (id: string) => {
    await api.removeFacebookPage(id);
    await loadData();
  };

  const refreshPage = async (id: string) => {
    await api.refreshFacebookPage(id);
    await loadData();
  };

  const saveCatboxHash = async () => {
    await api.saveCatboxHash(catboxHash.trim());
    await loadData();
  };

  const deleteCatboxHash = async () => {
    if (!confirm('Delete Catbox hash?')) return;
    await api.deleteCatboxHash();
    await loadData();
  const handleRefreshPage = async (id: string) => {
    await api.refreshFacebookPage(id);
    await loadData();
  };

  const handleSaveCatbox = async () => {
    await api.saveCatboxHash(catboxHash.trim());
    alert('Catbox hash saved!');
  };

  const KeySection = ({ title, provider, description }: { title: string; provider: ApiKey['provider']; description: string }) => {
    const providerKeys = keys.filter(k => k.provider === provider);
    const isAdding = addingKeyFor === provider;

    return (
      <Card className="p-4 md:p-6 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-lg font-bold text-slate-900">{title}</h3>
            <p className="text-sm text-slate-500">{description}</p>
          </div>
          {!isAdding && (
            <Button variant="outline" onClick={() => setAddingKeyFor(provider)}>
              <Plus className="w-4 h-4 mr-2" />
              Add Key
            </Button>
          )}
        </div>

        {isAdding && (
          <div className="grid grid-cols-1 gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200">
            <div className="space-y-1">
              <Label>Key Label (optional)</Label>
              <Input value={newTokenName} onChange={(e) => setNewTokenName(e.target.value)} placeholder="e.g. Key #3" />
            </div>
            <div className="space-y-1">
              <Label>API Key Value</Label>
              <Input type="password" value={newTokenValue} onChange={(e) => setNewTokenValue(e.target.value)} placeholder="Enter key value" />
          <Card className="p-4 bg-slate-50 border-indigo-100">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div className="space-y-2">
                <Label>Key Label (optional)</Label>
                <Input
                  placeholder="e.g. Key #3"
                  value={newTokenName}
                  onChange={e => setNewTokenName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>API Key Value</Label>
                <Input
                  type="password"
                  placeholder="Enter API Key..."
                  value={newTokenValue}
                  onChange={e => setNewTokenValue(e.target.value)}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => {
                setAddingKeyFor(null);
                setNewTokenName('');
                setNewTokenValue('');
              }}>Cancel</Button>
              <Button size="sm" onClick={() => handleAddKey(provider)}>Save Key</Button>
            </div>
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
              <Button variant="ghost" onClick={() => setAddingKeyFor(null)}>Cancel</Button>
              <Button onClick={() => handleAddKey(provider)}>Save</Button>
            </div>
          </div>
        )}

        <div className="space-y-3">
          {providerKeys.length === 0 ? (
            <p className="text-sm italic text-slate-400">No keys configured yet.</p>
          ) : providerKeys.map((key) => {
            const isEditing = editingKey?.id === key.id;
            return (
              <div key={key.id} className="rounded-xl border border-slate-200 p-3 md:p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Badge variant={key.status === 'active' ? 'success' : 'default'}>{key.status}</Badge>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="icon" onClick={() => startEditKey(key)}><Pencil className="w-4 h-4" /></Button>
                    <Button variant="ghost" size="icon" className="text-red-500" onClick={() => handleDeleteKey(key.id, provider)}><Trash2 className="w-4 h-4" /></Button>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                  <div><span className="text-slate-500">Label:</span> <span className="font-medium">{key.name}</span></div>
                  <div><span className="text-slate-500">Last used:</span> {key.lastUsed ? formatDate(key.lastUsed) : 'Never'}</div>
                  <div><span className="text-slate-500">Success:</span> <span className="text-emerald-600 font-semibold">{key.successCount}</span></div>
                  <div><span className="text-slate-500">Failure:</span> <span className="text-red-600 font-semibold">{key.failCount}</span></div>
                </div>

                {isEditing && (
                  <div className="mt-3 grid grid-cols-1 gap-2">
                    <Input value={editTokenName} onChange={(e) => setEditTokenName(e.target.value)} placeholder="Label" />
                    <Input type="password" value={editTokenValue} onChange={(e) => setEditTokenValue(e.target.value)} placeholder="Optional replacement key" />
                    <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
                      <Button variant="ghost" onClick={() => setEditingKey(null)}>Cancel</Button>
                      <Button onClick={saveEditKey}>Save Changes</Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>
        <Card className="p-0">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50/50 text-slate-500 text-xs uppercase tracking-wider">
                <th className="px-6 py-3 font-semibold">Label</th>
                <th className="px-6 py-3 font-semibold">Last Used</th>
                <th className="px-6 py-3 font-semibold">Success/Fail</th>
                <th className="px-6 py-3 font-semibold">Status</th>
                <th className="px-6 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {providerKeys.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-slate-400 text-sm italic">
                    No keys added for {title}.
                  </td>
                </tr>
              ) : (
                providerKeys.map(k => {
                  const isEditing = editingKey?.id === k.id;
                  return (
                    <tr key={k.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-6 py-4 font-medium text-slate-900">
                        {isEditing ? (
                          <Input value={editTokenName} onChange={(e) => setEditTokenName(e.target.value)} />
                        ) : k.name}
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-500">{k.lastUsed ? formatDate(k.lastUsed) : 'Never'}</td>
                      <td className="px-6 py-4 text-sm">
                        <span className="text-emerald-600 font-medium">{k.successCount}</span>
                        <span className="mx-1 text-slate-400">/</span>
                        <span className="text-red-600 font-medium">{k.failCount}</span>
                      </td>
                      <td className="px-6 py-4">
                        <Badge variant={k.status === 'active' ? 'success' : 'default'}>{k.status}</Badge>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="inline-flex gap-2">
                          {isEditing ? (
                            <>
                              <Input
                                type="password"
                                className="max-w-52"
                                value={editTokenValue}
                                onChange={(e) => setEditTokenValue(e.target.value)}
                                placeholder="Optional new key value"
                              />
                              <Button size="sm" onClick={handleSaveEdit}>Save</Button>
                              <Button variant="ghost" size="sm" onClick={() => setEditingKey(null)}>Cancel</Button>
                            </>
                          ) : (
                            <>
                              <Button variant="ghost" size="icon" onClick={() => startEdit(k)}>
                                <Pencil className="w-4 h-4" />
                              </Button>
                              <Button variant="ghost" size="icon" className="text-red-500" onClick={() => handleDeleteKey(k.id, provider)}>
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </Card>
      </div>
    );
  };

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
    <div className="space-y-6 md:space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">System Settings</h1>
        <p className="text-slate-500">Fully persistent configuration for providers, Facebook pages, and Catbox.</p>
      </div>

      <div className="flex items-center gap-2 p-1 bg-slate-100 rounded-xl overflow-x-auto">
        {[
          { id: 'keys', icon: Key, label: 'API Keys' },
          { id: 'facebook', icon: Facebook, label: 'Facebook Pages' },
          { id: 'catbox', icon: Box, label: 'Catbox' },
          { id: 'system', icon: SettingsIcon, label: 'System' },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as TabId)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold whitespace-nowrap',
              'flex items-center gap-2 px-4 md:px-6 py-2 rounded-lg text-sm font-semibold transition-all shrink-0',
              activeTab === tab.id ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            )}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'keys' && (
        <div className="space-y-4 md:space-y-6">
          <KeySection title="Cerebras Keys" provider="cerebras" description="Used for script generation" />
          <KeySection title="UnrealSpeech Keys" provider="unrealspeech" description="Used for voice generation" />
          <KeySection title="Workers AI Keys" provider="workers-ai" description="Used for image generation" />
        </div>
      )}

      {activeTab === 'facebook' && (
        <div className="space-y-4 md:space-y-6">
          <Card className="p-4 md:p-6 space-y-3">
            <Label>Facebook Page Access Token</Label>
            <Input placeholder="Paste token" value={fbToken} onChange={(e) => setFbToken(e.target.value)} />
            <Button onClick={handleConnectFB} className="w-full sm:w-auto">
              Connect
              <Plus className="w-4 h-4 ml-2" />
            </Button>
          </Card>

          <Card className="p-4 md:p-6 space-y-3">
            <h3 className="text-lg font-bold text-slate-900">Connected Pages</h3>
            {pages.length === 0 ? <p className="text-sm text-slate-400">No pages connected.</p> : pages.map((p) => {
              const isEditing = editingPageId === p.id;
              return (
                <div key={p.id} className="rounded-xl border border-slate-200 p-3 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Badge variant={p.status === 'valid' ? 'success' : 'error'}>{p.status}</Badge>
                    <div className="flex items-center gap-2">
                      <Button variant="ghost" size="icon" onClick={() => refreshPage(p.id)} title="Refresh status"><RefreshCw className="w-4 h-4" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => startEditPage(p)} title="Edit"><Pencil className="w-4 h-4" /></Button>
                      <Button variant="ghost" size="icon" className="text-red-500" onClick={() => removePage(p.id)} title="Remove"><Trash2 className="w-4 h-4" /></Button>
                    </div>
                  </div>
                  <div className="text-sm"><span className="text-slate-500">Name:</span> {p.name}</div>
                  <div className="text-sm"><span className="text-slate-500">Page ID:</span> <span className="font-mono">{p.id}</span></div>
                  <div className="text-sm"><span className="text-slate-500">Last checked:</span> {formatDate(p.lastChecked)}</div>

                  {isEditing && (
                    <div className="space-y-2 pt-2">
                      <Input value={editPageName} onChange={(e) => setEditPageName(e.target.value)} placeholder="Page name" />
                      <Input value={editPageToken} onChange={(e) => setEditPageToken(e.target.value)} placeholder="Page access token" />
                      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
                        <Button variant="ghost" onClick={() => setEditingPageId(null)}><X className="w-4 h-4 mr-1" />Cancel</Button>
                        <Button onClick={savePageEdit}><Save className="w-4 h-4 mr-1" />Save</Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </Card>
        </div>
      )}

      {activeTab === 'catbox' && (
        <Card className="p-4 md:p-6 space-y-4 max-w-2xl">
          <div className="space-y-1">
            <Label>Catbox User Hash</Label>
            <div className="flex gap-2">
              <Input
                type={showCatboxHash ? 'text' : 'password'}
                placeholder="Enter Catbox hash"
                value={catboxHash}
                onChange={(e) => setCatboxHash(e.target.value)}
              />
              <Button variant="outline" size="icon" onClick={() => setShowCatboxHash((v) => !v)}>
                {showCatboxHash ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </Button>
            </div>
            <p className="text-xs text-slate-500">Stored persistently and used by the upload pipeline.</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 sm:justify-end">
            <Button variant="outline" className="text-red-600" onClick={deleteCatboxHash}>
              <Trash2 className="w-4 h-4 mr-2" />Delete
            </Button>
            <Button onClick={saveCatboxHash}><Save className="w-4 h-4 mr-2" />Save</Button>
          </div>
        </Card>
      )}

      {activeTab === 'system' && (
        <Card className="p-4 md:p-6 text-slate-600">
          Scheduler and providers are configured from other tabs and persist in file-based storage.
        </Card>
      )}
      <div className="space-y-12">
        {activeTab === 'keys' && (
          <div className="space-y-12">
            <KeySection title="Cerebras Keys" provider="cerebras" description="Used for high-speed LLM content generation." />
            <KeySection title="UnrealSpeech Keys" provider="unrealspeech" description="Used for realistic AI voiceover generation." />
            <KeySection title="Workers AI Keys" provider="workers-ai" description="Cloudflare Workers AI for image generation." />
          </div>
        )}

        {activeTab === 'facebook' && (
          <div className="space-y-8">
            <Card className="p-6">
              <h3 className="text-lg font-bold text-slate-900 mb-4">Connect New Pages</h3>
              <div className="flex flex-col md:flex-row gap-4">
                <div className="flex-1 space-y-2">
                  <Label>Facebook Page Access Token</Label>
                  <Input
                    placeholder="Enter your Facebook Page Access Token..."
                    value={fbToken}
                    onChange={e => setFbToken(e.target.value)}
                  />
                </div>
                <Button className="w-full md:w-auto h-10 self-end" onClick={handleConnectFB}>
                  Connect
                  <Plus className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </Card>

            <div className="space-y-4">
              <h3 className="text-lg font-bold text-slate-900">Connected Pages</h3>
              <Card className="p-0">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-slate-50/50 text-slate-500 text-xs uppercase tracking-wider">
                      <th className="px-6 py-3 font-semibold">Page Name</th>
                      <th className="px-6 py-3 font-semibold">Page ID</th>
                      <th className="px-6 py-3 font-semibold">Token Status</th>
                      <th className="px-6 py-3 font-semibold">Last Checked</th>
                      <th className="px-6 py-3 font-semibold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {pages.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-6 py-8 text-center text-slate-400">No Facebook pages connected.</td>
                      </tr>
                    ) : pages.map(p => (
                      <tr key={p.id}>
                        <td className="px-6 py-4">{p.name}</td>
                        <td className="px-6 py-4 font-mono text-sm">{p.id}</td>
                        <td className="px-6 py-4">
                          <Badge variant={p.status === 'valid' ? 'success' : 'error'}>{p.status}</Badge>
                        </td>
                        <td className="px-6 py-4 text-sm">{formatDate(p.lastChecked)}</td>
                        <td className="px-6 py-4 text-right">
                          <div className="inline-flex gap-2">
                            <Button variant="ghost" size="icon" onClick={() => handleRefreshPage(p.id)} title="Refresh Status">
                              <RefreshCw className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="icon" className="text-red-500" onClick={() => handleRemovePage(p.id)} title="Remove">
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </div>
          </div>
        )}

        {activeTab === 'catbox' && (
          <div className="max-w-2xl">
            <Card className="p-6 space-y-4">
              <div className="space-y-2">
                <Label>Catbox User Hash</Label>
                <Input
                  type="password"
                  placeholder="Enter your Catbox hash..."
                  value={catboxHash}
                  onChange={e => setCatboxHash(e.target.value)}
                />
              </div>
              <Button className="w-full" onClick={handleSaveCatbox}>
                <Save className="w-4 h-4 mr-2" />
                Save
              </Button>
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
        {activeTab === 'system' && (
          <Card className="p-6 text-slate-600">
            <p>System settings are available. Use API Keys, Facebook, and Catbox tabs for core deployable configuration.</p>
          </Card>
        )}
      </div>
    </div>
  );
}
