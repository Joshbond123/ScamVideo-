import React, { useEffect, useState } from 'react';
import { 
  Video, 
  Calendar, 
  Clock, 
  Facebook, 
  Plus, 
  Trash2, 
  Edit2, 
  MoreVertical,
  AlertCircle
} from 'lucide-react';
import { api } from '../lib/api';
import { Schedule, Niche, FacebookPage } from '../types';
import { Card, Button, Input, Label, Badge } from '../components/ui';
import { formatDate, formatTime, cn } from '../lib/utils';

export default function ScheduleVideo() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [pages, setPages] = useState<FacebookPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form state
  const [niche, setNiche] = useState<Niche>('Romance & Pig-Butchering Crypto Scams');
  const [pageId, setPageId] = useState('');
  const [time, setTime] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [s, p] = await Promise.all([
        api.getSchedules('video'),
        api.getFacebookPages()
      ]);
      setSchedules(Array.isArray(s) ? s : []);
      setPages(Array.isArray(p) ? p : []);
      if (Array.isArray(p) && p.length > 0) setPageId(p[0].id);
    } catch (err) {
      console.error(err);
      setSchedules([]);
      setPages([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pageId || !time) return;

    setIsSubmitting(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      await api.createSchedule({
        type: 'video',
        niche,
        pageId,
        scheduledAt: `${today}T${time}`,
        isDaily: true
      });
      // Reset form
      setTime('');
      loadData();
    } catch (err) {
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this schedule?')) return;
    await api.deleteSchedule(id, 'video');
    loadData();
  };

  const handleRunManual = async (id: string) => {
    await api.runJobManual(id, 'video');
    alert('Job started in background');
    loadData();
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Schedule Video Post</h1>
          <p className="text-slate-500">Create high-converting AI video content schedules.</p>
        </div>
        <div className="flex items-center gap-2 bg-amber-50 text-amber-700 px-4 py-2 rounded-lg border border-amber-100 text-sm font-medium">
          <AlertCircle className="w-4 h-4" />
          3 Generations remaining today
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Form */}
        <Card className="p-6 h-fit lg:col-span-1">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label>Content Niche</Label>
              <select 
                className="flex h-10 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                value={niche}
                onChange={(e) => setNiche(e.target.value as Niche)}
              >
                <option value="Romance & Pig-Butchering Crypto Scams">Romance & Pig-Butchering</option>
                <option value="AI-Driven & Deepfake Crypto Scams">AI-Driven & Deepfake</option>
                <option value="Crypto Scam Statistics & Big Numbers">Scam Stats & Big Numbers</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label>Facebook Page</Label>
              <select 
                className="flex h-10 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                value={pageId}
                onChange={(e) => setPageId(e.target.value)}
              >
                {Array.isArray(pages) && pages.length === 0 ? (
                  <option disabled>No pages connected</option>
                ) : Array.isArray(pages) ? (
                  pages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)
                ) : (
                  <option disabled>Error loading pages</option>
                )}
              </select>
              {pages.length === 0 && (
                <p className="text-xs text-red-500">Connect a page in Settings first.</p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Daily Posting Time</Label>
              <div className="relative">
                <Clock className="absolute left-3 top-3 w-4 h-4 text-slate-400" />
                <Input 
                  type="time" 
                  className="pl-10"
                  value={time} 
                  onChange={e => setTime(e.target.value)} 
                />
              </div>
              <p className="text-xs text-slate-500">Content will be generated and posted daily at this time.</p>
            </div>

            <Button 
              type="submit" 
              className="w-full h-12 text-lg" 
              disabled={isSubmitting || pages.length === 0}
            >
              {isSubmitting ? 'Scheduling...' : 'Schedule Video'}
              {!isSubmitting && <Plus className="w-5 h-5 ml-2" />}
            </Button>
          </form>
        </Card>

        {/* List */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="p-0">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <h2 className="font-bold text-slate-900">Recent Schedules</h2>
              <Badge variant="info">{schedules.length} Total</Badge>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-slate-50/50 text-slate-500 text-xs uppercase tracking-wider">
                    <th className="px-6 py-4 font-semibold">Time</th>
                    <th className="px-6 py-4 font-semibold">Niche</th>
                    <th className="px-6 py-4 font-semibold">Page</th>
                    <th className="px-6 py-4 font-semibold">Recurrence</th>
                    <th className="px-6 py-4 font-semibold">Status</th>
                    <th className="px-6 py-4 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center text-slate-400">Loading...</td>
                    </tr>
                  ) : schedules.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center">
                        <div className="flex flex-col items-center gap-2 text-slate-400">
                          <Video className="w-12 h-12 opacity-20" />
                          <p>No video schedules yet.</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    schedules.map((s) => (
                      <tr key={s.id} className="hover:bg-slate-50/50 transition-colors group">
                        <td className="px-6 py-4">
                          <div className="flex flex-col">
                            <span className="text-sm font-semibold text-slate-900">
                              Daily at {formatTime(s.scheduledAt)}
                            </span>
                            <span className="text-xs text-slate-500 flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              Local Time
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-sm text-slate-600 line-clamp-1">{s.niche}</span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2 text-sm text-slate-600">
                            <Facebook className="w-4 h-4 text-blue-600" />
                            {Array.isArray(pages) && pages.find(p => p.id === s.pageId)?.name || 'Unknown'}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <Badge variant={s.isDaily ? 'info' : 'default'}>
                            {s.isDaily ? 'Daily' : 'Once'}
                          </Badge>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <div className={cn(
                              "w-2 h-2 rounded-full",
                              s.status === 'posted' ? 'bg-emerald-500' : 
                              s.status === 'failed' ? 'bg-red-500' : 
                              s.status === 'generating' ? 'bg-blue-500 animate-pulse' : 'bg-amber-500'
                            )}></div>
                            <span className="text-sm font-medium capitalize text-slate-700">{s.status}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="h-8 w-8 text-indigo-600"
                              onClick={() => handleRunManual(s.id)}
                              title="Run Now"
                            >
                              <Plus className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <Edit2 className="w-4 h-4" />
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-50"
                              onClick={() => handleDelete(s.id)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
