import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { CircleAlert, Clock, Eye, MessageCircle, Users } from 'lucide-react';
import { FIRST_REPLY_TARGET_MS, type HomeStats } from '@replyfinch/shared';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { duration, greeting, initials, visitorLabel } from '../lib/format';
import { useDesk } from '../lib/store';
import { Avatar, Button, Card, Pill, StatusDot } from '../components/ui';

export function Home() {
  const agent = useAuth((s) => s.agent)!;
  const conversations = useDesk((s) => s.conversations);
  const visitors = useDesk((s) => s.visitors);
  const team = useDesk((s) => s.team);
  const openChat = useDesk((s) => s.openChat);
  const navigate = useNavigate();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(t);
  }, []);

  const convList = Object.values(conversations);
  const stats = useQuery({
    queryKey: ['stats', 'home', convList.length, convList.filter((c) => c.status === 'waiting').length],
    queryFn: () => api<HomeStats>('/stats/home'),
    refetchInterval: 30_000,
  });
  const s = stats.data;
  const queue = convList
    .filter((c) => c.status === 'waiting' || (c.status === 'active' && !c.assigneeId))
    .sort((a, b) => a.startedAt - b.startedAt);
  const online = team.filter((t) => t.status !== 'offline');
  const visitorsOnline = Object.values(visitors).filter((v) => !v.left).length;

  const nearTarget = queue.filter((c) => FIRST_REPLY_TARGET_MS - (now - c.startedAt) < 60_000).length;

  return (
    <div className="flex min-h-full flex-col gap-6 px-8 py-7">
      <div className="flex items-end">
        <div className="flex-1">
          <h1 className="text-[26px] font-bold">
            {greeting()}, {agent.name.split(' ')[0]}
          </h1>
          <p className="text-sm text-ink-2">
            <span className={clsx('font-semibold', queue.length ? 'text-danger' : 'text-success')}>
              {queue.length ? `${queue.length} customer${queue.length > 1 ? 's' : ''} waiting` : 'No one waiting'}
            </span>
            {nearTarget > 0 && ` · ${nearTarget} close to or past the 2-minute first-reply target`}
            {' · '}
            {visitorsOnline} {visitorsOnline === 1 ? 'person' : 'people'} on your websites right now
          </p>
        </div>
        <div className="flex gap-0.5 rounded-[10px] bg-muted p-1">
          <span className="rounded-[7px] bg-surface px-3 py-1.5 text-[13px] font-semibold shadow-sm">Today</span>
          {['7 days', '30 days'].map((r) => (
            <span key={r} title="Coming soon" className="px-3 py-1.5 text-[13px] font-medium text-ink-2/60">
              {r}
            </span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Stat icon={CircleAlert} tone="danger" label="Waiting in queue" value={String(s?.waiting ?? queue.length)} sub="Customers without an agent" />
        <Stat icon={MessageCircle} tone="primary" label="Open conversations" value={String(s?.open ?? '–')} sub={`${s?.assignedToMe ?? 0} assigned to you`} />
        <Stat
          icon={Clock}
          tone="primary"
          label="Avg. first reply (today)"
          value={s?.avgFirstReplySeconds == null ? '–' : duration(s.avgFirstReplySeconds * 1000)}
          sub={`${s?.conversationsToday ?? 0} conversations today`}
        />
        <Stat icon={Eye} tone="success" label="Visitors online" value={String(visitorsOnline)} sub="Live on your websites" />
      </div>

      <div className="flex min-h-[420px] flex-1 gap-6">
        <Card className="flex flex-1 flex-col">
          <div className="flex items-center gap-2.5 px-5 pt-4 pb-3">
            <h2 className="text-base font-bold">Live queue</h2>
            <Pill tone={queue.length ? 'danger' : 'success'}>{queue.length} waiting</Pill>
          </div>
          <div className="h-px bg-line" />
          {queue.length === 0 && (
            <div className="m-auto py-12 text-center text-sm text-ink-2">
              <MessageCircle className="mx-auto mb-2 size-6 text-success" />
              All caught up — new chats will appear here instantly.
            </div>
          )}
          {queue.map((c, i) => {
            const v = visitors[c.visitorId];
            const label = c.visitorName ?? (v ? visitorLabel(v) : 'Visitor');
            const waited = now - c.startedAt;
            const left = FIRST_REPLY_TARGET_MS - waited;
            return (
              <div
                key={c.id}
                data-testid="queue-row"
                className={clsx('flex items-center gap-3.5 border-b border-line px-5 py-3.5', i === 0 && 'bg-primary-subtle')}
              >
                <Avatar text={initials(label)} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{label}</span>
                    <MessageCircle className="size-3.5 text-ink-2" />
                    <span className="text-xs text-ink-2">Web chat{c.department ? ` · ${c.department}` : ''}</span>
                  </div>
                  <div className="truncate text-[13px] text-ink-2">{c.preview ?? 'Waiting for an agent'}</div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="text-xs font-medium text-ink-2">Waiting {duration(waited)}</span>
                  <Pill tone={left <= 0 ? 'danger' : left < 60_000 ? 'danger' : 'warning'}>
                    {left <= 0 ? `Overdue ${duration(-left)}` : `Reply in ${duration(left)}`}
                  </Pill>
                </div>
                <Button variant={i === 0 ? 'primary' : 'secondary'} onClick={() => openChat(c.visitorId, 'side')} disabled={!v || v.left}>
                  Accept
                </Button>
              </div>
            );
          })}
          <div className="flex-1" />
          <div className="flex items-center border-t border-line px-5 py-3.5 text-xs text-ink-2">
            Chats wait here until an agent accepts them and sends the first message.
            <div className="flex-1" />
            <button onClick={() => navigate('/visitors')} className="cursor-pointer text-[13px] font-semibold text-primary">
              Open visitors →
            </button>
          </div>
        </Card>

        <div className="flex w-[380px] shrink-0 flex-col gap-6">
          <Card>
            <div className="flex items-center px-5 pt-4 pb-2">
              <h2 className="flex-1 text-base font-bold">Team online</h2>
              <span className="text-xs font-medium text-ink-2">
                {online.length} of {team.length} agents
              </span>
            </div>
            <div className="px-5 pb-3">
              {team.map((t) => (
                <div key={t.id} className="flex items-center gap-3 py-2">
                  <span className="relative">
                    <Avatar text={initials(t.name)} />
                    <StatusDot status={t.status} className="absolute -right-0.5 -bottom-0.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold">
                      {t.name}
                      {t.id === agent.id && ' (you)'}
                    </div>
                    <div className="text-xs text-ink-2 capitalize">{t.status}</div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-xs font-medium text-ink-2">
                      {t.activeChats} / {t.maxChats} chats
                    </span>
                    <span className="h-1.5 w-[72px] overflow-hidden rounded-full bg-muted">
                      <span
                        className={clsx('block h-full rounded-full', t.activeChats >= t.maxChats ? 'bg-warning' : 'bg-primary')}
                        style={{ width: `${Math.min(100, (t.activeChats / t.maxChats) * 100)}%` }}
                      />
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="flex flex-1 flex-col px-5 py-4">
            <div className="flex items-center">
              <h2 className="flex-1 text-base font-bold">Conversations today</h2>
              <span className="text-xs font-medium text-ink-2">{s?.conversationsToday ?? 0} total</span>
            </div>
            <HourChart data={s?.chatsByHour ?? []} />
          </Card>
        </div>
      </div>
    </div>
  );
}

function Stat({
  icon: Icon,
  tone,
  label,
  value,
  sub,
}: {
  icon: typeof Users;
  tone: 'primary' | 'danger' | 'success';
  label: string;
  value: string;
  sub: string;
}) {
  const t = { primary: 'bg-primary-subtle text-primary', danger: 'bg-danger-subtle text-danger', success: 'bg-success-subtle text-success' }[tone];
  return (
    <Card className="flex flex-col gap-2.5 px-5 py-[18px]">
      <div className="flex items-center gap-2">
        <span className={clsx('grid size-7 place-items-center rounded-lg', t)}>
          <Icon className="size-4" />
        </span>
        <span className="text-[13px] font-medium text-ink-2">{label}</span>
      </div>
      <div className="text-[28px] leading-none font-bold">{value}</div>
      <div className="text-xs font-medium text-ink-2">{sub}</div>
    </Card>
  );
}

/** Conversations per hour over the last 12 hours (local time), current hour highlighted. */
function HourChart({ data }: { data: { hour: number; count: number }[] }) {
  const offset = -new Date().getTimezoneOffset() / 60;
  const byLocal = new Map<number, number>();
  for (const d of data) {
    const h = (((d.hour + offset) % 24) + 24) % 24;
    byLocal.set(h, (byLocal.get(h) ?? 0) + d.count);
  }
  const current = new Date().getHours();
  const hours = Array.from({ length: 12 }, (_, i) => (current - 11 + i + 24) % 24).filter((h) => h <= current);
  const max = Math.max(1, ...hours.map((h) => byLocal.get(h) ?? 0));
  const peak = hours.reduce((best, h) => ((byLocal.get(h) ?? 0) > (byLocal.get(best) ?? 0) ? h : best), hours[0] ?? 0);
  const label = (h: number) => `${h % 12 || 12}${h < 12 ? 'a' : 'p'}`;
  return (
    <>
      <div className="text-xs text-ink-2">
        {(byLocal.get(peak) ?? 0) > 0 ? `Busiest: ${label(peak)}m · ${byLocal.get(peak)} conversations` : 'No conversations yet today'}
      </div>
      <div className="mt-3 flex min-h-[140px] flex-1 items-end gap-2">
        {hours.map((h) => {
          const n = byLocal.get(h) ?? 0;
          return (
            <div key={h} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5" title={`${label(h)}m: ${n} conversations`}>
              {n > 0 && <span className="text-[10px] font-semibold text-ink-2">{n}</span>}
              <div
                className={clsx('w-full rounded-t', n === 0 ? 'bg-muted' : h === current ? 'bg-gold' : 'bg-primary')}
                style={{ height: `${n === 0 ? 4 : Math.max(8, (n / max) * 110)}px` }}
              />
              <span className="text-[10px] font-medium text-ink-2">{label(h)}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}
