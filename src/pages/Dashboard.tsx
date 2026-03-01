import React, { useEffect, useMemo, useState } from 'react';
import { Activity, Calendar, CheckCircle2, FileText, Users, Video } from 'lucide-react';
import { api } from '../lib/api';
import { DashboardStats, LogEntry, Schedule } from '../types';
import { Badge, Card } from '../components/ui';
import { formatDate } from '../lib/utils';

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const [dashboard, allSchedules, allLogs] = await Promise.all([
          api.getDashboard(),
          api.getSchedules(),
          api.getLogs(),
        ]);
        setStats(dashboard);
        setSchedules(Array.isArray(allSchedules) ? allSchedules : []);
        setLogs(Array.isArray(allLogs) ? allLogs : []);
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, []);

  const upcoming = useMemo(
    () =>
      schedules
        .filter((s) => s.status === 'pending')
        .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())
        .slice(0, 6),
    [schedules]
  );

  const recentLogs = useMemo(() => logs.slice(0, 8), [logs]);

  if (loading) return <div className="text-slate-500">Loading dashboard...</div>;

  const cards = [
    { icon: Users, label: 'Connected Pages', value: stats?.connectedPages ?? 0 },
    { icon: Video, label: 'Scheduled Videos', value: stats?.scheduledVideos ?? 0 },
    { icon: FileText, label: 'Scheduled Posts', value: stats?.scheduledPosts ?? 0 },
    { icon: CheckCircle2, label: 'Published This Week', value: stats?.publishedThisWeek ?? 0 },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Dashboard Overview</h1>
        <p className="text-slate-500">Real-time automation metrics and schedule activity.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {cards.map(({ icon: Icon, label, value }) => (
          <Card key={label} className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-slate-600 text-sm font-medium">{label}</span>
              <Icon className="w-5 h-5 text-indigo-500" />
            </div>
            <p className="text-3xl font-bold mt-2">{value}</p>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <Card className="xl:col-span-2 p-0 overflow-hidden">
          <div className="p-4 border-b">
            <h2 className="font-semibold text-slate-900 flex items-center gap-2">
              <Calendar className="w-4 h-4" /> Upcoming Schedules
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-4 py-3">When</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Niche</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {upcoming.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-slate-400">
                      No upcoming schedules.
                    </td>
                  </tr>
                ) : (
                  upcoming.map((s) => (
                    <tr key={s.id}>
                      <td className="px-4 py-3">{formatDate(s.scheduledAt)}</td>
                      <td className="px-4 py-3 capitalize">{s.type}</td>
                      <td className="px-4 py-3">{s.niche}</td>
                      <td className="px-4 py-3">
                        <Badge variant={s.status === 'posted' ? 'success' : s.status === 'failed' ? 'error' : 'warning'}>
                          {s.status}
                        </Badge>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="p-4">
          <h2 className="font-semibold text-slate-900 flex items-center gap-2 mb-4">
            <Activity className="w-4 h-4" /> Recent Logs
          </h2>
          <div className="space-y-3">
            {recentLogs.length === 0 ? (
              <p className="text-sm text-slate-400">No logs available.</p>
            ) : (
              recentLogs.map((log) => (
                <div key={log.id} className="border rounded-lg p-3">
                  <p className="text-sm text-slate-800">{log.message}</p>
                  <div className="mt-2 flex items-center justify-between">
                    <Badge variant={log.status === 'success' ? 'success' : log.status === 'error' ? 'error' : 'default'}>
                      {log.status}
                    </Badge>
                    <span className="text-xs text-slate-500">{formatDate(log.timestamp)}</span>
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
