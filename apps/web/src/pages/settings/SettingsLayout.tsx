import clsx from 'clsx';
import { NavLink, Outlet } from 'react-router-dom';
import { Code, MessageSquareText, UserRound, Users } from 'lucide-react';
import { useAuth } from '../../lib/auth';

export function SettingsLayout() {
  const isAdmin = useAuth((s) => s.agent?.role === 'admin');
  const tabs = [
    { to: '/settings/profile', label: 'My profile', icon: UserRound, show: true },
    { to: '/settings/team', label: 'Team', icon: Users, show: isAdmin },
    { to: '/settings/shortcuts', label: 'Shortcuts', icon: MessageSquareText, show: true },
    { to: '/settings/widget', label: 'Install widget', icon: Code, show: true },
  ];
  return (
    <div className="flex min-h-full flex-col gap-6 px-8 py-7">
      <h1 className="text-[26px] font-bold">Settings</h1>
      <div className="flex gap-8">
        <nav className="flex w-52 shrink-0 flex-col gap-1" aria-label="Settings sections">
          {tabs
            .filter((t) => t.show)
            .map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  clsx(
                    'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium',
                    isActive ? 'bg-primary-subtle text-primary' : 'text-ink-2 hover:bg-muted hover:text-ink',
                  )
                }
              >
                <Icon className="size-4" /> {label}
              </NavLink>
            ))}
        </nav>
        <div className="min-w-0 flex-1">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
