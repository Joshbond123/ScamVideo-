import React, { useEffect, useState } from 'react';
import { 
  Users, 
  Video, 
  FileText, 
  CheckCircle, 
  Activity,
  ArrowUpRight,
  ArrowDownRight,
  Zap,
  ExternalLink
} from 'lucide-react';
import { api } from '../lib/api';
import { DashboardStats, Schedule, LogEntry } from '../types';
import { Card, Badge, Button } from '../components/ui';
import { formatDate, cn } from '../lib/utils';

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentSchedules, setRecentSchedules] = useState<Schedule[]>([]);
  const [recentLogs, setRecentLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [s, sch, l] = await Promise.all([
          api.getDashboard(),
          api.getSchedules(),
          api.getLogs()
        ]);
        setStats(s);
        setRecentSchedules(Array.isArray(sch) ? sch.slice(0, 5) : []);
        setRecentLogs(Array.isArray(l) ? l.slice(0, 5) : []);
      } catch (err) {
        console.error(err);
        setRecentSchedules([]);
        setRecentLogs([]);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  if (loading) return <div className="animate-pulse space-y-8">
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {[1,2,3,4].map(i => <div key={i} className="h-32 bg-white rounded-xl border border-slate-200"></div>)}
    </div>
    <div className="h-96 bg-white rounded-xl border border-slate-200"></div>
  </div>;

  const statCards = [
    { label: 'Connected Pages', value: stats?.connectedPages || 0, icon: Users, color: 'text-blue-600', bg: 'bg-blue-50' },
    { label: 'Scheduled Videos', value: stats?.scheduledVideos || 0, icon: Video, color: 'text-indigo-600', bg: 'bg-indigo-50' },
    { label: 'Scheduled Posts', value: stats?.scheduledPosts || 0, icon: FileText, color: 'text-emerald-600', bg: 'bg-emerald-50' },
    { label: 'Published This Week', value: stats?.publishedThisWeek || 0, icon: CheckCircle, color: 'text-amber-600', bg: 'bg-amber-50' },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Dashboard Overview</h1>
        <p className="text-slate-500">Welcome back! Here's what's happening today.</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {statCards.map((stat, i) => (
          <Card key={i} className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div className={cn("p-2 rounded-lg", stat.bg)}>
                <stat.icon className={cn("w-6 h-6", stat.color)} />
              </div>
              <div className="flex items-center text-emerald-600 text-xs font-medium bg-emerald-50 px-2 py-1 rounded-full">
                <ArrowUpRight className="w-3 h-3 mr-1" />
                12%
              </div>
            </div>
            <p className="text-slate-500 text-sm font-medium">{stat.label}</p>
            <p className="text-3xl font-bold text-slate-900 mt-1">{stat.value}</p>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Recent Activity */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="p-0">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <h2 className="font-bold text-slate-900 flex items-center gap-2">
                <Activity className="w-5 h-5 text-indigo-600" />
                Upcoming Schedules
              </h2>
              <Button variant="ghost" size="sm">View All</Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-slate-50/50 text-slate-500 text-xs uppercase tracking-wider">
                    <th className="px-6 py-4 font-semibold">Time</th>
                    <th className="px-6 py-4 font-semibold">Type</th>
                    <th className="px-6 py-4 font-semibold">Niche</th>
                    <th className="px-6 py-4 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {recentSchedules.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-6 py-12 text-center text-slate-400">
                        No upcoming schedules found.
                      </td>
                    </tr>
                  ) : (
                    recentSchedules.map((s) => (
                      <tr key={s.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-6 py-4 text-sm text-slate-900 font-medium">{formatDate(s.scheduledAt)}</td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2 text-sm text-slate-600">
                            {s.type === 'video' ? <Video className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
                            {s.type}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm text-slate-600 truncate max-w-[200px]">{s.niche}</td>
                        <td className="px-6 py-4">
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

          {/* API Health */}
          <Card className="p-6">
            <h2 className="font-bold text-slate-900 mb-6 flex items-center gap-2">
              <Zap className="w-5 h-5 text-amber-500" />
              API Health Status
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {[
                { name: 'Cerebras', status: 'Operational', latency: '124ms' },
                { name: 'UnrealSpeech', status: 'Operational', latency: '450ms' },
                { name: 'Workers AI', status: 'Operational', latency: '89ms' },
                { name: 'Facebook Graph', status: 'Operational', latency: '210ms' },
                { name: 'Catbox Storage', status: 'Operational', latency: '15ms' },
              ].map((api) => (
                <div key={api.name} className="p-4 rounded-xl border border-slate-100 bg-slate-50/50">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold text-slate-900">{api.name}</span>
                    <div className="w-2 h-2 bg-emerald-500 rounded-full"></div>
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>{api.status}</span>
                    <span>{api.latency}</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Recent Activity Feed */}
        <div className="space-y-6">
          <Card className="p-6">
            <h2 className="font-bold text-slate-900 mb-6">Recent Activity</h2>
            <div className="space-y-6">
              {recentLogs.map((log) => (
                <div key={log.id} className="flex gap-4">
                  <div className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
                    log.status === 'success' ? 'bg-emerald-50 text-emerald-600' : 
                    log.status === 'error' ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'
                  )}>
                    <Activity className="w-4 h-4" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-slate-900 font-medium leading-tight">{log.message}</p>
                    <p className="text-xs text-slate-500">{formatDate(log.timestamp)}</p>
                  </div>
                </div>
              ))}
            </div>
            <Button variant="outline" className="w-full mt-6">View Full Logs</Button>
          </Card>

          <Card className="p-6 bg-indigo-600 text-white border-none">
            <h3 className="font-bold text-lg mb-2">Upgrade to Enterprise</h3>
            <p className="text-indigo-100 text-sm mb-6">Get unlimited schedules, multi-account support, and priority generation.</p>
            <Button variant="secondary" className="w-full bg-white text-indigo-600 hover:bg-indigo-50">
              Upgrade Now
              <ExternalLink className="w-4 h-4 ml-2" />
            </Button>
          </Card>
        </div>
      </div>
    </div>
  );
}
