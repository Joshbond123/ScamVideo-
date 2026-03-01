import { Route, Switch, Redirect, Link } from 'wouter';
import { AppLayout } from './components/layout/AppLayout';
import Dashboard from './pages/Dashboard';
import ScheduleVideo from './pages/ScheduleVideo';
import SchedulePost from './pages/SchedulePost';
import Published from './pages/Published';
import Settings from './pages/Settings';
import RecentSchedules from './pages/RecentSchedules';

export default function App() {
  return (
    <AppLayout>
      <Switch>
        <Route path="/dashboard" component={Dashboard} />
        <Route path="/schedule/video" component={ScheduleVideo} />
        <Route path="/schedule/post" component={SchedulePost} />
        <Route path="/content/published" component={Published} />
        <Route path="/settings" component={Settings} />
        <Route path="/recent-schedules" component={RecentSchedules} />
        
        {/* Default route */}
        <Route path="/">
          <Redirect to="/dashboard" />
        </Route>

        {/* 404 handler */}
        <Route>
          <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
            <h1 className="text-4xl font-bold text-slate-900 mb-2">404</h1>
            <p className="text-slate-500 mb-6">Oops! The page you're looking for doesn't exist.</p>
            <Link href="/dashboard" className="text-indigo-600 font-semibold hover:underline">
              Go back to Dashboard
            </Link>
          </div>
        </Route>
      </Switch>
    </AppLayout>
  );
}
