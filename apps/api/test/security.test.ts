import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import type {
  AgentClientEvents,
  AgentServerEvents,
  Conversation,
  Message,
  WidgetSettings,
  WidgetConfig,
  VisitorClientEvents,
  VisitorServerEvents,
} from '@replyfinch/shared';
import { buildApp } from '../src/app';
import { createMailer, EmailError, type Mailer, type OutgoingEmail } from '../src/email';
import { env } from '../src/env';
import { runMigrations } from '../src/db/migrate';
import { DEMO_ACCOUNT_ID, DEMO_PASSWORD, seed } from '../src/db/seed';

type AgentSock = Socket<AgentServerEvents, AgentClientEvents>;
type VisitorSock = Socket<VisitorServerEvents, VisitorClientEvents>;

let base = '';
let sweep: () => Promise<void>;
let redisClient: import('ioredis').Redis;
const sent: OutgoingEmail[] = [];
let failNext: string | null = null;
const mailer: Mailer = {
  enabled: true,
  from: 'Acme Books <support@acme.test>',
  replyTo: null,
  async send(e) {
    if (failNext) {
      const msg = failNext;
      failNext = null;
      throw new EmailError(msg);
    }
    sent.push(e);
  },
};
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

async function connected(token: string) {
  const s = agentSocket(token);
  await new Promise<void>((r) => s.once('connect', () => r()));
  await new Promise((r) => setTimeout(r, 100)); // presence registered
  return s;
}

async function visitor() {
  const { body } = await call<{ visitorToken: string; visitorId: string; config: WidgetConfig }>(
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
  const built = await buildApp(env, { leaveGraceMs: 200, mailer, rateLimit: true });
  await built.app.listen({ port: 0, host: '127.0.0.1' });
  const addr = built.app.server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  close = () => built.app.close();
  sweep = () => built.realtime.sweep();
  redisClient = built.redis;
});
afterAll(async () => {
  for (const s of sockets) s.disconnect();
  await close?.();
});

const loginWith = (email: string, password: string) => call<{ token?: string; error?: string }>('POST', '/auth/login', undefined, { email, password });

describe('security', () => {
  it('slows down password guessing', async () => {
    for (let i = 0; i < 10; i++) expect((await loginWith('daniel@replyfinch.dev', `wrong-${i}`)).status).toBe(401);
    expect((await loginWith('daniel@replyfinch.dev', 'wrong-again')).status).toBe(429);
    // Unknown emails get the same answer as wrong passwords.
    expect(await loginWith('nobody@example.com', 'whatever')).toMatchObject({ status: 401, body: { error: 'invalid_credentials' } });
  });

  it('signs out other browsers when the password changes', async () => {
    const old = await login('maya@replyfinch.dev');
    await new Promise((r) => setTimeout(r, 1100)); // tokens are timed to the second
    const res = await call<{ token: string }>('POST', '/me/password', old.token, { currentPassword: DEMO_PASSWORD, newPassword: 'brand-new-pass-1' });
    expect(res.status).toBe(200);
    expect((await call('GET', '/me', old.token)).status).toBe(401);
    expect((await call('GET', '/me', res.body.token)).status).toBe(200);
    // Change it back for the other tests.
    await call('POST', '/me/password', res.body.token, { currentPassword: 'brand-new-pass-1', newPassword: DEMO_PASSWORD });
  });

  it('only emails transcripts of chats an agent answered, and respects ratings being off', async () => {
    const maya = await login('maya@replyfinch.dev');
    const m = await connected(maya.token);
    const v = await visitor();
    const { conversation } = await emitAck<{ conversation: Conversation }>(v.socket, 'chat:start', { name: 'Spammer', message: 'buy now', clientId: 's1' });
    v.socket.emit('chat:end', { conversationId: conversation.id });
    await waitFor<Conversation>(m, 'conversation:update', (c) => c.id === conversation.id && c.status === 'ended');
    const res = await v.socket.timeout(5000).emitWithAck('chat:transcript', { conversationId: conversation.id, email: 'victim@example.com' });
    expect(res).toEqual({ ok: false, error: 'not_allowed' });
    expect(sent.find((e) => e.to === 'victim@example.com')).toBeUndefined();

    const settings = (await call<WidgetSettings & { accountName: string }>('GET', '/settings/widget', maya.token)).body;
    const { accountName: _, ...rest } = settings;
    await call('PUT', '/settings/widget', maya.token, { ...rest, ratings: false });
    const rated = await v.socket.timeout(5000).emitWithAck('chat:rate', { conversationId: conversation.id, rating: 'bad' });
    expect(rated).toEqual({ ok: false, error: 'disabled' });
    await call('PUT', '/settings/widget', maya.token, rest);
    m.disconnect();
  });

  it('ignores non-web page addresses, and lowercases tags', async () => {
    const maya = await login('maya@replyfinch.dev');
    const v = await visitor();
    v.socket.emit('visitor:page', { url: 'javascript:alert(1)', title: 'x' });
    v.socket.emit('visitor:page', { url: 'https://shop.example/ok', title: 'OK' });
    await new Promise((r) => setTimeout(r, 300));
    const profile = (await call<{ pages: { url: string }[] }>('GET', `/customers/${v.visitorId}`, maya.token)).body;
    expect(profile.pages.map((p) => p.url)).toEqual(['https://shop.example/ok']);
    const patched = await call<{ tags: string[] }>('PATCH', `/visitors/${v.visitorId}`, maya.token, { tags: ['VIP', 'Wholesale'] });
    expect(patched.body.tags).toEqual(['vip', 'wholesale']);
  });
});

