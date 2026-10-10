import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import type {
  AgentClientEvents,
  AgentServerEvents,
  Conversation,
  HistoryPage,
  OfflineMessage,
  VisitorClientEvents,
  VisitorServerEvents,
} from '@replyfinch/shared';
import { buildApp } from '../src/app';
import { env } from '../src/env';
import { runMigrations } from '../src/db/migrate';
import { DEMO_ACCOUNT_ID, DEMO_PASSWORD, seed } from '../src/db/seed';

type AgentSock = Socket<AgentServerEvents, AgentClientEvents>;
type VisitorSock = Socket<VisitorServerEvents, VisitorClientEvents>;

let base = '';
let close: () => Promise<void>;
const sockets: Socket[] = [];

async function call<T = unknown>(method: string, path: string, token?: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: (await res.json()) as T };
}

const login = async (email: string) =>
  (await call<{ token: string; agent: { id: string } }>('POST', '/auth/login', undefined, { email, password: DEMO_PASSWORD })).body;

async function visitor() {
  const { body } = await call<{ visitorToken: string; visitorId: string; config: { agentsOnline: number } }>(
    'POST',
    '/widget/session',
    undefined,
    { accountId: DEMO_ACCOUNT_ID, newSession: true },
  );
  const s: VisitorSock = connect(`${base}/visitor`, { auth: { token: body.visitorToken }, transports: ['websocket'] });
  sockets.push(s);
  await new Promise<void>((r) => s.once('connect', () => r()));
  return { ...body, socket: s };
}

function agentSocket(token: string): AgentSock {
  const s: AgentSock = connect(`${base}/agent`, { auth: { token }, transports: ['websocket'] });
  sockets.push(s);
  return s;
}

function waitFor<T>(s: Socket, event: string, pred: (x: T) => boolean = () => true, ms = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), ms);
    const h = (x: T) => {
      if (!pred(x)) return;
      clearTimeout(t);
      s.off(event, h);
      resolve(x);
    };
    s.on(event, h);
  });
}

async function emitAck<T>(s: Socket, event: string, payload: unknown): Promise<T> {
  const res = await s.timeout(5000).emitWithAck(event, payload);
  if (!res.ok) throw new Error(res.error);
  return res.data as T;
}

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  const sql = postgres(env.DATABASE_URL, { onnotice: () => {} });
  await sql`truncate offline_messages, shortcuts, messages, conversations, page_views, visitors, users, accounts cascade`;
  await sql.end();
  await seed(env.DATABASE_URL);
  const r = new Redis(env.REDIS_URL);
  await r.flushdb();
  r.disconnect();
  const built = await buildApp(env, { leaveGraceMs: 200 });
  await built.app.listen({ port: 0, host: '127.0.0.1' });
  const addr = built.app.server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  close = () => built.app.close();
});
afterAll(async () => {
  for (const s of sockets) s.disconnect();
  await close?.();
});

describe('offline messages', () => {
  it('lets a visitor leave a message, tells agents, and lets an agent mark it handled', async () => {
    const v = await visitor();
    expect(v.config.agentsOnline).toBe(0);

    const maya = await login('maya@replyfinch.dev');
    // Visitors hear when an agent comes online.
    const cameOnline = waitFor<{ online: boolean }>(v.socket, 'agents:availability', (p) => p.online);
    const agent = agentSocket(maya.token);
    await cameOnline;

    const update = waitFor<OfflineMessage>(agent, 'offline:new');
    const bad = await v.socket.timeout(5000).emitWithAck('offline:send', { name: 'Lena', email: 'not-an-email', message: 'Hi' });
    expect(bad.ok).toBe(false);
    await emitAck(v.socket, 'offline:send', {
      name: 'Lena Fischer',
      email: 'lena@example.com',
      department: 'Billing',
      message: 'Was I charged twice?',
      pageUrl: 'https://shop.example/checkout',
    });
    const created = await update;
    expect(created).toMatchObject({ name: 'Lena Fischer', email: 'lena@example.com', status: 'new', department: 'Billing' });

    expect((await call<{ new: number }>('GET', '/offline-messages/count', maya.token)).body.new).toBe(1);
    expect((await call<OfflineMessage[]>('GET', '/offline-messages?status=new', maya.token)).body).toHaveLength(1);

    const handled = waitFor<OfflineMessage>(agent, 'offline:update', (m) => m.status === 'handled');
    const res = await call<OfflineMessage>('PATCH', `/offline-messages/${created.id}`, maya.token, { status: 'handled' });
    expect(res.body).toMatchObject({ status: 'handled', handledByName: 'Maya Chen' });
    await handled;
    expect((await call<{ new: number }>('GET', '/offline-messages/count', maya.token)).body.new).toBe(0);

    // Visitors hear when the last agent goes away.
    const wentOffline = waitFor<{ online: boolean }>(v.socket, 'agents:availability', (p) => !p.online);
    agent.emit('agent:status', { status: 'away' });
    await wentOffline;
    agent.disconnect();
  });

  it('limits how many messages one visitor can leave', async () => {
    const v = await visitor();
    const msg = { name: 'Spam', email: 'spam@example.com', message: 'hello' };
    for (let i = 0; i < 5; i++) await emitAck(v.socket, 'offline:send', msg);
    const res = await v.socket.timeout(5000).emitWithAck('offline:send', msg);
    expect(res).toEqual({ ok: false, error: 'rate_limited' });
  });

  it('requires an agent login', async () => {
    expect((await call('GET', '/offline-messages')).status).toBe(401);
  });
});

