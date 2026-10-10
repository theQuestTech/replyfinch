import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Search, Users, X } from 'lucide-react';
import type { CustomerList } from '@replyfinch/shared';
import { api } from '../lib/api';
import { useDesk } from '../lib/store';
import { initials, timeAgo, visitorLabel } from '../lib/format';
import { Avatar, Card, CountryCode } from '../components/ui';

const PAGE = 50;
const selectClass =
  'h-9 cursor-pointer rounded-lg border border-line bg-surface px-2.5 text-[13px] font-medium text-ink outline-none focus:border-primary';

export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export const customerName = (c: { id: string; name: string | null; email: string | null }) => c.name ?? c.email ?? visitorLabel(c);

export function Customers() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [q, setQ] = useState(params.get('q') ?? '');
  const query = useDebounced(q.trim());
  const tag = params.get('tag') ?? '';
  const sort = params.get('sort') ?? 'recent';
  const page = Math.max(0, Number(params.get('page') ?? 0) || 0);
  const live = useDesk((s) => s.visitors);

  const set = (patch: Record<string, string | null>) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        for (const [k, v] of Object.entries(patch)) {
          if (!v) next.delete(k);
          else next.set(k, v);
        }
        if (!('page' in patch)) next.delete('page'); // new filters start on page 1
        return next;
      },
      { replace: true },
    );
  useEffect(() => {
    if ((params.get('q') ?? '') !== query) set({ q: query || null });
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: tags = [] } = useQuery({ queryKey: ['customers', 'tags'], queryFn: () => api<string[]>('/customers/tags') });
  const { data, isLoading, isError, isFetching } = useQuery({
    queryKey: ['customers', { query, tag, sort, page }],
    queryFn: () => {
      const sp = new URLSearchParams({ sort, offset: String(page * PAGE), limit: String(PAGE) });
      if (query) sp.set('q', query);
      if (tag) sp.set('tag', tag);
      return api<CustomerList>(`/customers?${sp}`);
    },
    placeholderData: keepPreviousData,
  });
  const total = data?.total ?? 0;
  const filtered = !!(query || tag);

  return (
    <div className="flex min-h-full flex-col gap-5 px-8 py-7">
      <div>
        <div className="flex items-center gap-2.5">
          <h1 className="text-[26px] font-bold">Customers</h1>
          {data && <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-ink-2">{total.toLocaleString()}</span>}
        </div>
        <p className="text-sm text-ink-2">Everyone who chatted with you, left a message, or told you their name.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <label className="flex h-9 w-[320px] items-center gap-2 rounded-lg border border-line bg-surface px-3 focus-within:border-primary">
          <Search className="size-3.5 text-ink-2" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, email, phone, notes, tags…"
            aria-label="Search customers"
            className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-ink-2"
          />
          {q && (
            <button onClick={() => setQ('')} aria-label="Clear search" className="cursor-pointer text-ink-2 hover:text-ink">
              <X className="size-3.5" />
            </button>
          )}
        </label>
        <select aria-label="Tag" className={selectClass} value={tag} onChange={(e) => set({ tag: e.target.value || null })}>
          <option value="">Any tag</option>
          {tags.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select aria-label="Sort" className={selectClass} value={sort} onChange={(e) => set({ sort: e.target.value === 'recent' ? null : e.target.value })}>
          <option value="recent">Recently seen</option>
          <option value="chats">Most chats</option>
          <option value="name">Name A–Z</option>
        </select>
      </div>

      <Card className={clsx('flex flex-col transition-opacity', isFetching && data && 'opacity-60')}>
        <div className="grid grid-cols-[minmax(220px,1.6fr)_minmax(160px,1.2fr)_70px_100px_110px] gap-3 border-b border-line bg-canvas px-5 py-2.5 text-[11px] font-semibold tracking-wide text-ink-2 uppercase">
          <span>Customer</span>
          <span>Tags</span>
          <span className="text-right">Chats</span>
          <span className="text-right">Ratings</span>
          <span className="text-right">Last seen</span>
        </div>
        <div data-testid="customer-list">
          {isLoading && <div className="p-8 text-center text-sm text-ink-2">Loading…</div>}
          {isError && <div className="p-8 text-center text-sm text-danger">Couldn’t load customers.</div>}
          {data && data.items.length === 0 && (
            <div className="p-10 text-center text-sm text-ink-2">
              <Users className="mx-auto mb-2 size-7 text-ink-2/60" />
              {filtered ? 'No customers match.' : 'Customers appear here once visitors chat with you or leave a message.'}
            </div>
          )}
          {data?.items.map((c) => {
            const online = !!live[c.id] && !live[c.id]!.left;
            return (
              <button
                key={c.id}
                onClick={() => navigate(`/customers/${c.id}`)}
                className="grid w-full cursor-pointer grid-cols-[minmax(220px,1.6fr)_minmax(160px,1.2fr)_70px_100px_110px] items-center gap-3 border-b border-line px-5 py-3 text-left text-[13px] last:border-b-0 hover:bg-muted"
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <span className="relative">
                    <Avatar text={initials(c.name ?? c.email)} size={32} />
                    {online && <span className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full bg-success ring-2 ring-surface" aria-label="Online now" />}
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate font-semibold">{customerName(c)}</span>
                      <CountryCode code={c.country} />
                    </span>
                    <span className="block truncate text-xs text-ink-2">{c.name ? (c.email ?? c.phone ?? '—') : (c.phone ?? '—')}</span>
                  </span>
                </span>
                <span className="flex min-w-0 flex-wrap gap-1">
                  {c.tags.slice(0, 3).map((t) => (
                    <span key={t} className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-ink-2">
                      {t}
                    </span>
                  ))}
                  {c.tags.length > 3 && <span className="text-[11px] text-ink-2">+{c.tags.length - 3}</span>}
                </span>
                <span className="text-right tabular-nums">{c.chats}</span>
                <span className="text-right text-xs text-ink-2 tabular-nums">
                  {c.good + c.bad ? (
                    <>
                      {c.good > 0 && <span>👍 {c.good}</span>} {c.bad > 0 && <span>👎 {c.bad}</span>}
                    </>
                  ) : (
                    '—'
                  )}
                </span>
                <span className="text-right text-xs text-ink-2">{online ? <span className="font-semibold text-success">Online now</span> : timeAgo(c.lastSeenAt)}</span>
              </button>
            );
          })}
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
      <p className="text-xs text-ink-2">
        Tip: tags and notes you add in a chat window show up here. <Link to="/history" className="text-primary hover:underline">History</Link> has every
        conversation.
      </p>
    </div>
  );
}
