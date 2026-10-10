import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { History as HistoryIcon, Mail, MessageCircle, Search, X } from 'lucide-react';
import type { Conversation, HistoryEntry, HistoryPage, Message } from '@replyfinch/shared';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useDesk } from '../lib/store';
import { dateTime, duration, initials, visitorLabel } from '../lib/format';
import { Avatar, Card, IconButton, Pill, RatingPill } from '../components/ui';
import { Transcript } from '../components/chat/Transcript';

const PERIODS = [
  { value: '', label: 'Any time' },
  { value: '1', label: 'Last 24 hours' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
];

const selectClass =
  'h-9 cursor-pointer rounded-lg border border-line bg-surface px-2.5 text-[13px] font-medium text-ink outline-none focus:border-primary';

function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

// With a chat open beside the list, drop the less important columns.
const COLS = {
  full: 'grid-cols-[minmax(180px,1.2fr)_minmax(200px,2fr)_120px_150px_80px_70px]',
  compact: 'grid-cols-[minmax(160px,1fr)_minmax(140px,1.4fr)_130px]',
};

const name = (e: HistoryEntry) => visitorLabel({ id: e.visitorId, name: e.visitorName });

export function History() {
  const [params, setParams] = useSearchParams();
  const team = useDesk((s) => s.team);
  const [q, setQ] = useState(params.get('q') ?? '');
  const query = useDebounced(q.trim());
  const status = params.get('status') ?? 'all';
  const agentId = params.get('agent') ?? '';
  const days = params.get('days') ?? '';
  const rating = params.get('rating') ?? '';
  const selectedId = params.get('c');

  const set = (patch: Record<string, string | null>) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        for (const [k, v] of Object.entries(patch)) {
          if (!v) next.delete(k);
          else next.set(k, v);
        }
        return next;
      },
      { replace: true },
    );
  useEffect(() => set({ q: query || null }), [query]); // eslint-disable-line react-hooks/exhaustive-deps

  const filters = { q: query, status, agentId, days, rating };
  const history = useInfiniteQuery({
    queryKey: ['history', filters],
    initialPageParam: '',
    queryFn: ({ pageParam }) => {
      const sp = new URLSearchParams();
      if (filters.q) sp.set('q', filters.q);
      if (filters.status !== 'all') sp.set('status', filters.status);
      if (filters.agentId) sp.set('agentId', filters.agentId);
      if (filters.days) sp.set('days', filters.days);
      if (filters.rating) sp.set('rating', filters.rating);
      if (pageParam) sp.set('cursor', pageParam);
      return api<HistoryPage>(`/history?${sp}`);
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = history.data?.pages.flatMap((p) => p.items) ?? [];
  const selected = items.find((i) => i.id === selectedId) ?? null;
  const filtered = !!(query || status !== 'all' || agentId || days || rating);
  const compact = !!selectedId;

  return (
    <div className="flex h-full flex-col gap-5 px-8 py-7">
      <div>
        <h1 className="text-[26px] font-bold">History</h1>
        <p className="text-sm text-ink-2">Every chat with your visitors. Search names, emails and anything that was said.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <label className="flex h-9 w-[320px] items-center gap-2 rounded-lg border border-line bg-surface px-3 focus-within:border-primary">
          <Search className="size-3.5 text-ink-2" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, email or message…"
            aria-label="Search chats"
            className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-ink-2"
          />
          {q && (
            <button onClick={() => setQ('')} aria-label="Clear search" className="cursor-pointer text-ink-2 hover:text-ink">
              <X className="size-3.5" />
            </button>
          )}
        </label>
        <select aria-label="Status" className={selectClass} value={status} onChange={(e) => set({ status: e.target.value === 'all' ? null : e.target.value })}>
          <option value="all">All chats</option>
          <option value="ended">Ended</option>
          <option value="open">Open now</option>
        </select>
        <select aria-label="Agent" className={selectClass} value={agentId} onChange={(e) => set({ agent: e.target.value || null })}>
          <option value="">Any agent</option>
          {team.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select aria-label="Rating" className={selectClass} value={rating} onChange={(e) => set({ rating: e.target.value || null })}>
          <option value="">Any rating</option>
          <option value="good">👍 Good</option>
          <option value="bad">👎 Bad</option>
          <option value="any">Rated</option>
        </select>
        <select aria-label="Period" className={selectClass} value={days} onChange={(e) => set({ days: e.target.value || null })}>
          {PERIODS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex min-h-0 flex-1 gap-5">
        <Card className="flex min-w-0 flex-1 flex-col">
          <div className={clsx('grid gap-3 border-b', compact ? COLS.compact : COLS.full, ' border-line bg-canvas px-5 py-2.5 text-[11px] font-semibold tracking-wide text-ink-2 uppercase')}>
            <span>Visitor</span>
            <span>First message</span>
            {!compact && <span>Agent</span>}
            <span>Started</span>
            {!compact && <span>Duration</span>}
            {!compact && <span className="text-right">Messages</span>}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto" data-testid="history-list">
            {history.isLoading && <div className="p-8 text-center text-sm text-ink-2">Loading…</div>}
            {history.isError && <div className="p-8 text-center text-sm text-danger">Couldn’t load your chat history.</div>}
            {history.isSuccess && items.length === 0 && (
              <div className="grid h-full place-items-center p-8 text-center text-sm text-ink-2">
                <div>
                  <HistoryIcon className="mx-auto mb-2 size-7 text-ink-2/60" />
                  {filtered ? 'No chats match these filters.' : 'No chats yet. They’ll show up here as soon as visitors start chatting.'}
                </div>
              </div>
            )}
            {items.map((e) => (
              <button
                key={e.id}
                onClick={() => set({ c: e.id })}
                className={clsx(
                  'grid w-full cursor-pointer items-center gap-3 border-b border-line px-5 py-3 text-left text-[13px] last:border-b-0',
                  compact ? COLS.compact : COLS.full,
                  e.id === selectedId ? 'bg-primary-subtle' : 'hover:bg-muted',
                )}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <Avatar text={initials(e.visitorName)} size={30} />
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate font-semibold">{name(e)}</span>
                      {e.rating && (
                        <span title={e.rating === 'good' ? 'Rated good' : 'Rated bad'} aria-label={e.rating === 'good' ? 'Rated good' : 'Rated bad'}>
                          {e.rating === 'good' ? '👍' : '👎'}
                        </span>
                      )}
                    </span>
                    <span className="block truncate text-xs text-ink-2">{e.visitorEmail ?? e.department ?? '—'}</span>
                  </span>
                </span>
                <span className="truncate text-ink-2">{e.preview ?? <em>Started by an agent</em>}</span>
                {!compact && <span className="truncate">{e.assigneeName ?? <span className="text-ink-2">Missed</span>}</span>}
                <span className="text-ink-2">{dateTime(e.startedAt)}</span>
                {!compact && (
                  <span className="text-ink-2">
                    {e.status === 'ended' ? duration((e.endedAt ?? e.startedAt) - e.startedAt) : <Pill tone="success">Open</Pill>}
                  </span>
                )}
                {!compact && <span className="text-right text-ink-2">{e.messageCount}</span>}
              </button>
            ))}
            {history.hasNextPage && (
              <div className="p-4 text-center">
                <button
                  onClick={() => history.fetchNextPage()}
                  disabled={history.isFetchingNextPage}
                  className="cursor-pointer rounded-lg border border-line px-4 py-2 text-[13px] font-semibold hover:bg-muted disabled:opacity-50"
                >
                  {history.isFetchingNextPage ? 'Loading…' : 'Load older chats'}
                </button>
              </div>
            )}
          </div>
        </Card>

        {selectedId && <ChatDetail id={selectedId} entry={selected} onClose={() => set({ c: null })} />}
      </div>
    </div>
  );
}

function ChatDetail({ id, entry, onClose }: { id: string; entry: HistoryEntry | null; onClose: () => void }) {
  const me = useAuth((s) => s.agent?.id);
  const { data, isError } = useQuery({
    queryKey: ['conversation', id],
    queryFn: () => api<{ conversation: Conversation; messages: Message[] }>(`/conversations/${id}`),
  });
  const c = data?.conversation;
  const visitorName = entry ? name(entry) : c ? visitorLabel({ id: c.visitorId, name: c.visitorName }) : '';
  const online = useDesk((s) => {
    const v = c && s.visitors[c.visitorId];
    return !!v && !v.left;
  });
  const openChat = useDesk((s) => s.openChat);

  return (
    <Card className="flex w-[460px] shrink-0 flex-col">
      <div className="flex items-start gap-3 border-b border-line px-5 py-4" data-testid="history-detail">
        <Avatar text={initials(c?.visitorName ?? entry?.visitorName)} size={40} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-bold">{visitorName}</div>
          {entry?.visitorEmail && (
            <a href={`mailto:${entry.visitorEmail}`} className="flex items-center gap-1 truncate text-xs text-primary hover:underline">
              <Mail className="size-3" /> {entry.visitorEmail}
            </a>
          )}
          {c && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-2">
              <span>{dateTime(c.startedAt)}</span>
              {c.endedAt && <span>· {duration(c.endedAt - c.startedAt)}</span>}
              {c.department && <Pill>{c.department}</Pill>}
              {c.status === 'ended' ? <Pill>Ended</Pill> : <Pill tone="success">Open</Pill>}
              <RatingPill rating={c.rating} />
            </div>
          )}
          {c?.ratingComment && (
            <div className="mt-2 rounded-lg bg-canvas px-3 py-2 text-xs text-ink" data-testid="rating-comment">
              “{c.ratingComment}”
            </div>
          )}
        </div>
        {online && (
          <IconButton label="Chat with this visitor" onClick={() => c && openChat(c.visitorId, 'side')}>
            <MessageCircle className="size-4" />
          </IconButton>
        )}
        <IconButton label="Close" onClick={onClose}>
          <X className="size-4" />
        </IconButton>
      </div>
      {isError ? (
        <div className="p-8 text-center text-sm text-danger">Couldn’t load this chat.</div>
      ) : (
        <Transcript messages={data?.messages ?? []} meId={me} empty={<div className="m-auto text-sm text-ink-2">Loading…</div>} />
      )}
    </Card>
  );
}