describe('chat history', () => {
  it('lists, searches, filters and pages through chats', async () => {
    const maya = await login('maya@replyfinch.dev');
    const agent = agentSocket(maya.token);
    await new Promise<void>((r) => agent.once('connect', () => r()));

    const chats: Conversation[] = [];
    for (const [name, text] of [
      ['Ana', 'Where is my parcel?'],
      ['Ben', 'I need an invoice'],
      ['Cleo', 'Discount of 50% applied twice'],
    ] as const) {
      const v = await visitor();
      const { conversation } = await emitAck<{ conversation: Conversation }>(v.socket, 'chat:start', {
        name,
        email: `${name.toLowerCase()}@example.com`,
        message: text,
        clientId: `c-${name}`,
      });
      chats.push(conversation);
    }
    // Maya answers Ben, then ends his chat.
    await emitAck(agent, 'message:send', { conversationId: chats[1]!.id, body: 'Sending it now', clientId: 'a1' });
    agent.emit('chat:end', { conversationId: chats[1]!.id });
    await waitFor<Conversation>(agent, 'conversation:update', (c) => c.id === chats[1]!.id && c.status === 'ended');

    const all = (await call<HistoryPage>('GET', '/history', maya.token)).body;
    expect(all.items.slice(0, 3).map((i) => i.visitorName)).toEqual(['Cleo', 'Ben', 'Ana']); // newest first
    const ben = all.items.find((i) => i.visitorName === 'Ben')!;
    expect(ben).toMatchObject({ status: 'ended', assigneeName: 'Maya Chen', messageCount: 2, preview: 'I need an invoice', visitorEmail: 'ben@example.com' });

    const search = async (q: string) =>
      (await call<HistoryPage>('GET', `/history?q=${encodeURIComponent(q)}`, maya.token)).body.items.map((i) => i.visitorName);
    expect(await search('parcel')).toEqual(['Ana']); // message text
    expect(await search('ben@example')).toEqual(['Ben']); // email
    expect(await search('sending it')).toEqual(['Ben']); // agent reply
    expect(await search('50%')).toEqual(['Cleo']); // % is literal
    expect(await search('_')).toEqual([]); // so is _

    const endedOnly = (await call<HistoryPage>('GET', '/history?status=ended', maya.token)).body.items;
    expect(endedOnly.every((i) => i.status === 'ended')).toBe(true);
    const mine = (await call<HistoryPage>('GET', `/history?agentId=${maya.agent.id}`, maya.token)).body.items;
    expect(mine.map((i) => i.visitorName)).toEqual(['Ben']);

    const p1 = (await call<HistoryPage>('GET', '/history?limit=2', maya.token)).body;
    expect(p1.items).toHaveLength(2);
    expect(p1.nextCursor).toBe(p1.items[1]!.id);
    const p2 = (await call<HistoryPage>('GET', `/history?limit=2&cursor=${p1.nextCursor}`, maya.token)).body;
    expect(p2.items[0]!.visitorName).toBe('Ana');
    agent.disconnect();
  });
});