describe('integrity', () => {
  it('two tabs starting a chat at once get the same chat', async () => {
    const v = await visitor();
    const second = connect(`${base}/visitor`, { auth: { token: v.visitorToken }, transports: ['websocket'] }) as VisitorSock;
    sockets.push(second);
    await new Promise<void>((r) => second.once('connect', () => r()));
    const [a, b] = await Promise.all([
      emitAck<{ conversation: Conversation }>(v.socket, 'chat:start', { name: 'Twin', message: 'tab one', clientId: 't1' }),
      emitAck<{ conversation: Conversation }>(second, 'chat:start', { name: 'Twin', message: 'tab two', clientId: 't2' }),
    ]);
    expect(a.conversation.id).toBe(b.conversation.id);
  });

  it('ending a chat twice at the same moment ends it once', async () => {
    const maya = await login('maya@replyfinch.dev');
    const m = await connected(maya.token);
    const v = await visitor();
    const { conversation } = await emitAck<{ conversation: Conversation }>(v.socket, 'chat:start', { name: 'Race', message: 'hi', clientId: 'r1' });
    const notes: Message[] = [];
    m.on('message:new', (x) => x.conversationId === conversation.id && x.body.includes('ended') && notes.push(x));
    m.emit('chat:end', { conversationId: conversation.id });
    v.socket.emit('chat:end', { conversationId: conversation.id });
    await new Promise((r) => setTimeout(r, 500));
    expect(notes).toHaveLength(1);
    // An agent's message can't reopen it.
    const late = await m.timeout(5000).emitWithAck('message:send', { conversationId: conversation.id, body: 'too late', clientId: 'r2' });
    expect(late).toEqual({ ok: false, error: 'conversation_ended' });
    m.disconnect();
  });

  it('corrects an agent stuck as "online" after a crash', async () => {
    const maya = await login('maya@replyfinch.dev');
    // Pretend a crashed instance left Daniel counted as connected.
    await redisClient.hset(`rf:${DEMO_ACCOUNT_ID}:agents`, 'usr_demo_daniel', JSON.stringify({ status: 'online', conns: 2, lastSeenAt: Date.now() }));
    await redisClient.sadd('rf:accounts:live', DEMO_ACCOUNT_ID);
    const before = (await call<{ id: string; status: string }[]>('GET', '/team', maya.token)).body.find((t) => t.id === 'usr_demo_daniel');
    expect(before?.status).toBe('online');
    await sweep();
    const after = (await call<{ id: string; status: string }[]>('GET', '/team', maya.token)).body.find((t) => t.id === 'usr_demo_daniel');
    expect(after?.status).toBe('offline');
  });
});
