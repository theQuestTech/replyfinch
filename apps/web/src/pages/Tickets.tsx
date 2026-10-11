import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Plus, Search, Ticket as TicketIcon, X } from 'lucide-react';
import type { TicketList, TicketView } from '@replyfinch/shared';
import { api } from '../lib/api';
import { timeAgo } from '../lib/format';
import { PRIORITY, STATUS, useTicketCounts } from '../lib/tickets';
import { Card, Pill } from '../components/ui';
import { NewTicketModal } from '../components/tickets/NewTicketModal';
import { useDebounced } from './Customers';

const PAGE = 50;
const VIEWS: { id: TicketView; label: string }[] = [
  { id: 'unsolved', label: 'All unsolved' },
  { id: 'mine', label: 'Assigned to me' },
  { id: 'unassigned', label: 'Unassigned' },
  { id: 'open', label: 'Open' },
  { id: 'pending', label: 'Pending' },
  { id: 'solved', label: 'Solved' },
  { id: 'all', label: 'All tickets' },
];
const COLS = 'grid-cols-[64px_minmax(240px,1fr)_96px_80px_150px_96px]';

export function Tickets() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const view: TicketView = VIEWS.some((v) => v.id === params.get('view')) ? (params.get('view') as TicketView) : 'unsolved';
  const [q, setQ] = useState(params.get('q') ?? '');
  const query = useDebounced(q.trim());
  const page = Math.max(0, Number(params.get('page') ?? 0) || 0);
  const [creating, setCreating] = useState(false);

  const set = (patch: Record<string, string | null>) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        for (const [k, v] of Object.entries(patch)) {
          if (!v) next.delete(k);
          else next.set(k, v);
        }
        if (!('page' in patch)) next.delete('page');
        return next;
      },
      { replace: true },
    );
  useEffect(() => {
    if ((params.get('q') ?? '') !== query) set({ q: query || null });
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: counts } = useTicketCounts();
  const { data, isLoading, isError, isFetching } = useQuery({
    queryKey: ['tickets', 'list', { view, query, page }],
    queryFn: () => {
      const sp = new URLSearchParams({ view, offset: String(page * PAGE), limit: String(PAGE) });
      if (query) sp.set('q', query);
      return api<TicketList>(`/tickets?${sp}`);
    },
    placeholderData: keepPreviousData,
  });
  const total = data?.total ?? 0;

  return (
    <div className="flex min-h-full flex-col gap-5 px-8 py-7">
      {creating && <NewTicketModal onClose={() => setCreating(false)} />}
      <div className="flex items-start gap-4">
        <div className="flex-1">
          <h1 className="text-[26px] font-bold">Tickets</h1>
          <p className="text-sm text-ink-2">Requests that need follow-up: from chats, offline messages, phone calls or anywhere else.</p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-primary/90"
        >
          <Plus className="size-4" /> New ticket
        </button>
      </div>

      <div className="flex items-start gap-5">
        <Card className="flex w-[210px] shrink-0 flex-col p-2">
          <nav aria-label="Ticket views" className="flex flex-col gap-0.5">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                onClick={() => set({ view: v.id === 'unsolved' ? null : v.id })}
                aria-current={view === v.id ? 'page' : undefined}
                className={clsx(
                  'flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px]',
                  view === v.id ? 'bg-primary-subtle font-semibold text-primary' : 'text-ink hover:bg-muted',
                )}
              >
                <span className="flex-1">{v.label}</span>
                {counts && <span className="text-xs text-ink-2 tabular-nums">{counts[v.id].toLocaleString()}</span>}
              </button>
            ))}
          </nav>
        </Card>

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <label className="flex h-9 w-[340px] items-center gap-2 rounded-lg border border-line bg-surface px-3 focus-within:border-primary">
            <Search className="size-3.5 text-ink-2" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search #number, subject, customer…"
              aria-label="Search tickets"
              className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-ink-2"
            />
            {q && (
              <button onClick={() => setQ('')} aria-label="Clear search" className="cursor-pointer text-ink-2 hover:text-ink">
                <X className="size-3.5" />
              </button>
            )}
          </label>

          <Card className={clsx('flex flex-col transition-opacity', isFetching && data && 'opacity-60')}>
            <div className={clsx('grid gap-3 border-b border-line bg-canvas px-5 py-2.5 text-[11px] font-semibold tracking-wide text-ink-2 uppercase', COLS)}>
              <span>#</span>
              <span>Subject</span>
              <span>Status</span>
              <span>Priority</span>
              <span>Assignee</span>
              <span className="text-right">Updated</span>
            </div>
            <div data-testid="ticket-list">
              {isLoading && <div className="p-8 text-center text-sm text-ink-2">Loading…</div>}
              {isError && <div className="p-8 text-center text-sm text-danger">Couldn’t load tickets.</div>}
              {data && data.items.length === 0 && (
                <div className="p-10 text-center text-sm text-ink-2">
                  <TicketIcon className="mx-auto mb-2 size-7 text-ink-2/60" />
                  {query ? 'No tickets match.' : view === 'all' ? 'No tickets yet. Create one here, from a chat, or from an offline message.' : 'Nothing here right now.'}
                </div>
              )}
              {data?.items.map((t) => (
                <button
                  key={t.id}
                  onClick={() => navigate(`/tickets/${t.id}`)}
                  className={clsx('grid w-full cursor-pointer items-center gap-3 border-b border-line px-5 py-3 text-left text-[13px] last:border-b-0 hover:bg-muted', COLS)}
                >
                  <span className="text-ink-2 tabular-nums">#{t.number}</span>
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{t.subject}</span>
                    <span className="block truncate text-xs text-ink-2">{t.requesterName ?? t.requesterEmail ?? 'No customer'}</span>
                  </span>
                  <span>
                    <Pill tone={STATUS[t.status].tone}>{STATUS[t.status].label}</Pill>
                  </span>
                  <span className={PRIORITY[t.priority].className}>{PRIORITY[t.priority].label}</span>
                  <span className={clsx('truncate', !t.assigneeName && 'text-ink-2')}>{t.assigneeName ?? 'Unassigned'}</span>
                  <span className="text-right text-xs text-ink-2">{timeAgo(t.updatedAt)}</span>
                </button>
              ))}
            </div>
            {total > PAGE && (
              <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3 text-xs text-ink-2">
                {page * PAGE + 1}–{Math.min(total, (page + 1) * PAGE)} of {total.toLocaleString()}
                <button
                  aria-label="Previous page"
                  disabled={page === 0}
                  onClick={() => set({ page: page - 1 ? String(page - 1) : null })}
                  className="cursor-pointer rounded-md border border-line p-1 hover:bg-muted disabled:cursor-default disabled:opacity-40"
                >
                  <ChevronLeft className="size-4" />
                </button>
                <button
                  aria-label="Next page"
                  disabled={(page + 1) * PAGE >= total}
                  onClick={() => set({ page: String(page + 1) })}
                  className="cursor-pointer rounded-md border border-line p-1 hover:bg-muted disabled:cursor-default disabled:opacity-40"
                >
                  <ChevronRight className="size-4" />
                </button>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
