import clsx from 'clsx';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import {
  Bell,
  BookOpen,
  Bird,
  ChartColumn,
  ChevronDown,
  Eye,
  History,
  House,
  Inbox,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  SlidersHorizontal,
  Ticket,
  Users,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { setAgentStatus, useRealtime } from '../lib/realtime';
import { useDesk } from '../lib/store';
import { initials } from '../lib/format';
import { Avatar, Kbd, StatusDot } from './ui';
import { ChatDock } from './chat/ChatDock';
import { ChatWindow } from './chat/ChatWindow';

const NAV = [
  { to: '/', label: 'Home', icon: House, end: true },
  { to: '/visitors', label: 'Visitors', icon: Eye },
  { to: '/inbox', label: 'Inbox', icon: Inbox, badge: true },
  { to: '/tickets', label: 'Tickets', icon: Ticket },
  { to: '/customers', label: 'Customers', icon: Users },
  { to: '/history', label: 'History', icon: History },
  { to: '/reports', label: 'Reports', icon: ChartColumn },
  { to: '/help-center', label: 'Help center', icon: BookOpen },
];

const SIDEBAR_KEY = 'rf_sidebar_expanded';
const SHORTCUT = /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘B' : 'Ctrl B';

function useSidebar() {
  const [expanded, setExpanded] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) !== '0';
    } catch {
      return true;
    }
  });
  const toggle = () =>
    setExpanded((e) => {
      try {
        localStorage.setItem(SIDEBAR_KEY, e ? '0' : '1');
      } catch {
        /* ignore */
      }
      return !e;
    });
  // ⌘B / Ctrl+B toggles the sidebar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return { expanded, toggle };
}

