import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { SearchX } from 'lucide-react';
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
import { Customers } from './pages/Customers';
import { CustomerProfile } from './pages/CustomerProfile';
import { Tickets } from './pages/Tickets';
import { TicketDetail } from './pages/TicketDetail';
import { HelpCenter } from './pages/HelpCenter';
import { HelpArticleEditor } from './pages/HelpArticleEditor';
import { PublicHelpArticlePage, PublicHelpHome } from './pages/PublicHelp';
import { SettingsLayout } from './pages/settings/SettingsLayout';
import { Profile } from './pages/settings/Profile';
import { Team } from './pages/settings/Team';
import { Shortcuts } from './pages/settings/Shortcuts';
import { ChatWidget } from './pages/settings/ChatWidget';
import { EmailSettings } from './pages/settings/EmailSettings';
import { AiAssistant } from './pages/settings/AiAssistant';
import { Integrations } from './pages/settings/Integrations';

function RequireAuth({ children }: { children: ReactNode }) {
  const token = useAuth((s) => s.token);
  return token ? children : <Navigate to="/login" replace />;
}

function NotFound() {
  return (
    <div className="grid h-full place-items-center text-center text-ink-2">
      <div>
        <SearchX className="mx-auto mb-3 size-8" />
        <div className="text-lg font-semibold text-ink">Page not found</div>
        <Link to="/" className="text-sm text-primary hover:underline">
          Go to Home
        </Link>
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
          {/* The public help site: anyone can read it, no sign-in. */}
          <Route path="/help/:acc" element={<PublicHelpHome />} />
          <Route path="/help/:acc/:slug" element={<PublicHelpArticlePage />} />
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
            <Route path="customers" element={<Customers />} />
            <Route path="customers/:id" element={<CustomerProfile />} />
            <Route path="tickets" element={<Tickets />} />
            <Route path="tickets/:id" element={<TicketDetail />} />
            <Route path="help-center" element={<HelpCenter />} />
            <Route path="help-center/articles/:id" element={<HelpArticleEditor />} />
            <Route path="settings" element={<SettingsLayout />}>
              <Route index element={<Navigate to="profile" replace />} />
              <Route path="profile" element={<Profile />} />
              <Route path="team" element={<Team />} />
              <Route path="shortcuts" element={<Shortcuts />} />
              <Route path="widget" element={<ChatWidget />} />
              <Route path="email" element={<EmailSettings />} />
              <Route path="ai" element={<AiAssistant />} />
              <Route path="integrations" element={<Integrations />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
