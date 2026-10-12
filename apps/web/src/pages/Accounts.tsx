import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Building2, Plus } from 'lucide-react';
import type { PlatformAccount } from '@replyfinch/shared';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { timeAgo } from '../lib/format';
import { Button, Card, Pill } from '../components/ui';
import { CopyLink, NewAccountModal } from '../components/accounts/NewAccountModal';

/** Platform admins: every customer workspace, and new ones. */
export function Accounts() {
  const isPlatformAdmin = useAuth((s) => !!s.agent?.platformAdmin);
  const { data, isLoading } = useQuery({ queryKey: ['platform', 'accounts'], queryFn: () => api<PlatformAccount[]>('/platform/accounts'), enabled: isPlatformAdmin });
  const [creating, setCreating] = useState(false);
  if (!isPlatformAdmin) return <Navigate to="/" replace />;

  return (
    <div className="flex min-h-full flex-col gap-5 px-8 py-7">
      {creating && <NewAccountModal onClose={() => setCreating(false)} />}
      <div className="flex items-start gap-4">
        <div className="flex-1">
          <h1 className="text-[26px] font-bold">Accounts</h1>
          <p className="text-sm text-ink-2">Every company using this Replyfinch. Only you (a platform admin) can see this page.</p>
        </div>
        <Button variant="primary" onClick={() => setCreating(true)}>
          <Plus className="size-4" /> New account
        </Button>
      </div>
      <Card>
        <div className="grid grid-cols-[minmax(200px,1.2fr)_minmax(240px,1.6fr)_80px_110px_110px] gap-3 border-b border-line bg-canvas px-5 py-2.5 text-[11px] font-semibold tracking-wide text-ink-2 uppercase">
          <span>Company</span>
          <span>Admins</span>
          <span className="text-right">People</span>
          <span className="text-right">Chats (30 days)</span>
          <span className="text-right">Created</span>
        </div>
        <div data-testid="account-list">
          {isLoading && <div className="p-8 text-center text-sm text-ink-2">Loading…</div>}
          {data?.length === 0 && (
            <div className="p-10 text-center text-sm text-ink-2">
              <Building2 className="mx-auto mb-2 size-7 text-ink-2/60" />
              No accounts yet.
            </div>
          )}
          {data?.map((a) => <AccountRow key={a.id} a={a} />)}
        </div>
      </Card>
    </div>
  );
}

function AccountRow({ a }: { a: PlatformAccount }) {
  return (
    <div className="grid grid-cols-[minmax(200px,1.2fr)_minmax(240px,1.6fr)_80px_110px_110px] items-start gap-3 border-b border-line px-5 py-3 text-[13px] last:border-b-0">
      <span className="min-w-0">
        <span className="block truncate font-semibold">{a.name}</span>
        <code className="block truncate text-[11px] text-ink-2">{a.id}</code>
      </span>
      <span className="flex min-w-0 flex-col gap-1.5">
        {a.admins.map((u) => (
          <AdminLine key={u.id} u={u} />
        ))}
      </span>
      <span className="text-right tabular-nums">{a.users}</span>
      <span className="text-right tabular-nums">
        {a.chats30d}
        {a.lastActivityAt && <span className="block text-[11px] text-ink-2">last {timeAgo(a.lastActivityAt)}</span>}
      </span>
      <span className="text-right text-xs text-ink-2">{timeAgo(a.createdAt)}</span>
    </div>
  );
}

function AdminLine({ u }: { u: PlatformAccount['admins'][number] }) {
  const link = useMutation({ mutationFn: () => api<{ setPasswordUrl: string; emailed: boolean }>(`/platform/users/${u.id}/welcome-link`, { method: 'POST' }) });
  return (
    <span className="flex flex-col gap-1">
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate">
          {u.name} <span className="text-ink-2">· {u.email}</span>
        </span>
        {!u.passwordSet && <Pill tone="warning">Hasn’t signed in yet</Pill>}
      </span>
      {!u.passwordSet && !link.data && (
        <button onClick={() => link.mutate()} disabled={link.isPending} className="w-fit cursor-pointer text-xs font-medium text-primary hover:underline">
          {link.isPending ? 'Making a new link…' : 'Send a new set-password link'}
        </button>
      )}
      {link.data && (
        <span className="flex flex-col gap-1">
          <span className="text-xs text-ink-2">{link.data.emailed ? 'Emailed again. Their link:' : 'Email isn’t set up — send them this link:'}</span>
          <CopyLink url={link.data.setPasswordUrl} />
        </span>
      )}
    </span>
  );
}