export function Shell() {
  useRealtime();
  const active = useDesk((s) => s.active);
  const waiting = useDesk((s) => Object.values(s.conversations).filter((c) => c.status === 'waiting').length);
  const { expanded, toggle } = useSidebar();

  const item = (isActive: boolean) =>
    clsx(
      'relative flex h-11 shrink-0 items-center rounded-[10px] transition-colors',
      expanded ? 'w-full gap-3 px-3' : 'w-11 justify-center',
      isActive ? 'bg-navy-2 text-white' : 'text-on-navy hover:bg-navy-2/60 hover:text-white',
    );

  return (
    <div className="flex h-full min-w-[1000px]">
      <aside
        data-testid="sidebar"
        data-expanded={expanded}
        className={clsx(
          'flex shrink-0 flex-col gap-1.5 overflow-hidden bg-navy py-4 transition-[width] duration-200',
          expanded ? 'w-[232px] items-stretch px-3' : 'w-[72px] items-center px-0',
        )}
      >
        <div className={clsx('mb-3.5 flex items-center gap-3', expanded && 'px-0.5')}>
          <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-gold" aria-label="Replyfinch">
            <Bird className="size-6 text-navy" strokeWidth={2} />
          </div>
          {expanded && <span className="text-[17px] font-bold tracking-tight text-white">Replyfinch</span>}
        </div>
        {NAV.map(({ to, label, icon: Icon, end, badge }) => (
          <NavLink key={to} to={to} end={end} title={expanded ? undefined : label} aria-label={label} className={({ isActive }) => item(isActive)}>
            <Icon className="size-5 shrink-0" />
            {expanded && <span className="truncate text-sm font-medium">{label}</span>}
            {badge && waiting > 0 && (
              <span
                className={clsx(
                  'rounded-full bg-danger px-1.5 text-[10px] leading-4 font-bold text-white',
                  expanded ? 'ml-auto' : 'absolute top-1 right-0.5',
                )}
              >
                {waiting}
              </span>
            )}
          </NavLink>
        ))}
        <div className="flex-1" />
        <NavLink to="/settings" title={expanded ? undefined : 'Settings'} aria-label="Settings" className={({ isActive }) => item(isActive)}>
          <SlidersHorizontal className="size-5 shrink-0" />
          {expanded && <span className="text-sm font-medium">Settings</span>}
        </NavLink>
        <button
          onClick={toggle}
          aria-label={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
          title={`${expanded ? 'Collapse' : 'Expand'} sidebar (${SHORTCUT})`}
          className={clsx(item(false), 'cursor-pointer')}
        >
          {expanded ? <PanelLeftClose className="size-5 shrink-0" /> : <PanelLeftOpen className="size-5 shrink-0" />}
          {expanded && (
            <>
              <span className="text-sm font-medium">Collapse</span>
              <span className="ml-auto rounded border border-white/15 px-1.5 text-[10px] font-semibold text-on-navy">{SHORTCUT}</span>
            </>
          )}
        </button>
        <MeMenu expanded={expanded} />
      </aside>

      <div className="relative flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="relative min-h-0 flex-1 overflow-auto">
          {active?.mode === 'main' ? <ChatWindow key={active.visitorId} visitorId={active.visitorId} mode="main" /> : <Outlet />}
        </main>
        {active?.mode !== 'main' && <ChatDock />}
        {active?.mode === 'side' && (
          <div className="absolute inset-y-0 right-0 z-30 flex w-[800px] max-w-[calc(100%-120px)] border-l border-line shadow-[-8px_0_32px_rgba(18,24,38,0.16)]">
            <ChatWindow key={active.visitorId} visitorId={active.visitorId} mode="side" />
          </div>
        )}
      </div>
    </div>
  );
}

function MeMenu({ expanded }: { expanded: boolean }) {
  const agent = useAuth((s) => s.agent);
  const logout = useAuth((s) => s.logout);
  const me = useDesk((s) => s.team.find((t) => t.id === agent?.id));
  const [open, setOpen] = useState(false);
  const status = me?.status ?? 'online';
  return (
    <div className="relative mt-1.5">
      <button
        onClick={() => setOpen((o) => !o)}
        className={clsx('flex cursor-pointer items-center gap-3 rounded-[10px] text-left', expanded && 'w-full p-1.5 hover:bg-navy-2/60')}
        aria-label="Account menu"
      >
        <span className="relative shrink-0">
          <Avatar text={initials(agent?.name)} tone="gold" size={36} />
          <StatusDot status={status} ring="ring-navy" className="absolute -right-0.5 -bottom-0.5" />
        </span>
        {expanded && (
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-white">{agent?.name}</span>
            <span className="block truncate text-xs text-on-navy capitalize">{status}</span>
          </span>
        )}
      </button>
      {open && (
        <div className={clsx('absolute bottom-0 z-50 w-56 rounded-xl border border-line bg-surface p-1.5 shadow-xl', expanded ? 'left-[216px]' : 'left-12')}>
          <div className="px-3 py-2">
            <div className="text-sm font-semibold">{agent?.name}</div>
            <div className="text-xs text-ink-2">{agent?.email}</div>
          </div>
          <button
            onClick={logout}
            className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-ink-2 hover:bg-muted"
          >
            <LogOut className="size-4" /> Log out
          </button>
        </div>
      )}
    </div>
  );
}

function TopBar() {
  const agent = useAuth((s) => s.agent);
  const connected = useDesk((s) => s.connected);
  const me = useDesk((s) => s.team.find((t) => t.id === agent?.id));
  const status = me?.status ?? 'online';
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  return (
    <header className="flex h-16 shrink-0 items-center gap-4 border-b border-line bg-surface px-8">
      <div className="flex h-10 w-[440px] items-center gap-2.5 rounded-[10px] bg-muted pr-2 pl-3 text-sm text-ink-2">
        <Search className="size-4" />
        <span className="flex-1">Search tickets, customers, articles…</span>
        <Kbd>⌘K</Kbd>
      </div>
      <div className="flex-1" />
      {!connected && <span className="text-xs font-medium text-warning">Reconnecting…</span>}
      <div className="relative">
        <button
          onClick={() => setOpen((o) => !o)}
          className={clsx(
            'flex cursor-pointer items-center gap-2 rounded-full py-2 pr-2.5 pl-3 text-[13px] font-semibold',
            status === 'online' ? 'bg-success-subtle text-success' : 'bg-warning-subtle text-warning',
          )}
        >
          <span className={clsx('size-2 rounded-full', status === 'online' ? 'bg-success' : 'bg-away')} />
          {status === 'online' ? 'Online' : 'Away'}
          <ChevronDown className="size-3.5" />
        </button>
        {open && (
          <div className="absolute top-11 right-0 z-50 w-40 rounded-xl border border-line bg-surface p-1.5 shadow-xl">
            {(['online', 'away'] as const).map((s) => (
              <button
                key={s}
                onClick={() => {
                  setAgentStatus(s);
                  setOpen(false);
                }}
                className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm capitalize hover:bg-muted"
              >
                <StatusDot status={s} /> {s}
              </button>
            ))}
          </div>
        )}
      </div>
      <button className="relative grid size-9 cursor-pointer place-items-center rounded-[10px] border border-line" aria-label="Notifications">
        <Bell className="size-[18px]" />
      </button>
      <button
        onClick={() => navigate('/tickets')}
        className="flex cursor-pointer items-center gap-1.5 rounded-[10px] bg-primary py-2 pr-4 pl-3.5 text-sm font-semibold text-white hover:bg-primary/90"
      >
        <Plus className="size-4" /> New ticket
      </button>
    </header>
  );
}
