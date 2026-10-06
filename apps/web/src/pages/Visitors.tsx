import clsx from 'clsx';
import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Clock, Eye, Globe, List, Map as MapIcon, MessageCircle, Monitor, Search, Smartphone, Tablet } from 'lucide-react';
import type { VisitorState } from '@replyfinch/shared';
import { duration, referrerHost, shortUrl, visitorLabel } from '../lib/format';
import { useDesk, type DeskVisitor } from '../lib/store';
import { Button, Card, CountryCode, Pill } from '../components/ui';

const SECTIONS: { state: VisitorState; label: string; tone: 'success' | 'primary' | 'muted' }[] = [
  { state: 'chatting', label: 'Chatting now', tone: 'success' },
  { state: 'browsing', label: 'Browsing', tone: 'primary' },
  { state: 'idle', label: 'Idle', tone: 'muted' },
];

export function Visitors() {
  const visitors = useDesk((s) => s.visitors);
  const active = useDesk((s) => s.active);
  const openChat = useDesk((s) => s.openChat);
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, []);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return Object.values(visitors)
      .filter((v) => !v.left)
      .filter(
        (v) =>
          !q ||
          [visitorLabel(v), v.email, v.currentPage?.title, v.currentPage?.url].some((s) => s?.toLowerCase().includes(q)),
      )
      .sort((a, b) => a.onlineSince - b.onlineSince);
  }, [visitors, query]);
  const counts = Object.fromEntries(SECTIONS.map((s) => [s.state, list.filter((v) => v.state === s.state).length]));

  return (
    <div className="flex min-h-full flex-col gap-5 px-8 py-7">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2.5">
            <h1 className="text-[26px] font-bold">Visitors</h1>
            <Pill tone="success">
              <span className="size-[7px] animate-pulse rounded-full bg-success" /> Live
            </Pill>
          </div>
          <p className="text-sm text-ink-2">
            {list.length} {list.length === 1 ? 'person' : 'people'} on your websites right now · {counts.chatting} chatting · {counts.browsing}{' '}
            browsing · {counts.idle} idle
          </p>
        </div>
        <div className="flex gap-0.5 rounded-[10px] bg-muted p-1">
          <span className="flex items-center gap-1.5 rounded-[7px] bg-surface px-3 py-1.5 text-[13px] font-semibold shadow-sm">
            <List className="size-3.5" /> List
          </span>
          <span className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium text-ink-2" title="Coming soon">
            <MapIcon className="size-3.5" /> Map
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2.5">
        <span className="flex items-center gap-2 rounded-lg border border-line bg-surface py-2 pr-2.5 pl-3 text-[13px] font-medium">
          Group by: Activity <ChevronDown className="size-3.5 text-ink-2" />
        </span>
        <div className="flex-1" />
        <label className="flex h-9 w-[260px] items-center gap-2 rounded-lg border border-line bg-surface px-3">
          <Search className="size-3.5 text-ink-2" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, email, page…"
            className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-ink-2"
          />
        </label>
      </div>

      <Card className={clsx('flex-1', active?.mode === 'side' && 'mr-[0px]')}>
        <div className="flex items-center gap-3 bg-muted px-5 py-2.5 text-[11px] font-semibold tracking-wide text-ink-2 uppercase">
          <span className="w-[230px]">Visitor</span>
          <span className="w-[72px]">Online</span>
          <span className="flex-1">Viewing</span>
          <span className="w-[120px]">Referrer</span>
          <span className="w-12 text-center">Visits</span>
          <span className="w-[124px]" />
        </div>
        {list.length === 0 && (
          <div className="py-16 text-center text-sm text-ink-2">
            <Eye className="mx-auto mb-2 size-6 text-primary" />
            No one is on your websites right now. Visitors appear here the moment they land.
          </div>
        )}
        {SECTIONS.map((sec) => {
          const rows = list.filter((v) => v.state === sec.state);
          if (!rows.length) return null;
          const isCollapsed = collapsed[sec.state];
          return (
            <div key={sec.state}>
              <button
                onClick={() => setCollapsed((c) => ({ ...c, [sec.state]: !c[sec.state] }))}
                className="flex w-full cursor-pointer items-center gap-2.5 px-5 pt-3 pb-2"
              >
                <span className="rounded-md border border-line p-0.5 text-ink-2">
                  {isCollapsed ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}
                </span>
                <span className="text-sm font-semibold">{sec.label}</span>
                <Pill tone={sec.tone}>{rows.length}</Pill>
              </button>
              {!isCollapsed &&
                rows.map((v) => <Row key={v.id} v={v} selected={active?.visitorId === v.id} onOpen={() => openChat(v.id, 'side')} />)}
            </div>
          );
        })}
      </Card>
    </div>
  );
}

function Row({ v, selected, onOpen }: { v: DeskVisitor; selected: boolean; onOpen: () => void }) {
  const StateIcon = v.state === 'chatting' ? MessageCircle : v.state === 'idle' ? Clock : Eye;
  const DeviceIcon = v.device === 'mobile' ? Smartphone : v.device === 'tablet' ? Tablet : Monitor;
  const waiting = useDesk((s) => (v.conversationId ? s.conversations[v.conversationId]?.status === 'waiting' : false));
  const unread = useDesk((s) => s.unread[v.id] ?? 0);
  return (
    <div
      onClick={onOpen}
      data-testid="visitor-row"
      className={clsx(
        'flex cursor-pointer items-center gap-3 border-b border-line px-5 py-2.5 hover:bg-canvas',
        selected && 'bg-primary-subtle hover:bg-primary-subtle',
      )}
    >
      <div className="flex w-[230px] items-center gap-2.5">
        <span
          className={clsx(
            'grid size-7 shrink-0 place-items-center rounded-lg',
            v.state === 'chatting' ? 'bg-success-subtle text-success' : v.state === 'idle' ? 'bg-muted text-ink-2' : 'bg-primary-subtle text-primary',
          )}
        >
          <StateIcon className="size-4" />
        </span>
        <div className="min-w-0">
          <div className={clsx('truncate text-[13px] font-semibold', v.state === 'idle' && 'text-ink-2')}>{visitorLabel(v)}</div>
          <div className="flex items-center gap-1.5 text-[11px] text-ink-2">
            <CountryCode code={v.country} />
            <DeviceIcon className="size-3" />
            {v.browser} · {v.os}
          </div>
        </div>
      </div>
      <span className="w-[72px] text-[13px] font-medium">{duration(Date.now() - v.onlineSince)}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="rounded bg-muted px-1.5 text-[11px] font-semibold text-ink-2">{v.path.length}</span>
          <span className="truncate text-[13px]">{v.currentPage?.title ?? '—'}</span>
        </div>
        <div className="truncate text-[11px] text-ink-2">{v.currentPage ? shortUrl(v.currentPage.url) : ''}</div>
      </div>
      <span className="flex w-[120px] items-center gap-1.5 truncate text-xs text-ink-2">
        <Globe className="size-3 shrink-0" />
        {referrerHost(v.referrer)}
      </span>
      <span className="w-12 text-center text-[13px] font-medium">{v.visits}</span>
      <span className="flex w-[124px] justify-end">
        <Button
          className="whitespace-nowrap"
          variant={v.state === 'chatting' ? (waiting ? 'primary' : 'success') : selected ? 'primary' : 'secondary'}
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
        >
          {v.state === 'chatting' ? (waiting ? 'Join chat' : 'Open chat') : 'Start chat'}
          {unread > 0 && <span className="rounded-full bg-danger px-1.5 text-[10px] text-white">{unread}</span>}
        </Button>
      </span>
    </div>
  );
}
