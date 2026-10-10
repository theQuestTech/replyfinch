import { sql } from 'drizzle-orm';
import type { Report, ReportSummary } from '@replyfinch/shared';
import type { Db } from '../db/client';

/** An IANA time zone the database understands, or UTC. */
export function safeTimezone(tz: string): string {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

/** Today's date in a time zone, as YYYY-MM-DD. */
const today = (tz: string, now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now);

/** YYYY-MM-DD plus n days (calendar arithmetic, no time-zone surprises). */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

const num = (v: unknown) => Number(v ?? 0);
const numOrNull = (v: unknown) => (v == null ? null : Math.round(Number(v)));

export function createReportService(db: Db) {
  type Row = Record<string, unknown>;
  const rows = async (q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as Row[];

  async function summary(acc: string, tz: string, from: string, to: string): Promise<ReportSummary> {
    const inPeriod = sql`(started_at at time zone ${tz})::date between ${from}::date and ${to}::date`;
    const [r] = await rows(sql`
      select
        count(*) as chats,
        count(*) filter (where initiated_by = 'visitor') as visitor_chats,
        count(*) filter (where initiated_by = 'visitor' and status = 'ended' and first_reply_at is null) as missed,
        avg(extract(epoch from first_reply_at - started_at)) filter (where initiated_by = 'visitor' and first_reply_at is not null) as avg_first_reply,
        avg(extract(epoch from ended_at - started_at)) filter (where status = 'ended' and first_reply_at is not null) as avg_duration,
        count(*) filter (where rating = 'good') as good,
        count(*) filter (where rating = 'bad') as bad
      from conversations where account_id = ${acc} and ${inPeriod}`);
    const [o] = await rows(sql`
      select count(*) as n from offline_messages
      where account_id = ${acc} and (created_at at time zone ${tz})::date between ${from}::date and ${to}::date`);
    return {
      chats: num(r?.chats),
      visitorChats: num(r?.visitor_chats),
      missed: num(r?.missed),
      avgFirstReplySeconds: numOrNull(r?.avg_first_reply),
      avgDurationSeconds: numOrNull(r?.avg_duration),
      good: num(r?.good),
      bad: num(r?.bad),
      offlineMessages: num(o?.n),
    };
  }

  return {
    async report(acc: string, days: number, timezone: string, now = new Date()): Promise<Report> {
      const tz = safeTimezone(timezone);
      const to = today(tz, now);
      const from = addDays(to, -(days - 1));
      const inPeriod = sql`(c.started_at at time zone ${tz})::date between ${from}::date and ${to}::date`;

      const [current, previous, dayRows, hourRows, deptRows, agentRows] = await Promise.all([
        summary(acc, tz, from, to),
        summary(acc, tz, addDays(from, -days), addDays(from, -1)),
        rows(sql`
          select to_char((c.started_at at time zone ${tz})::date, 'YYYY-MM-DD') as day,
            count(*) as chats,
            count(*) filter (where c.initiated_by = 'visitor' and c.status = 'ended' and c.first_reply_at is null) as missed
          from conversations c where c.account_id = ${acc} and ${inPeriod} group by 1`),
        rows(sql`
          select extract(hour from c.started_at at time zone ${tz})::int as hour, count(*) as n
          from conversations c where c.account_id = ${acc} and c.initiated_by = 'visitor' and ${inPeriod} group by 1`),
        rows(sql`
          select coalesce(c.department, 'No department') as name, count(*) as n
          from conversations c where c.account_id = ${acc} and ${inPeriod} group by 1 order by 2 desc, 1 limit 10`),
        rows(sql`
          select u.id, u.name, count(c.id) as chats,
            avg(extract(epoch from c.first_reply_at - c.started_at)) filter (where c.initiated_by = 'visitor' and c.first_reply_at is not null) as avg_first_reply,
            avg(extract(epoch from c.ended_at - c.started_at)) filter (where c.status = 'ended') as avg_duration,
            count(c.id) filter (where c.rating = 'good') as good,
            count(c.id) filter (where c.rating = 'bad') as bad
          from users u
          left join conversations c on c.assignee_id = u.id and c.account_id = u.account_id and ${inPeriod}
          where u.account_id = ${acc} and u.active
          group by u.id, u.name order by count(c.id) desc, u.name`),
      ]);

      const byDate = new Map(dayRows.map((r) => [String(r.day), { chats: num(r.chats), missed: num(r.missed) }]));
      const byDay = Array.from({ length: days }, (_, i) => {
        const date = addDays(from, i);
        const d = byDate.get(date) ?? { chats: 0, missed: 0 };
        return { date, answered: d.chats - d.missed, missed: d.missed };
      });
      const byHour = Array.from({ length: 24 }, () => 0);
      for (const r of hourRows) byHour[num(r.hour)] = num(r.n);

      return {
        days,
        timezone: tz,
        from,
        to,
        current,
        previous,
        byDay,
        byHour,
        departments: deptRows.map((r) => ({ name: String(r.name), chats: num(r.n) })),
        agents: agentRows.map((r) => ({
          id: String(r.id),
          name: String(r.name),
          chats: num(r.chats),
          avgFirstReplySeconds: numOrNull(r.avg_first_reply),
          avgDurationSeconds: numOrNull(r.avg_duration),
          good: num(r.good),
          bad: num(r.bad),
        })),
      };
    },
  };
}
export type ReportService = ReturnType<typeof createReportService>;
