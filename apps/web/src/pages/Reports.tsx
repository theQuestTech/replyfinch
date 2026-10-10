import clsx from 'clsx';
import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowDownRight, ArrowUpRight, Minus, Table2, BarChart3 } from 'lucide-react';
import type { Report, ReportSummary } from '@replyfinch/shared';
import { api } from '../lib/api';
import { duration } from '../lib/format';
import { Card } from '../components/ui';

const PERIODS = [7, 30, 90] as const;
// Chart colors: validated pair (dataviz validator, light surface). Orange is under 3:1
// contrast, so the daily chart has a table view and every value is in the tooltip.
const ANSWERED = '#2F5BEA';
const MISSED = '#E8833A';
const SINGLE = '#2F5BEA';

const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const fmtInt = (n: number) => new Intl.NumberFormat(undefined, { notation: n >= 10_000 ? 'compact' : 'standard' }).format(n);
const fmtSecs = (s: number | null) => (s == null ? '—' : duration(s * 1000));
const satisfaction = (s: ReportSummary) => (s.good + s.bad ? Math.round((s.good / (s.good + s.bad)) * 100) : null);
const dayLabel = (d: string, opts: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00Z`).toLocaleDateString([], { ...opts, timeZone: 'UTC' });

/** Clean y-axis ticks: 0 and up to 3 steps of 1/2/5 × 10^k covering max. */
export function ticks(max: number): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / 3;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw)!;
  const top = Math.ceil(max / step) * step;
  return Array.from({ length: Math.round(top / step) + 1 }, (_, i) => Math.round(i * step * 1000) / 1000);
}

export function Reports() {
  const [params, setParams] = useSearchParams();
  const days = PERIODS.find((p) => String(p) === params.get('days')) ?? 7;
  const { data, isError, isFetching } = useQuery({
    queryKey: ['reports', days, tz],
    queryFn: () => api<Report>(`/reports?days=${days}&tz=${encodeURIComponent(tz)}`),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="flex min-h-full flex-col gap-5 px-8 py-7">
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex-1">
          <h1 className="text-[26px] font-bold">Reports</h1>
          <p className="text-sm text-ink-2">
            How your live chat is doing{data ? ` · ${dayLabel(data.from, { month: 'short', day: 'numeric' })} – ${dayLabel(data.to, { month: 'short', day: 'numeric' })}` : ''}
          </p>
        </div>
        <div className="flex gap-0.5 rounded-[10px] bg-muted p-1" role="radiogroup" aria-label="Period">
          {PERIODS.map((p) => (
            <button
              key={p}
              role="radio"
              aria-checked={days === p}
              onClick={() => setParams(p === 7 ? {} : { days: String(p) }, { replace: true })}
              className={clsx(
                'cursor-pointer rounded-[7px] px-3 py-1.5 text-[13px]',
                days === p ? 'bg-surface font-semibold shadow-sm' : 'font-medium text-ink-2 hover:text-ink',
              )}
            >
              Last {p} days
            </button>
          ))}
        </div>
      </div>

      {isError && <Card className="p-8 text-center text-sm text-danger">Couldn’t load reports.</Card>}
      {!data && !isError && <div className="text-sm text-ink-2">Loading…</div>}
      {data && (
        <div className={clsx('flex flex-col gap-5 transition-opacity', isFetching && 'opacity-60')} data-testid="reports">
          <Tiles r={data} />
          <Card className="p-6">
            <DailyChart r={data} />
          </Card>
          <div className="grid gap-5 lg:grid-cols-2">
            <Card className="p-6">
              <HoursChart byHour={data.byHour} />
            </Card>
            <Card className="p-6">
              <Departments items={data.departments} />
            </Card>
          </div>
          <Card>
            <TeamTable r={data} />
          </Card>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- stat tiles
type Better = 'up' | 'down' | 'neutral';

function delta(cur: number | null, prev: number | null, better: Better, unit: '%' | 'pts' = '%') {
  if (cur == null || prev == null) return null;
  const diff = unit === 'pts' ? cur - prev : prev === 0 ? (cur === 0 ? 0 : null) : Math.round(((cur - prev) / prev) * 100);
  if (diff == null) return null; // nothing to compare with
  const dir = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
  const tone = dir === 'flat' || better === 'neutral' ? 'neutral' : dir === better ? 'good' : 'bad';
  return { text: `${diff > 0 ? '+' : ''}${diff}${unit === 'pts' ? ' pts' : '%'}`, tone, dir } as const;
}

function Tile({
  label,
  value,
  sub,
  d,
  period,
}: {
  label: string;
  value: string;
  sub?: string;
  d: ReturnType<typeof delta>;
  period: number;
}) {
  const Icon = d?.dir === 'up' ? ArrowUpRight : d?.dir === 'down' ? ArrowDownRight : Minus;
  return (
    <Card className="flex flex-col gap-1 p-5">
      <span className="text-[13px] font-medium text-ink-2">{label}</span>
      <span className="text-[28px] leading-tight font-semibold" data-testid={`tile-${label}`}>
        {value}
      </span>
      {sub && <span className="text-xs text-ink-2">{sub}</span>}
      {d && (
        <span
          className={clsx(
            'mt-1 flex items-center gap-1 text-xs font-semibold',
            d.tone === 'good' ? 'text-success' : d.tone === 'bad' ? 'text-danger' : 'text-ink-2',
          )}
          title={`Compared with the ${period} days before`}
        >
          <Icon className="size-3.5" aria-hidden /> {d.text}
          <span className="font-normal text-ink-2">vs previous {period} days</span>
        </span>
      )}
    </Card>
  );
}

function Tiles({ r }: { r: Report }) {
  const c = r.current;
  const p = r.previous;
  const missedPct = c.visitorChats ? Math.round((c.missed / c.visitorChats) * 100) : 0;
  const sat = satisfaction(c);
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 2xl:grid-cols-6">
      <Tile label="Chats" value={fmtInt(c.chats)} sub={`${fmtInt(c.visitorChats)} started by visitors`} d={delta(c.chats, p.chats, 'neutral')} period={r.days} />
      <Tile label="Missed chats" value={fmtInt(c.missed)} sub={`${missedPct}% of visitor chats`} d={delta(c.missed, p.missed, 'down')} period={r.days} />
      <Tile
        label="First reply"
        value={fmtSecs(c.avgFirstReplySeconds)}
        sub="Average wait for an agent"
        d={delta(c.avgFirstReplySeconds, p.avgFirstReplySeconds, 'down')}
        period={r.days}
      />
      <Tile label="Chat length" value={fmtSecs(c.avgDurationSeconds)} sub="Average, answered chats" d={delta(c.avgDurationSeconds, p.avgDurationSeconds, 'neutral')} period={r.days} />
      <Tile
        label="Satisfaction"
        value={sat == null ? '—' : `${sat}%`}
        sub={c.good + c.bad ? `${c.good} 👍 · ${c.bad} 👎` : 'No ratings yet'}
        d={delta(sat, satisfaction(p), 'up', 'pts')}
        period={r.days}
      />
      <Tile label="Offline messages" value={fmtInt(c.offlineMessages)} sub="Left while nobody was online" d={delta(c.offlineMessages, p.offlineMessages, 'neutral')} period={r.days} />
    </div>
  );
}

// ---------------------------------------------------------------- chart pieces
function ChartHeader({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-start gap-3">
      <div className="flex-1">
        <h2 className="text-base font-bold">{title}</h2>
        {sub && <p className="text-xs text-ink-2">{sub}</p>}
      </div>
      {children}
    </div>
  );
}

/** Sits just above the hovered column; beside it when the column is tall, so it never leaves the chart. */
function Tooltip({ leftPct, heightPct, children }: { leftPct: number; heightPct: number; children: ReactNode }) {
  const beside = heightPct > 55;
  const onRight = leftPct < 50;
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-10 min-w-32 rounded-lg border border-line bg-surface px-3 py-2 text-xs whitespace-nowrap shadow-lg"
      style={
        beside
          ? {
              top: '20%',
              ...(onRight ? { left: `calc(${leftPct}% + 18px)` } : { right: `calc(${100 - leftPct}% + 18px)` }),
            }
          : { bottom: `calc(${heightPct}% + 8px)`, left: `${Math.min(90, Math.max(10, leftPct))}%`, transform: 'translateX(-50%)' }
      }
    >
      {children}
    </div>
  );
}

const Key = ({ color }: { color: string }) => <span className="inline-block h-0.5 w-3 rounded" style={{ background: color }} />;

/** Columns over a y-axis with hairline gridlines. Each column is a stack of segments. */
function Columns({
  data,
  label,
  segments,
  tooltip,
  ariaLabel,
  height = 200,
}: {
  data: number[][]; // per column: segment values bottom → top
  label: (i: number) => string | null;
  segments: string[]; // colors bottom → top
  tooltip: (i: number) => ReactNode;
  ariaLabel: (i: number) => string;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const totals = data.map((col) => col.reduce((a, b) => a + b, 0));
  const t = ticks(Math.max(...totals, 0));
  const top = t[t.length - 1]!;
  return (
    <div className="flex gap-2">
      <div className="relative w-8 shrink-0 text-right text-[11px] text-ink-2 tabular-nums" style={{ height }}>
        {t.map((v) => (
          <span key={v} className="absolute right-0 leading-none" style={{ bottom: `calc(${(v / top) * 100}% - 5px)` }}>
            {fmtInt(v)}
          </span>
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <div className="relative" style={{ height }} onMouseLeave={() => setHover(null)}>
          {t.map((v) => (
            <div key={v} className="absolute inset-x-0 h-px bg-line" style={{ bottom: `${(v / top) * 100}%` }} />
          ))}
          <div className="absolute inset-0 flex items-end gap-[2px]">
            {data.map((col, i) => (
              <div
                key={i}
                tabIndex={0}
                aria-label={ariaLabel(i)}
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                className="group flex h-full min-w-0 flex-1 cursor-default items-end justify-center outline-none"
              >
                <div
                  className={clsx('flex w-full max-w-6 flex-col-reverse gap-[2px] transition-opacity', hover !== null && hover !== i && 'opacity-60')}
                  style={{ height: `${(totals[i]! / top) * 100}%` }}
                >
                  {col.map((v, s) =>
                    v > 0 ? (
                      <div
                        key={s}
                        className={clsx('w-full', s === lastNonZero(col) && 'rounded-t')}
                        style={{ flexGrow: v, flexBasis: 0, background: segments[s], minHeight: 2 }}
                      />
                    ) : null,
                  )}
                </div>
              </div>
            ))}
          </div>
          {hover !== null && (
            <Tooltip leftPct={((hover + 0.5) / data.length) * 100} heightPct={(totals[hover]! / top) * 100}>
              {tooltip(hover)}
            </Tooltip>
          )}
        </div>
        <div className="mt-1.5 flex gap-[2px] text-[11px] text-ink-2">
          {data.map((_, i) => (
            <span key={i} className="min-w-0 flex-1 overflow-visible text-center whitespace-nowrap">
              {label(i) ?? ''}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
const lastNonZero = (col: number[]) => col.reduce((last, v, i) => (v > 0 ? i : last), -1);

// ---------------------------------------------------------------- charts
function DailyChart({ r }: { r: Report }) {
  const [table, setTable] = useState(false);
  const every = r.days <= 7 ? 1 : r.days <= 30 ? 5 : 15;
  const long = (d: string) => dayLabel(d, { weekday: 'short', month: 'short', day: 'numeric' });
  return (
    <>
      <ChartHeader title="Chats per day" sub="Missed: visitor chats that ended before an agent replied">
        <div className="flex items-center gap-4 text-xs text-ink-2">
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: ANSWERED }} /> Answered
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: MISSED }} /> Missed
          </span>
          <button
            onClick={() => setTable((t) => !t)}
            className="flex cursor-pointer items-center gap-1 rounded-md border border-line px-2 py-1 font-medium text-ink hover:bg-muted"
          >
            {table ? <BarChart3 className="size-3.5" /> : <Table2 className="size-3.5" />} {table ? 'Chart' : 'Table'}
          </button>
        </div>
      </ChartHeader>
      {table ? (
        <div className="max-h-[260px] overflow-y-auto">
          <table className="w-full text-sm" data-testid="daily-table">
            <thead className="sticky top-0 bg-surface text-left text-xs text-ink-2">
              <tr>
                <th className="py-1.5 font-semibold">Day</th>
                <th className="py-1.5 text-right font-semibold">Answered</th>
                <th className="py-1.5 text-right font-semibold">Missed</th>
                <th className="py-1.5 text-right font-semibold">Total</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {[...r.byDay].reverse().map((d) => (
                <tr key={d.date} className="border-t border-line">
                  <td className="py-1.5">{long(d.date)}</td>
                  <td className="py-1.5 text-right">{d.answered}</td>
                  <td className="py-1.5 text-right">{d.missed}</td>
                  <td className="py-1.5 text-right font-semibold">{d.answered + d.missed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Columns
          data={r.byDay.map((d) => [d.answered, d.missed])}
          segments={[ANSWERED, MISSED]}
          label={(i) => {
            const d = r.byDay[i]!.date;
            if (r.days <= 7) return dayLabel(d, { weekday: 'short' });
            return (r.days - 1 - i) % every === 0 ? dayLabel(d, { month: 'short', day: 'numeric' }) : null;
          }}
          ariaLabel={(i) => {
            const d = r.byDay[i]!;
            return `${long(d.date)}: ${d.answered} answered, ${d.missed} missed`;
          }}
          tooltip={(i) => {
            const d = r.byDay[i]!;
            return (
              <>
                <div className="mb-1 font-semibold text-ink-2">{long(d.date)}</div>
                <div className="flex items-center gap-2">
                  <Key color={ANSWERED} /> <b className="text-ink">{d.answered}</b> <span className="text-ink-2">answered</span>
                </div>
                <div className="flex items-center gap-2">
                  <Key color={MISSED} /> <b className="text-ink">{d.missed}</b> <span className="text-ink-2">missed</span>
                </div>
              </>
            );
          }}
        />
      )}
    </>
  );
}

const hourName = (h: number) => new Date(Date.UTC(2026, 0, 1, h)).toLocaleTimeString([], { hour: 'numeric', timeZone: 'UTC' });

function HoursChart({ byHour }: { byHour: number[] }) {
  const busiest = byHour.indexOf(Math.max(...byHour));
  const any = byHour.some((n) => n > 0);
  return (
    <>
      <ChartHeader
        title="Busiest hours"
        sub={any ? `Visitor chats by time of day · busiest around ${hourName(busiest)}` : 'Visitor chats by time of day'}
      />
      <Columns
        height={160}
        data={byHour.map((n) => [n])}
        segments={[SINGLE]}
        label={(h) => (h % 6 === 0 ? hourName(h) : null)}
        ariaLabel={(h) => `${hourName(h)}: ${byHour[h]} chats`}
        tooltip={(h) => (
          <>
            <div className="mb-0.5 font-semibold text-ink-2">
              {hourName(h)} – {hourName((h + 1) % 24)}
            </div>
            <b className="text-ink">{byHour[h]}</b> <span className="text-ink-2">chats</span>
          </>
        )}
      />
    </>
  );
}

function Departments({ items }: { items: Report['departments'] }) {
  const max = Math.max(1, ...items.map((d) => d.chats));
  return (
    <>
      <ChartHeader title="Departments" sub="Chats by the department visitors picked" />
      {items.length === 0 && <div className="py-8 text-center text-sm text-ink-2">No chats in this period.</div>}
      <div className="flex flex-col gap-2.5" data-testid="departments-chart">
        {items.map((d) => (
          <div key={d.name} className="flex items-center gap-3 text-[13px]" title={`${d.name}: ${d.chats} chats`}>
            <span className="w-36 shrink-0 truncate text-ink-2">{d.name}</span>
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <div className="h-4 rounded-r" style={{ width: `${(d.chats / max) * 100}%`, background: SINGLE, minWidth: 2 }} />
              <span className="shrink-0 font-semibold tabular-nums">{d.chats}</span>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function TeamTable({ r }: { r: Report }) {
  return (
    <>
      <div className="px-6 pt-5 pb-3">
        <h2 className="text-base font-bold">Team</h2>
        <p className="text-xs text-ink-2">Chats each agent was assigned in this period</p>
      </div>
      <table className="w-full text-sm" data-testid="team-table">
        <thead className="border-y border-line bg-canvas text-left text-[11px] font-semibold tracking-wide text-ink-2 uppercase">
          <tr>
            <th className="px-6 py-2.5">Agent</th>
            <th className="px-3 py-2.5 text-right">Chats</th>
            <th className="px-3 py-2.5 text-right">First reply</th>
            <th className="px-3 py-2.5 text-right">Chat length</th>
            <th className="px-6 py-2.5 text-right">Satisfaction</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {r.agents.map((a) => {
            const sat = a.good + a.bad ? Math.round((a.good / (a.good + a.bad)) * 100) : null;
            return (
              <tr key={a.id} className="border-b border-line last:border-b-0">
                <td className="px-6 py-3 font-semibold">{a.name}</td>
                <td className="px-3 py-3 text-right">{a.chats}</td>
                <td className="px-3 py-3 text-right">{fmtSecs(a.avgFirstReplySeconds)}</td>
                <td className="px-3 py-3 text-right">{fmtSecs(a.avgDurationSeconds)}</td>
                <td className="px-6 py-3 text-right">
                  {sat == null ? <span className="text-ink-2">—</span> : `${sat}%`}
                  {sat != null && <span className="ml-1.5 text-xs text-ink-2">({a.good + a.bad})</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
