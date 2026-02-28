import React, { useEffect, useMemo, useState } from 'react';
import { CalendarClock, Clock, FileText, Plus, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { FacebookPage, Niche, Schedule } from '../types';
import { Badge, Button, Card, Input, Label } from '../components/ui';
import { formatDate } from '../lib/utils';

const NICHES: Niche[] = [
  'Romance & Pig-Butchering Crypto Scams',
  'AI-Driven & Deepfake Crypto Scams',
  'Crypto Scam Statistics & Big Numbers',
];

export default function SchedulePost() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [pages, setPages] = useState<FacebookPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string>('');

  const [niche, setNiche] = useState<Niche>(NICHES[0]);
  const [pageId, setPageId] = useState('');
  const [time, setTime] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    void loadData();
  }, []);

  const loadData = async () => {
    try {
      const [postSchedules, connectedPages] = await Promise.all([api.getSchedules('post'), api.getFacebookPages()]);
      const safeSchedules = Array.isArray(postSchedules) ? postSchedules : [];
      const safePages = Array.isArray(connectedPages) ? connectedPages : [];

      setSchedules(safeSchedules);
      setPages(safePages);
      if (!pageId && safePages.length) setPageId(safePages[0].id);
    } catch (error) {
      console.error(error);
      setNotice('Failed to load post schedules.');
    } finally {
      setLoading(false);
    }
  };

  const pendingSchedules = useMemo(() => schedules.filter((s) => s.status === 'pending'), [schedules]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!pageId || !time) {
      setNotice('Select a page and posting time.');
      return;
    }

    setIsSubmitting(true);
    try {
      const now = new Date();
      const [hh, mm] = time.split(':').map(Number);
      const runAt = new Date(now);
      runAt.setHours(hh || 0, mm || 0, 0, 0);
      if (runAt.getTime() <= now.getTime()) runAt.setDate(runAt.getDate() + 1);

      await api.createSchedule({
        type: 'post',
        niche,
        pageId,
        scheduledAt: runAt.toISOString(),
        isDaily: true,
      });
      setNotice('Text/Image schedule created successfully.');
      setTime('');
      await loadData();
    } catch (error) {
      console.error(error);
      setNotice('Failed to create post schedule.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this text/image schedule?')) return;
    await api.deleteSchedule(id, 'post');
    await loadData();
  };

  const handleRun = async (id: string) => {
    await api.runJobManual(id, 'post');
    setNotice('Text/Image generation started in background.');
    await loadData();
  };

  if (loading) return <div className="text-slate-500">Loading post schedules...</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Schedule Text/Image Post</h1>
        <p className="text-slate-500">Create daily image posts with title overlays and auto publishing.</p>
      </div>

      {notice && <div className="rounded-lg border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm text-indigo-700">{notice}</div>}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <Card className="p-5 xl:col-span-1">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label>Niche</Label>
              <select className="mt-1 flex h-10 w-full rounded-lg border px-3" value={niche} onChange={(e) => setNiche(e.target.value as Niche)}>
                {NICHES.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </div>
            <div>
              <Label>Facebook Page</Label>
              <select className="mt-1 flex h-10 w-full rounded-lg border px-3" value={pageId} onChange={(e) => setPageId(e.target.value)}>
                {pages.length === 0 ? <option value="">No connected pages</option> : pages.map((page) => <option key={page.id} value={page.id}>{page.name}</option>)}
              </select>
            </div>
            <div>
              <Label>Daily Time</Label>
              <div className="relative mt-1">
                <Clock className="absolute left-3 top-3 w-4 h-4 text-slate-400" />
                <Input type="time" className="pl-10" value={time} onChange={(e) => setTime(e.target.value)} />
              </div>
            </div>
            <Button className="w-full" type="submit" disabled={isSubmitting || !pages.length}>
              {isSubmitting ? 'Scheduling...' : 'Schedule Post'}
              {!isSubmitting && <Plus className="w-4 h-4 ml-2" />}
            </Button>
          </form>
        </Card>

        <Card className="p-0 xl:col-span-2 overflow-hidden">
          <div className="p-4 border-b flex items-center gap-2">
            <CalendarClock className="w-4 h-4 text-indigo-600" />
            <h2 className="font-semibold">Scheduled Text/Image Jobs ({pendingSchedules.length})</h2>
          </div>
          <div className="divide-y">
            {pendingSchedules.length === 0 ? (
              <p className="p-6 text-sm text-slate-500">No text/image schedules yet.</p>
            ) : (
              pendingSchedules.map((schedule) => (
                <div key={schedule.id} className="p-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-indigo-600" />
                      <p className="font-medium text-slate-900">{schedule.niche}</p>
                      <Badge variant="warning">{schedule.status}</Badge>
                    </div>
                    <p className="text-xs text-slate-500">{formatDate(schedule.scheduledAt)}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => void handleRun(schedule.id)}>Run now</Button>
                    <Button size="sm" variant="outline" className="text-red-600" onClick={() => void handleDelete(schedule.id)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
