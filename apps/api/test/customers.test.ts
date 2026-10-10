import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import type { CustomerList, CustomerProfile } from '@replyfinch/shared';
import { buildApp } from '../src/app';
import { env } from '../src/env';
import { runMigrations } from '../src/db/migrate';
import { DEMO_ACCOUNT_ID, DEMO_PASSWORD, seed } from '../src/db/seed';

let base = '';
let close: () => Promise<void>;
let token = '';

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  const sql = postgres(env.DATABASE_URL, { onnotice: () => {} });
  await sql`truncate offline_messages, shortcuts, messages, conversations, page_views, visitors, users, accounts cascade`;
  await seed(env.DATABASE_URL);
  const A = DEMO_ACCOUNT_ID;
  const ago = (h: number) => new Date(Date.now() - h * 3600_000);
  await sql`insert into visitors (id, account_id, name, email, tags, last_seen_at) values
    ('vis_ann', ${A}, 'Ann Lee', 'ann@example.com', '{vip}', ${ago(1)}),
    ('vis_bob', ${A}, null, 'bob@example.com', '{}', ${ago(5)}),
    ('vis_cy', ${A}, 'Cy', null, '{wholesale,vip}', ${ago(3)}),
    ('vis_anon', ${A}, null, null, '{}', ${ago(0)})`;
  await sql`insert into conversations (id, account_id, visitor_id, status, rating, started_at) values
    ('cnv_1', ${A}, 'vis_ann', 'ended', 'good', ${ago(30)}),
    ('cnv_2', ${A}, 'vis_ann', 'ended', null, ${ago(2)})`;
  await sql`insert into messages (id, account_id, conversation_id, author_type, author_name, body) values
    ('msg_1', ${A}, 'cnv_2', 'visitor', 'Ann Lee', 'Where is my parcel?')`;
  await sql`insert into offline_messages (id, account_id, visitor_id, name, email, message) values
    ('om_1', ${A}, 'vis_bob', 'Bob', 'bob@example.com', 'Call me back')`;
  await sql`insert into page_views (id, account_id, visitor_id, url, title) values
    ('pv_1', ${A}, 'vis_ann', 'https://shop.example/checkout', 'Checkout')`;
  await sql.end();
  const r = new Redis(env.REDIS_URL);
  await r.flushdb();
  r.disconnect();

  const built = await buildApp(env, { leaveGraceMs: 200 });
  await built.app.listen({ port: 0, host: '127.0.0.1' });
  const addr = built.app.server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  close = () => built.app.close();
  const res = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'maya@replyfinch.dev', password: DEMO_PASSWORD }),
  });
  token = ((await res.json()) as { token: string }).token;
});
afterAll(async () => close?.());

const get = async <T>(path: string) => {
  const res = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` } });
  return { status: res.status, body: (await res.json()) as T };
};
const names = (l: CustomerList) => l.items.map((c) => c.name ?? c.email);

describe('customers', () => {
  it('lists people you know or talked to — not anonymous page views', async () => {
    const { body } = await get<CustomerList>('/customers');
    expect(body.total).toBe(3);
    expect(names(body)).toEqual(['Ann Lee', 'Cy', 'bob@example.com']); // last seen first
    const ann = body.items[0]!;
    expect(ann).toMatchObject({ chats: 2, good: 1, bad: 0, tags: ['vip'] });
    expect(body.items[2]).toMatchObject({ offlineMessages: 1 });
  });

  it('searches, filters by tag, sorts and pages', async () => {
    expect(names((await get<CustomerList>('/customers?q=bob@')).body)).toEqual(['bob@example.com']);
    expect(names((await get<CustomerList>('/customers?q=wholesale')).body)).toEqual(['Cy']); // tags too
    expect(names((await get<CustomerList>('/customers?tag=vip&sort=name')).body)).toEqual(['Ann Lee', 'Cy']);
    expect(names((await get<CustomerList>('/customers?sort=chats')).body)[0]).toBe('Ann Lee');
    const page2 = (await get<CustomerList>('/customers?limit=2&offset=2')).body;
    expect(page2).toMatchObject({ total: 3 });
    expect(page2.items).toHaveLength(1);
    expect((await get<string[]>('/customers/tags')).body).toEqual(['vip', 'wholesale']);
  });

  it('shows one profile with chats, offline messages and pages', async () => {
    const { body } = await get<CustomerProfile>('/customers/vis_ann');
    expect(body.customer).toMatchObject({ name: 'Ann Lee', email: 'ann@example.com', chats: 2 });
    expect(body.conversations.map((c) => c.id)).toEqual(['cnv_2', 'cnv_1']);
    expect(body.conversations[0]).toMatchObject({ preview: 'Where is my parcel?' });
    expect(body.pages).toEqual([expect.objectContaining({ title: 'Checkout' })]);
    expect((await get<CustomerProfile>('/customers/vis_bob')).body.offlineMessages).toHaveLength(1);
    expect((await get('/customers/vis_nope')).status).toBe(404);
  });
});
