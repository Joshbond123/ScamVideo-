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

  const startEdit = (key: ApiKey) => {
    setEditingKey({ id: key.id, provider: key.provider });
    setEditTokenName(key.name);
    setEditTokenValue('');
  };

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

  const handleRemovePage = async (id: string) => {
    await api.removeFacebookPage(id);
    await loadData();
  };

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
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold text-slate-900">{title}</h3>
            <p className="text-sm text-slate-500">{description}</p>
          </div>
          {!isAdding && (
            <Button variant="outline" size="sm" className="w-full sm:w-auto" onClick={() => setAddingKeyFor(provider)}>
              <Plus className="w-4 h-4 mr-2" />
              Add Key
            </Button>
          )}
        </div>

        {isAdding && (
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
          </Card>
        )}

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
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">System Settings</h1>
        <p className="text-slate-500">Manage your API integrations, social accounts, and automation preferences.</p>
      </div>

      <div className="flex items-center gap-2 p-1 bg-slate-100 rounded-xl w-full overflow-x-auto whitespace-nowrap scrollbar-hide">
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
              'flex items-center gap-2 px-4 md:px-6 py-2 rounded-lg text-sm font-semibold transition-all shrink-0',
              activeTab === tab.id ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            )}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

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
          </div>
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
