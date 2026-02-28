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
  ShieldCheck,
  AlertCircle,
  ExternalLink
} from 'lucide-react';
import { api } from '../lib/api';
import { ApiKey, FacebookPage } from '../types';
import { Card, Button, Input, Label, Badge } from '../components/ui';
import { formatDate, cn } from '../lib/utils';

export default function Settings() {
  const [activeTab, setActiveTab] = useState<'keys' | 'facebook' | 'catbox' | 'system'>('keys');
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [pages, setPages] = useState<FacebookPage[]>([]);
  const [catboxHash, setCatboxHash] = useState('');
  const [loading, setLoading] = useState(true);

  const [addingKeyFor, setAddingKeyFor] = useState<ApiKey['provider'] | null>(null);
  const [newTokenName, setNewTokenName] = useState('');
  const [newTokenValue, setNewTokenValue] = useState('');
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
      setKeys([
        ...(Array.isArray(k1) ? k1 : []),
        ...(Array.isArray(k2) ? k2 : []),
        ...(Array.isArray(k3) ? k3 : [])
      ]);
      setPages(Array.isArray(p) ? p : []);
      setCatboxHash(typeof h === 'string' ? h : '');
    } catch (err) {
      console.error(err);
      setKeys([]);
      setPages([]);
    } finally {
      setLoading(false);
    }
  };

  const handleAddKey = async (provider: ApiKey['provider']) => {
    if (!newTokenName || !newTokenValue) return;
    await api.addKey(provider, newTokenName, newTokenValue);
    setNewTokenName('');
    setNewTokenValue('');
    loadData();
  };

  const handleDeleteKey = async (id: string, provider: ApiKey['provider']) => {
    if (!confirm('Delete this API key?')) return;
    await api.deleteKey(id, provider);
    loadData();
  };

  const handleConnectFB = async () => {
    if (!fbToken) return;
    await api.connectFacebook(fbToken);
    setFbToken('');
    loadData();
  };

  const handleSaveCatbox = async () => {
    await api.saveCatboxHash(catboxHash);
    alert('Catbox hash saved!');
  };

  const KeySection = ({ title, provider, description }: { title: string, provider: ApiKey['provider'], description: string }) => {
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
                <Label>Key Label</Label>
                <Input 
                  placeholder="e.g. Primary Key" 
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
              <Button size="sm" onClick={async () => {
                if (newTokenName && newTokenValue) {
                  await api.addKey(provider, newTokenName, newTokenValue);
                  setNewTokenName('');
                  setNewTokenValue('');
                  setAddingKeyFor(null);
                  loadData();
                }
              }}>Save Key</Button>
            </div>
          </Card>
        )}
        
        {/* Desktop Table */}
        <Card className="hidden md:block p-0">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50/50 text-slate-500 text-xs uppercase tracking-wider">
                <th className="px-6 py-3 font-semibold">Label</th>
                <th className="px-6 py-3 font-semibold">Last Used</th>
                <th className="px-6 py-3 font-semibold">Success/Fail</th>
                <th className="px-6 py-3 font-semibold">Usage</th>
                <th className="px-6 py-3 font-semibold">Status</th>
                <th className="px-6 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {providerKeys.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-slate-400 text-sm italic">
                    No keys added for {title}.
                  </td>
                </tr>
              ) : (
                providerKeys.map(k => (
                  <tr key={k.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-6 py-4 font-medium text-slate-900">{k.name}</td>
                    <td className="px-6 py-4 text-sm text-slate-500">{k.lastUsed ? formatDate(k.lastUsed) : 'Never'}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <span className="text-emerald-600 font-medium">{k.successCount}</span>
                        <span className="text-slate-300">/</span>
                        <span className="text-red-600 font-medium">{k.failCount}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="w-24 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-indigo-500" 
                          style={{ width: `${Math.min(100, ((k.successCount + k.failCount) / 100) * 100)}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-slate-400 mt-1 block">{k.successCount + k.failCount} requests</span>
                    </td>
                    <td className="px-6 py-4">
                      <Badge variant={k.status === 'active' ? 'success' : 'default'}>{k.status}</Badge>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Button variant="ghost" size="icon" className="text-red-500" onClick={() => handleDeleteKey(k.id, provider)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Card>

        {/* Mobile List */}
        <div className="md:hidden space-y-3">
          {providerKeys.length === 0 ? (
            <Card className="p-8 text-center text-slate-400 text-sm italic">
              No keys added for {title}.
            </Card>
          ) : (
            providerKeys.map(k => (
              <Card key={k.id} className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-900">{k.name}</span>
                  <Badge variant={k.status === 'active' ? 'success' : 'default'}>{k.status}</Badge>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="text-slate-500">Last Used:</div>
                  <div className="text-slate-900">{k.lastUsed ? formatDate(k.lastUsed) : 'Never'}</div>
                  <div className="text-slate-500">Success/Fail:</div>
                  <div className="flex items-center gap-1">
                    <span className="text-emerald-600 font-medium">{k.successCount}</span>
                    <span className="text-slate-300">/</span>
                    <span className="text-red-600 font-medium">{k.failCount}</span>
                  </div>
                  <div className="text-slate-500">Usage:</div>
                  <div>
                    <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden mt-1.5">
                      <div 
                        className="h-full bg-indigo-500" 
                        style={{ width: `${Math.min(100, ((k.successCount + k.failCount) / 100) * 100)}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-slate-400 mt-1 block">{k.successCount + k.failCount} requests</span>
                  </div>
                </div>
                <div className="pt-2 border-t border-slate-100 flex justify-end">
                  <Button variant="ghost" size="sm" className="text-red-500" onClick={() => handleDeleteKey(k.id, provider)}>
                    <Trash2 className="w-4 h-4 mr-2" />
                    Delete Key
                  </Button>
                </div>
              </Card>
            ))
          )}
        </div>
      </div>
    );
  };

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
            onClick={() => setActiveTab(tab.id as any)}
            className={cn(
              "flex items-center gap-2 px-4 md:px-6 py-2 rounded-lg text-sm font-semibold transition-all shrink-0",
              activeTab === tab.id ? "bg-white text-indigo-600 shadow-sm" : "text-slate-600 hover:text-slate-900"
            )}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      <div className="space-y-12">
        {activeTab === 'keys' && (
          <div className="space-y-12 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <KeySection 
              title="Cerebras Keys" 
              provider="cerebras" 
              description="Used for high-speed LLM content generation." 
            />
            <KeySection 
              title="UnrealSpeech Keys" 
              provider="unrealspeech" 
              description="Used for realistic AI voiceover generation." 
            />
            <KeySection 
              title="Workers AI Keys" 
              provider="workers-ai" 
              description="Cloudflare Workers AI for image and auxiliary tasks." 
            />
          </div>
        )}

        {activeTab === 'facebook' && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <Card className="p-6">
              <h3 className="text-lg font-bold text-slate-900 mb-4">Connect New Pages</h3>
              <div className="flex flex-col md:flex-row gap-4">
                <div className="flex-1 space-y-2">
                  <Label>Page Access Token</Label>
                  <Input 
                    placeholder="Enter your Facebook Page Access Token..." 
                    value={fbToken}
                    onChange={e => setFbToken(e.target.value)}
                  />
                  <p className="text-xs text-slate-500">
                    Tokens must have <code>pages_manage_posts</code> and <code>pages_read_engagement</code> permissions.
                  </p>
                </div>
                <Button className="w-full md:w-auto h-10 self-end" onClick={handleConnectFB}>
                  Connect Pages
                  <Plus className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </Card>

            <div className="space-y-4">
              <h3 className="text-lg font-bold text-slate-900">Connected Pages</h3>
              
              {/* Desktop Table */}
              <Card className="hidden md:block p-0">
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
                        <td colSpan={5} className="px-6 py-12 text-center text-slate-400">
                          No Facebook pages connected.
                        </td>
                      </tr>
                    ) : (
                      pages.map(p => (
                        <tr key={p.id} className="hover:bg-slate-50/50 transition-colors">
                          <td className="px-6 py-4 font-medium text-slate-900">{p.name}</td>
                          <td className="px-6 py-4 text-sm text-slate-500 font-mono">{p.id}</td>
                          <td className="px-6 py-4">
                            <Badge variant={p.status === 'valid' ? 'success' : 'error'}>{p.status}</Badge>
                          </td>
                          <td className="px-6 py-4 text-sm text-slate-500">{formatDate(p.lastChecked)}</td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <Button variant="ghost" size="icon" title="Refresh Status">
                                <RefreshCw className="w-4 h-4" />
                              </Button>
                              <Button variant="ghost" size="icon" className="text-red-500" onClick={() => api.removeFacebookPage(p.id).then(loadData)}>
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </Card>

              {/* Mobile List */}
              <div className="md:hidden space-y-3">
                {pages.length === 0 ? (
                  <Card className="p-8 text-center text-slate-400 text-sm italic">
                    No Facebook pages connected.
                  </Card>
                ) : (
                  pages.map(p => (
                    <Card key={p.id} className="p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-900">{p.name}</span>
                        <Badge variant={p.status === 'valid' ? 'success' : 'error'}>{p.status}</Badge>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div className="text-slate-500">Page ID:</div>
                        <div className="text-slate-900 font-mono truncate">{p.id}</div>
                        <div className="text-slate-500">Last Checked:</div>
                        <div className="text-slate-900">{formatDate(p.lastChecked)}</div>
                      </div>
                      <div className="pt-2 border-t border-slate-100 flex justify-end gap-2">
                        <Button variant="ghost" size="sm" title="Refresh Status">
                          <RefreshCw className="w-4 h-4 mr-2" />
                          Refresh
                        </Button>
                        <Button variant="ghost" size="sm" className="text-red-500" onClick={() => api.removeFacebookPage(p.id).then(loadData)}>
                          <Trash2 className="w-4 h-4 mr-2" />
                          Remove
                        </Button>
                      </div>
                    </Card>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'catbox' && (
          <div className="max-w-2xl animate-in fade-in slide-in-from-bottom-2 duration-300">
            <Card className="p-6 space-y-6">
              <div className="flex items-center gap-4 p-4 bg-blue-50 rounded-xl border border-blue-100 text-blue-700">
                <Box className="w-8 h-8 shrink-0" />
                <div>
                  <h4 className="font-bold">Catbox Integration</h4>
                  <p className="text-sm">Used for temporary video hosting before posting to Facebook.</p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Catbox User Hash</Label>
                  <Input 
                    type="password" 
                    placeholder="Enter your Catbox hash..." 
                    value={catboxHash}
                    onChange={e => setCatboxHash(e.target.value)}
                  />
                  <p className="text-xs text-slate-500">
                    Find this in your Catbox account settings. This is required for video uploads.
                  </p>
                </div>
                <Button className="w-full" onClick={handleSaveCatbox}>
                  <Save className="w-4 h-4 mr-2" />
                  Save Configuration
                </Button>
              </div>
            </Card>
          </div>
        )}

        {activeTab === 'system' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <Card className="p-6 space-y-6">
              <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-indigo-600" />
                Automation Preferences
              </h3>
              
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="text-sm font-semibold">Auto Topic Deduplication</Label>
                    <p className="text-xs text-slate-500">Prevent posting similar topics twice</p>
                  </div>
                  <input type="checkbox" defaultChecked className="w-5 h-5 rounded border-slate-300 text-indigo-600" />
                </div>
                
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="text-sm font-semibold">Strict Uniqueness Mode</Label>
                    <p className="text-xs text-slate-500">Enforce 100% unique script generation</p>
                  </div>
                  <input type="checkbox" className="w-5 h-5 rounded border-slate-300 text-indigo-600" />
                </div>

                <div className="space-y-2 pt-4">
                  <div className="flex justify-between">
                    <Label>Max Trending Topics to Fetch</Label>
                    <span className="text-xs font-bold text-indigo-600">50</span>
                  </div>
                  <Input type="number" defaultValue={50} />
                </div>

                <div className="space-y-2 pt-4">
                  <div className="flex justify-between">
                    <Label>Similarity Threshold</Label>
                    <span className="text-xs font-bold text-indigo-600">85%</span>
                  </div>
                  <input type="range" className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600" />
                </div>
              </div>
            </Card>

            <Card className="p-6 bg-slate-900 text-white border-none">
              <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-amber-400" />
                System Maintenance
              </h3>
              <p className="text-slate-400 text-sm mb-6">
                Perform system-wide actions and database maintenance. Use with caution.
              </p>
              <div className="space-y-3">
                <Button variant="outline" className="w-full border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white">
                  Clear All Failed Schedules
                </Button>
                <Button variant="outline" className="w-full border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white">
                  Reset API Usage Counters
                </Button>
                <Button variant="danger" className="w-full">
                  Purge All System Logs
                </Button>
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
