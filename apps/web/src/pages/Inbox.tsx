import clsx from 'clsx';
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, Copy, Globe, Inbox as InboxIcon, Mail, MessageCircle, RotateCcw } from 'lucide-react';
import type { OfflineMessage } from '@replyfinch/shared';
import { api } from '../lib/api';
import { queryClient } from '../lib/query';
import { useDesk } from '../lib/store';
import { dateTime, initials, shortUrl, timeAgo } from '../lib/format';
import { Avatar, Button, Card, Pill } from '../components/ui';

type Filter = 'new' | 'handled' | 'all';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'new', label: 'New' },
  { id: 'handled', label: 'Handled' },
  { id: 'all', label: 'All' },
];

export function useOfflineCount() {
  return useQuery({
    queryKey: ['offline', 'count'],
    queryFn: () => api<{ new: number }>('/offline-messages/count'),
    select: (r) => r.new,
  });
}

/** A ready-to-send email reply in the agent's own mail app. */
function replyLink(m: OfflineMessage) {
  const first = m.name.split(' ')[0] ?? m.name;
  const quoted = m.message
    .split('\n')
    .map((l) => `> ${l}`)
    .join('\n');
  const subject = `Re: ${m.department ? `${m.department} — ` : ''}your message`;
  const body = `Hi ${first},\n\n\n\n---\nOn ${new Date(m.createdAt).toLocaleString()} you wrote:\n${quoted}`;
  return `mailto:${encodeURIComponent(m.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function Inbox() {
  const [params, setParams] = useSearchParams();
  const filter = (params.get('f') as Filter | null) ?? 'new';
  const selectedId = params.get('m');
  const { data: count = 0 } = useOfflineCount();
  const { data: list = [], isLoading } = useQuery({
    queryKey: ['offline', 'list', filter],
    queryFn: () => api<OfflineMessage[]>(`/offline-messages${filter === 'all' ? '' : `?status=${filter}`}`),
  });
  // A message opened from a notification may not be in the current filter; fetch "all" for it.
  const { data: all = [] } = useQuery({
    queryKey: ['offline', 'list', 'all'],
    queryFn: () => api<OfflineMessage[]>('/offline-messages'),
    enabled: !!selectedId && !list.some((m) => m.id === selectedId),
  });
  const selected = useMemo(
    () => list.find((m) => m.id === selectedId) ?? all.find((m) => m.id === selectedId) ?? null,
    [list, all, selectedId],
  );

  const select = (patch: Record<string, string | null>) =>
    setParams((p) => {
      const next = new URLSearchParams(p);
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) next.delete(k);
        else next.set(k, v);
      }
      return next;
    });

  return (
    <div className="flex h-full flex-col gap-5 px-8 py-7">
      <div>
        <h1 className="text-[26px] font-bold">Inbox</h1>
        <p className="text-sm text-ink-2">Messages visitors left while nobody was online. Reply by email, then mark them handled.</p>
      </div>

      <div className="flex min-h-0 flex-1 gap-5">
        <Card className="flex w-[380px] shrink-0 flex-col">
          <div className="flex gap-1 border-b border-line p-2" role="tablist">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                role="tab"
                aria-selected={filter === f.id}
                onClick={() => select({ f: f.id === 'new' ? null : f.id })}
                className={clsx(
                  'flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold',
                  filter === f.id ? 'bg-primary-subtle text-primary' : 'text-ink-2 hover:bg-muted',
                )}
              >
                {f.label}
                {f.id === 'new' && count > 0 && <span className="rounded-full bg-danger px-1.5 text-[10px] leading-4 text-white">{count}</span>}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto" data-testid="offline-list">
            {!isLoading && list.length === 0 && (
              <div className="grid h-full place-items-center p-8 text-center text-sm text-ink-2">
                <div>
                  <InboxIcon className="mx-auto mb-2 size-7 text-ink-2/60" />
                  {filter === 'new' ? 'You’re all caught up.' : 'No messages yet.'}
                </div>
              </div>
            )}
            {list.map((m) => (
              <button
                key={m.id}
                onClick={() => select({ m: m.id })}
                className={clsx(
                  'flex w-full cursor-pointer gap-3 border-b border-line px-4 py-3 text-left last:border-b-0',
                  m.id === selectedId ? 'bg-primary-subtle' : 'hover:bg-muted',
                )}
              >
                <Avatar text={initials(m.name)} size={34} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className={clsx('truncate text-sm', m.status === 'new' ? 'font-bold' : 'font-medium')}>{m.name}</span>
                    {m.status === 'new' && <span className="size-2 shrink-0 rounded-full bg-primary" aria-label="New" />}
                    <span className="ml-auto shrink-0 text-[11px] text-ink-2">{timeAgo(m.createdAt)}</span>
                  </span>
                  <span className="block truncate text-[13px] text-ink-2">{m.message}</span>
                </span>
              </button>
            ))}
          </div>
        </Card>

        <Card className="flex min-w-0 flex-1 flex-col">
          {selected ? (
            <MessageDetail m={selected} />
          ) : (
            <div className="grid h-full place-items-center text-sm text-ink-2">Select a message to read it.</div>
          )}
        </Card>
      </div>
    </div>
  );
}

function MessageDetail({ m }: { m: OfflineMessage }) {
  const online = useDesk((s) => {
    const v = s.visitors[m.visitorId];
    return !!v && !v.left;
  });
  const openChat = useDesk((s) => s.openChat);
  const setStatus = useMutation({
    mutationFn: (status: 'new' | 'handled') =>
      api<OfflineMessage>(`/offline-messages/${m.id}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['offline'] }),
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="offline-detail">
      <div className="flex items-start gap-3.5 border-b border-line px-6 py-5">
        <Avatar text={initials(m.name)} size={44} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-lg font-bold">{m.name}</h2>
            {m.status === 'new' ? <Pill tone="primary">New</Pill> : <Pill tone="success">Handled</Pill>}
            {online && <Pill tone="success">On your website now</Pill>}
          </div>
          <div className="flex items-center gap-1.5 text-sm text-ink-2">
            <a href={`mailto:${m.email}`} className="text-primary hover:underline">
              {m.email}
            </a>
            <button
              onClick={() => navigator.clipboard?.writeText(m.email)}
              className="cursor-pointer rounded p-1 hover:bg-muted"
              aria-label="Copy email address"
              title="Copy email address"
            >
              <Copy className="size-3.5" />
            </button>
          </div>
        </div>
        <div className="text-right text-xs text-ink-2">{dateTime(m.createdAt)}</div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
        <div className="flex flex-wrap gap-2 text-xs text-ink-2">
          {m.department && <Pill>{m.department}</Pill>}
          {m.pageUrl && (
            <a href={m.pageUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-ink hover:underline">
              <Globe className="size-3.5" /> Sent from {shortUrl(m.pageUrl)}
            </a>
          )}
        </div>
        <div className="rounded-xl border border-line bg-canvas px-4 py-3.5 text-sm whitespace-pre-wrap break-words">{m.message}</div>
        {m.status === 'handled' && (
          <div className="text-xs text-ink-2">
            Marked handled{m.handledByName ? ` by ${m.handledByName}` : ''}
            {m.handledAt ? ` · ${dateTime(m.handledAt)}` : ''}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-line px-6 py-4">
        <a
          href={replyLink(m)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-primary/90"
        >
          <Mail className="size-4" /> Reply by email
        </a>
        {online && (
          <Button onClick={() => openChat(m.visitorId, 'side')}>
            <MessageCircle className="size-4" /> Start chat
          </Button>
        )}
        <div className="flex-1" />
        {m.status === 'new' ? (
          <Button variant="success" disabled={setStatus.isPending} onClick={() => setStatus.mutate('handled')}>
            <Check className="size-4" /> Mark as handled
          </Button>
        ) : (
          <Button disabled={setStatus.isPending} onClick={() => setStatus.mutate('new')}>
            <RotateCcw className="size-4" /> Reopen
          </Button>
        )}
      </div>
    </div>
  );
}
