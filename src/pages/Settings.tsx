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
import { Card, Button, Input, Label, Badge } from '../components/ui';
import { formatDate, cn } from '../lib/utils';

type TabId = 'keys' | 'facebook' | 'catbox' | 'system';

export default function Settings() {
  const [activeTab, setActiveTab] = useState<TabId>('keys');
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [pages, setPages] = useState<FacebookPage[]>([]);
  const [catboxHash, setCatboxHash] = useState('');
  const [loading, setLoading] = useState(true);

  const [addingKeyFor, setAddingKeyFor] = useState<ApiKey['provider'] | null>(null);
  const [newTokenName, setNewTokenName] = useState('');
  const [newTokenValue, setNewTokenValue] = useState('');

  const [editingKey, setEditingKey] = useState<{ id: string; provider: ApiKey['provider'] } | null>(null);
  const [editTokenName, setEditTokenName] = useState('');
  const [editTokenValue, setEditTokenValue] = useState('');

  const [fbToken, setFbToken] = useState('');
  const [editingPageId, setEditingPageId] = useState<string | null>(null);
  const [editPageName, setEditPageName] = useState('');
  const [editPageToken, setEditPageToken] = useState('');

  const [showCatboxHash, setShowCatboxHash] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [k1, k2, k3, p, h] = await Promise.all([
        api.getKeys('cerebras'),
        api.getKeys('unrealspeech'),
        api.getKeys('workers-ai'),
        api.getFacebookPages(),
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
  };

  const handleAddKey = async (provider: ApiKey['provider']) => {
    if (!newTokenValue.trim()) return;
    await api.addKey(provider, newTokenName, newTokenValue);
    setNewTokenName('');
    setNewTokenValue('');
    setAddingKeyFor(null);
    await loadData();
  };

  const startEditKey = (key: ApiKey) => {
    setEditingKey({ id: key.id, provider: key.provider });
    setEditTokenName(key.name);
    setEditTokenValue('');
  };

  const saveEditKey = async () => {
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

  const handleDeleteKey = async (id: string, provider: ApiKey['provider']) => {
    if (!confirm('Delete this API key?')) return;
    await api.deleteKey(id, provider);
    await loadData();
  };

  const handleConnectFB = async () => {
    if (!fbToken.trim()) return;
    await api.connectFacebook(fbToken.trim());
    setFbToken('');
    await loadData();
  };

  const startEditPage = (page: FacebookPage) => {
    setEditingPageId(page.id);
    setEditPageName(page.name);
    setEditPageToken(page.accessToken);
  };

  const savePageEdit = async () => {
    if (!editingPageId) return;
    await api.updateFacebookPage(editingPageId, {
      name: editPageName,
      accessToken: editPageToken,
    });
    setEditingPageId(null);
    setEditPageName('');
    setEditPageToken('');
    await loadData();
  };

  const removePage = async (id: string) => {
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
    );
  };

  if (loading) return <div className="text-slate-500">Loading settings...</div>;

  return (
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
    </div>
  );
}
