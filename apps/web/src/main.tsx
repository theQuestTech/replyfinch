import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { Construction } from 'lucide-react';
import './index.css';
import { useAuth } from './lib/auth';
import { queryClient } from './lib/query';
import { Shell } from './components/Shell';
import { Home } from './pages/Home';
import { Login } from './pages/Login';
import { Visitors } from './pages/Visitors';
import { History } from './pages/History';
import { Inbox } from './pages/Inbox';
import { Reports } from './pages/Reports';
import { SettingsLayout } from './pages/settings/SettingsLayout';
import { Profile } from './pages/settings/Profile';
import { Team } from './pages/settings/Team';
import { Shortcuts } from './pages/settings/Shortcuts';
import { ChatWidget } from './pages/settings/ChatWidget';

function RequireAuth({ children }: { children: ReactNode }) {
  const token = useAuth((s) => s.token);
  return token ? children : <Navigate to="/login" replace />;
}

function ComingSoon() {
  const { pathname } = useLocation();
  const name = pathname.slice(1).replace(/-/g, ' ');
  return (
    <div className="grid h-full place-items-center text-center text-ink-2">
      <div>
        <Construction className="mx-auto mb-3 size-8 text-gold" />
        <div className="text-lg font-semibold text-ink capitalize">{name}</div>
        <div className="text-sm">Coming in a later phase — see docs/PLAN.md.</div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            element={
              <RequireAuth>
                <Shell />
              </RequireAuth>
            }
          >
            <Route index element={<Home />} />
            <Route path="visitors" element={<Visitors />} />
            <Route path="inbox" element={<Inbox />} />
            <Route path="history" element={<History />} />
            <Route path="reports" element={<Reports />} />
            <Route path="settings" element={<SettingsLayout />}>
              <Route index element={<Navigate to="profile" replace />} />
              <Route path="profile" element={<Profile />} />
              <Route path="team" element={<Team />} />
              <Route path="shortcuts" element={<Shortcuts />} />
              <Route path="widget" element={<ChatWidget />} />
            </Route>
            <Route path="*" element={<ComingSoon />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
