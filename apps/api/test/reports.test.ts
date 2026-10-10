import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import type { Report } from '@replyfinch/shared';
import { buildApp } from '../src/app';
import { env } from '../src/env';
import { runMigrations } from '../src/db/migrate';
import { DEMO_ACCOUNT_ID, DEMO_PASSWORD, seed } from '../src/db/seed';
import { addDays, safeTimezone } from '../src/services/reports';

let base = '';
let close: () => Promise<void>;
let sql: postgres.Sql;

const HOUR = 3600_000;
const now = Date.now();

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  sql = postgres(env.DATABASE_URL, { onnotice: () => {} });
  await sql`truncate offline_messages, shortcuts, messages, conversations, page_views, visitors, users, accounts cascade`;
  await seed(env.DATABASE_URL);
  const r = new Redis(env.REDIS_URL);
  await r.flushdb();
  r.disconnect();

  await sql`insert into visitors (id, account_id, name) values ('vis_r1', ${DEMO_ACCOUNT_ID}, 'Ann')`;
  const conv = (id: string, o: { startedAgo: number; replyAfter?: number; endAfter?: number; by?: string; rating?: string; dept?: string; assignee?: string }) => {
    const started = new Date(now - o.startedAgo);
    return sql`insert into conversations (id, account_id, visitor_id, status, assignee_id, department, initiated_by, started_at, first_reply_at, ended_at, rating)
      values (${id}, ${DEMO_ACCOUNT_ID}, 'vis_r1', ${o.endAfter != null ? 'ended' : 'active'}, ${o.assignee ?? null}, ${o.dept ?? null}, ${o.by ?? 'visitor'},
        ${started}, ${o.replyAfter != null ? new Date(started.getTime() + o.replyAfter) : null},
        ${o.endAfter != null ? new Date(started.getTime() + o.endAfter) : null}, ${o.rating ?? null})`;
  };
  // This week: answered (30s reply, 5 min long, 👍), answered (90s, 👎), missed, agent-started.
  await conv('cnv_a', { startedAgo: 1 * HOUR, replyAfter: 30_000, endAfter: 300_000, rating: 'good', dept: 'Billing', assignee: 'usr_demo_maya' });
  await conv('cnv_b', { startedAgo: 2 * HOUR, replyAfter: 90_000, endAfter: 600_000, rating: 'bad', dept: 'Billing', assignee: 'usr_demo_maya' });
  await conv('cnv_c', { startedAgo: 3 * HOUR, endAfter: 120_000, dept: 'Sales' });
  await conv('cnv_d', { startedAgo: 4 * HOUR, by: 'agent', replyAfter: 0, assignee: 'usr_demo_daniel' });
  // The week before: one chat.
  await conv('cnv_e', { startedAgo: 9 * 24 * HOUR, replyAfter: 60_000, endAfter: 60_000 });
  // An offline message this week.
  await sql`insert into offline_messages (id, account_id, visitor_id, name, email, message) values ('om_1', ${DEMO_ACCOUNT_ID}, 'vis_r1', 'Ann', 'ann@example.com', 'hi')`;

  const built = await buildApp(env, { leaveGraceMs: 200 });
  await built.app.listen({ port: 0, host: '127.0.0.1' });
  const addr = built.app.server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  close = () => built.app.close();
});
afterAll(async () => {
  await sql.end();
  await close?.();
});

async function token() {
  const res = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'maya@replyfinch.dev', password: DEMO_PASSWORD }),
  });
  return ((await res.json()) as { token: string }).token;
}

describe('reports', () => {
  it('summarizes chats, reply times, ratings and the team for a period', async () => {
    const res = await fetch(`${base}/reports?days=7&tz=UTC`, { headers: { authorization: `Bearer ${await token()}` } });
    const r = (await res.json()) as Report;
    expect(r.current).toEqual({
      chats: 4,
      visitorChats: 3,
      missed: 1,
      avgFirstReplySeconds: 60, // (30 + 90) / 2 — agent-started chats don't count
      avgDurationSeconds: 450, // (300 + 600) / 2 — missed chats don't count
      good: 1,
      bad: 1,
      offlineMessages: 1,
    });
    expect(r.previous.chats).toBe(1);
    expect(r.byDay).toHaveLength(7);
    expect(r.byDay.reduce((a, d) => a + d.answered + d.missed, 0)).toBe(4);
    expect(r.byDay.reduce((a, d) => a + d.missed, 0)).toBe(1);
    expect(r.byHour.reduce((a, b) => a + b, 0)).toBe(3); // visitor chats only
    expect(r.departments).toEqual([
      { name: 'Billing', chats: 2 },
      { name: 'No department', chats: 1 },
      { name: 'Sales', chats: 1 },
    ]);
    expect(r.agents[0]).toMatchObject({ name: 'Maya Chen', chats: 2, avgFirstReplySeconds: 60, good: 1, bad: 1 });
    expect(r.agents.find((a) => a.name === 'Daniel Brooks')).toMatchObject({ chats: 1, avgFirstReplySeconds: null });
  });

  it('rejects other periods and needs a login', async () => {
    const t = await token();
    expect((await fetch(`${base}/reports?days=12`, { headers: { authorization: `Bearer ${t}` } })).status).toBe(400);
    expect((await fetch(`${base}/reports`)).status).toBe(401);
  });

  it('handles dates and time zones safely', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(safeTimezone('Asia/Karachi')).toBe('Asia/Karachi');
    expect(safeTimezone("UTC'; drop table users;--")).toBe('UTC');
  });
});
