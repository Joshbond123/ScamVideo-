import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { Schedule } from '../types';
import { Badge, Card } from '../components/ui';
import { formatDate } from '../lib/utils';

function toStatusLabel(status: Schedule['status']) {
  if (status === 'pending') return 'Queued';
  if (status === 'generating') return 'Running';
  if (status === 'posted') return 'Published';
  return 'Failed';
}

function toStatusVariant(status: Schedule['status']) {
  if (status === 'posted') return 'success' as const;
  if (status === 'failed') return 'error' as const;
  if (status === 'generating') return 'info' as const;
  return 'warning' as const;
}

export default function RecentSchedules() {
  const [items, setItems] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await api.getRecentSchedules(8);
        setItems(Array.isArray(data) ? data : []);
      } catch (error) {
        console.error(error);
        setItems([]);
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, []);

  const sorted = useMemo(
    () => [...items].sort((a, b) => new Date(b.createdAt || b.scheduledAt).getTime() - new Date(a.createdAt || a.scheduledAt).getTime()),
    [items]
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Recent Schedules</h1>
        <p className="text-slate-500">Latest 8 video and text/image schedules from Supabase-backed records.</p>
      </div>

      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Niche</th>
                <th className="px-4 py-3">Scheduled Time</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Published Time</th>
                <th className="px-4 py-3">Target Facebook Page</th>
                <th className="px-4 py-3">Error</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-slate-400">Loading recent schedules...</td>
                </tr>
              ) : sorted.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-slate-400">No recent schedules found.</td>
                </tr>
              ) : (
                sorted.map((s) => (
                  <tr key={s.id}>
                    <td className="px-4 py-3">
                      <div className="font-medium">{s.type === 'video' ? 'Video' : 'Text/Image'}</div>
                    </td>
                    <td className="px-4 py-3 max-w-xs truncate" title={s.niche}>{s.niche}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{formatDate(s.scheduledAt)}</td>
                    <td className="px-4 py-3">
                      <Badge variant={toStatusVariant(s.status)}>{toStatusLabel(s.status)}</Badge>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">{s.publishedAt ? formatDate(s.publishedAt) : '—'}</td>
                    <td className="px-4 py-3">
                      <div className="text-slate-800">{s.pageName || 'Unknown Page'}</div>
                      <div className="text-xs text-slate-500">{s.pageId}</div>
                    </td>
                    <td className="px-4 py-3 max-w-md">
                      {s.status === 'failed' && s.errorMessage ? (
                        <span className="text-red-600 line-clamp-2" title={s.errorMessage}>{s.errorMessage}</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
