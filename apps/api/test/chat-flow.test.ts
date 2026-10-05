import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import type {
  AgentClientEvents,
  AgentServerEvents,
  Conversation,
  LiveVisitor,
  Message,
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

/** Resolve with the first event matching the predicate. */
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

async function until(cond: () => boolean, ms = 5000) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('condition not met');
    await new Promise((r) => setTimeout(r, 20));
  }
}

async function emitAck<T>(s: Socket, event: string, payload: unknown): Promise<T> {
  const res = await s.timeout(5000).emitWithAck(event, payload);
  if (!res.ok) throw new Error(res.error);
  return res.data as T;
}

async function login(email = 'maya@replyfinch.dev') {
  const res = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: DEMO_PASSWORD }),
  });
  return (await res.json()) as { token: string };
}

async function newVisitor() {
  const res = await fetch(`${base}/widget/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/129.0' },
    body: JSON.stringify({ accountId: DEMO_ACCOUNT_ID, newSession: true, timezone: 'Europe/Madrid' }),
  });
  return (await res.json()) as { visitorToken: string; visitorId: string };
}

function agentSocket(token: string): AgentSock {
  const s = connect(`${base}/agent`, { auth: { token }, transports: ['websocket'] });
  sockets.push(s);
  return s;
}
function visitorSocket(token: string): VisitorSock {
  const s = connect(`${base}/visitor`, { auth: { token }, transports: ['websocket'] });
  sockets.push(s);
  return s;
}

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  const sql = postgres(env.DATABASE_URL, { onnotice: () => {} });
  await sql`truncate messages, conversations, page_views, visitors, users, accounts cascade`;
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
  sockets.forEach((s) => s.disconnect());
  await close?.();
});

describe('auth', () => {
  it('rejects bad credentials and accepts good ones', async () => {
    const bad = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'maya@replyfinch.dev', password: 'nope' }),
    });
    expect(bad.status).toBe(401);
    const { token } = await login();
    const me = await fetch(`${base}/me`, { headers: { authorization: `Bearer ${token}` } });
    expect(((await me.json()) as { name: string }).name).toBe('Maya Chen');
    expect((await fetch(`${base}/visitors`)).status).toBe(401);
  });

  it('refuses sockets without a valid token', async () => {
    const s = connect(`${base}/agent`, { auth: { token: 'junk' }, transports: ['websocket'] });
    sockets.push(s);
    const err = await waitFor<Error>(s, 'connect_error');
    expect(err.message).toBe('unauthorized');
  });
});

describe('visitor → chat → agent joins by typing', () => {
  it('runs the whole flow in real time', async () => {
    const { token } = await login();
    const agent = agentSocket(token);
    await waitFor<LiveVisitor[]>(agent, 'visitors:snapshot');

    // 1. A visitor arrives and browses — the agent sees them live.
    const v = await newVisitor();
    const visitor = visitorSocket(v.visitorToken);
    await waitFor(visitor, 'connect');
    const seen = waitFor<LiveVisitor>(agent, 'visitor:update', (x) => x.id === v.visitorId && x.currentPage?.title === 'Checkout');
    visitor.emit('visitor:page', { url: 'https://acmebooks.com/checkout', title: 'Checkout', referrer: 'https://instagram.com' });
    const live = await seen;
    expect(live.state).toBe('browsing');
    expect(live.browser).toBe('Chrome');
    expect(live.os).toBe('macOS');
    expect(live.timezone).toBe('Europe/Madrid');

    // 2. The visitor starts a chat — agent sees a waiting conversation, visitor becomes "chatting".
    const waiting = waitFor<Conversation>(agent, 'conversation:update', (c) => c.visitorId === v.visitorId);
    const chatting = waitFor<LiveVisitor>(agent, 'visitor:update', (x) => x.id === v.visitorId && x.state === 'chatting');
    const started = await emitAck<{ conversation: Conversation; messages: Message[] }>(visitor, 'chat:start', {
      name: 'Sofia Martínez',
      email: 'sofia@example.com',
      department: 'Orders & shipping',
      message: 'My order #4821 never arrived',
      clientId: 'c1',
    });
    expect(started.messages.map((m) => m.authorType)).toEqual(['visitor', 'bot']);
    expect((await waiting).status).toBe('waiting');
    expect((await chatting).name).toBe('Sofia Martínez');
    const convId = started.conversation.id;

    // 3. Viewing the chat does not join it.
    const watched = await emitAck<{ conversation: Conversation; messages: Message[] }>(agent, 'conversation:watch', {
      conversationId: convId,
    });
    expect(watched.conversation.assigneeId).toBeNull();
    expect(watched.messages).toHaveLength(2);

    // 4. Typing (sending) the first message joins: system "joined" + the message reach the visitor.
    const visitorGot: Message[] = [];
    visitor.on('message:new', (m) => visitorGot.push(m));
    const active = waitFor<Conversation>(agent, 'conversation:update', (c) => c.id === convId && c.status === 'active');
    const sent = await emitAck<Message>(agent, 'message:send', { conversationId: convId, body: 'Hi Sofia, I’m Maya!', clientId: 'a1' });
    const conv = await active;
    expect(conv.assigneeName).toBe('Maya Chen');
    expect(conv.firstReplyAt).not.toBeNull();
    await until(() => visitorGot.some((m) => m.id === sent.id));
    expect(visitorGot.map((m) => m.authorType)).toEqual(['system', 'agent']);
    expect(visitorGot[0]!.body).toBe('Maya Chen joined the chat');

    // 5. Retried send with the same clientId is de-duplicated.
    const again = await emitAck<Message>(agent, 'message:send', { conversationId: convId, body: 'Hi Sofia, I’m Maya!', clientId: 'a1' });
    expect(again.id).toBe(sent.id);

    // 6. Internal notes never reach the visitor.
    const note = await emitAck<Message>(agent, 'message:send', {
      conversationId: convId,
      body: 'VIP customer',
      clientId: 'n1',
      internal: true,
    });
    expect(note.internal).toBe(true);

    // 7. Visitor replies — agent receives it.
    const agentGot = waitFor<Message>(agent, 'message:new', (m) => m.authorType === 'visitor' && m.body === 'Thanks!');
    await emitAck<Message>(visitor, 'message:send', { conversationId: convId, body: 'Thanks!', clientId: 'c2' });
    await agentGot;
    expect(visitorGot.some((m) => m.internal)).toBe(false);

    // 8. Home stats reflect the chat.
    const stats = (await (await fetch(`${base}/stats/home`, { headers: { authorization: `Bearer ${token}` } })).json()) as {
      open: number;
      assignedToMe: number;
      conversationsToday: number;
    };
    expect(stats.open).toBe(1);
    expect(stats.assignedToMe).toBe(1);
    expect(stats.conversationsToday).toBe(1);

    // 9. Agent ends the chat — visitor is told, and goes back to browsing.
    const ended = waitFor(visitor, 'chat:ended');
    const browsing = waitFor<LiveVisitor>(agent, 'visitor:update', (x) => x.id === v.visitorId && x.state === 'browsing');
    agent.emit('chat:end', { conversationId: convId });
    await ended;
    expect((await browsing).conversationId).toBeNull();

    // 10. Visitor leaves the site — removed from the live list after the grace period.
    const removed = waitFor<{ id: string }>(agent, 'visitor:remove', (x) => x.id === v.visitorId);
    visitor.disconnect();
    await removed;
  });

  it('lets an agent start a chat with a browsing visitor', async () => {
    const { token } = await login();
    const agent = agentSocket(token);
    await waitFor(agent, 'visitors:snapshot');
    const v = await newVisitor();
    const visitor = visitorSocket(v.visitorToken);
    await waitFor<LiveVisitor>(agent, 'visitor:update', (x) => x.id === v.visitorId);
    const resumed = waitFor<{ conversation: Conversation; messages: Message[]; proactive?: boolean }>(visitor, 'chat:resume');
    const started = await emitAck<{ conversation: Conversation; messages: Message[] }>(agent, 'chat:initiate', {
      visitorId: v.visitorId,
      body: 'Hi! Need help finding a book?',
      clientId: 'p1',
    });
    expect(started.conversation.status).toBe('active');
    expect(started.conversation.assigneeName).toBe('Maya Chen');
    const r = await resumed;
    expect(r.proactive).toBe(true);
    expect(r.messages.map((m) => m.body)).toContain('Hi! Need help finding a book?');
    await expect(
      emitAck(agent, 'chat:initiate', { visitorId: v.visitorId, body: 'again', clientId: 'p2' }),
    ).rejects.toThrow('already_chatting');
    visitor.disconnect();
  });

  it('lets an agent edit visitor details and broadcasts them', async () => {
    const { token } = await login();
    const agent = agentSocket(token);
    await waitFor(agent, 'visitors:snapshot');
    const v = await newVisitor();
    const visitor = visitorSocket(v.visitorToken);
    await waitFor<LiveVisitor>(agent, 'visitor:update', (x) => x.id === v.visitorId);
    const updated = waitFor<LiveVisitor>(agent, 'visitor:update', (x) => x.id === v.visitorId && x.phone === '+34 600 000 000');
    const res = await fetch(`${base}/visitors/${v.visitorId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ phone: '+34 600 000 000', tags: ['vip'] }),
    });
    expect(res.status).toBe(200);
    expect((await updated).tags).toEqual(['vip']);
    visitor.disconnect();
  });
});
