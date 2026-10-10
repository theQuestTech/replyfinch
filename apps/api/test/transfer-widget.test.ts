import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import type {
  AgentClientEvents,
  AgentServerEvents,
  Conversation,
  Message,
  WidgetConfig,
  WidgetSettings,
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

describe('transfer', () => {
  it('hands a chat to another agent with a private note; they join when they type', async () => {
    const maya = await login('maya@replyfinch.dev');
    const daniel = await login('daniel@replyfinch.dev');
    const m = await connected(maya.token);
    const v = await visitor();
    const { conversation } = await emitAck<{ conversation: Conversation }>(v.socket, 'chat:start', {
      name: 'Tom',
      message: 'My card was declined',
      clientId: 't1',
    });
    await emitAck(m, 'message:send', { conversationId: conversation.id, body: 'Let me check', clientId: 'm1' });

    // Daniel isn't signed in yet.
    const offline = await m.timeout(5000).emitWithAck('chat:transfer', { conversationId: conversation.id, toAgentId: daniel.agent.id });
    expect(offline).toEqual({ ok: false, error: 'agent_offline' });
    const self = await m.timeout(5000).emitWithAck('chat:transfer', { conversationId: conversation.id, toAgentId: maya.agent.id });
    expect(self.ok).toBe(false);

    const d = await connected(daniel.token);
    const told = waitFor<{ conversation: Conversation; fromName: string; note: string | null }>(d, 'chat:transferred');
    const visitorSees: Message[] = [];
    v.socket.on('message:new', (msg) => visitorSees.push(msg));
    const conv = await emitAck<Conversation>(m, 'chat:transfer', {
      conversationId: conversation.id,
      toAgentId: daniel.agent.id,
      note: 'Billing question — card declined twice',
    });
    expect(conv).toMatchObject({ assigneeId: daniel.agent.id, assigneeName: 'Daniel Brooks', status: 'active' });
    expect(conv.participantIds).not.toContain(maya.agent.id);
    expect(await told).toMatchObject({ fromName: 'Maya Chen', note: 'Billing question — card declined twice' });

    // Daniel's first message joins the chat.
    await emitAck(d, 'message:send', { conversationId: conversation.id, body: 'Hi Tom, Daniel here', clientId: 'd1' });
    await new Promise((r) => setTimeout(r, 200));
    const bodies = visitorSees.map((x) => x.body);
    expect(bodies).toContain('Maya Chen transferred the chat to Daniel Brooks');
    expect(bodies).toContain('Daniel Brooks joined the chat');
    expect(bodies).not.toContain('Billing question — card declined twice'); // the note is internal
    m.disconnect();
    d.disconnect();
  });

  it('sends a chat back to the queue for a department', async () => {
    const maya = await login('maya@replyfinch.dev');
    const m = await connected(maya.token);
    const v = await visitor();
    const { conversation } = await emitAck<{ conversation: Conversation }>(v.socket, 'chat:start', {
      name: 'Una',
      department: 'Sales',
      message: 'Do you do bulk orders?',
      clientId: 'u1',
    });
    await emitAck(m, 'message:send', { conversationId: conversation.id, body: 'One sec', clientId: 'm2' });
    const conv = await emitAck<Conversation>(m, 'chat:transfer', { conversationId: conversation.id, department: 'Billing' });
    expect(conv).toMatchObject({ status: 'waiting', assigneeId: null, department: 'Billing', participantIds: [] });
    const both = await m.timeout(5000).emitWithAck('chat:transfer', { conversationId: conversation.id, department: 'Billing', toAgentId: 'x' });
    expect(both.ok).toBe(false);
    m.disconnect();
  });
});

describe('widget settings', () => {
  it('admins change how the widget looks and what it asks; the widget gets them', async () => {
    const maya = await login('maya@replyfinch.dev');
    const daniel = await login('daniel@replyfinch.dev');
    const defaults = (await call<WidgetSettings>('GET', '/settings/widget', daniel.token)).body;
    expect(defaults).toMatchObject({ color: null, position: 'right', emailField: 'optional' });
    expect(defaults.departments.length).toBeGreaterThan(0);

    const next: WidgetSettings = {
      color: '#0f766e',
      position: 'left',
      greeting: 'Hello from the Acme team!',
      offlineGreeting: 'We are closed — leave a note.',
      departments: ['Orders', 'Returns'],
      emailField: 'required',
    };
    expect((await call('PUT', '/settings/widget', daniel.token, next)).status).toBe(403);
    expect((await call('PUT', '/settings/widget', maya.token, { ...next, color: 'teal' })).status).toBe(400);
    const dup = await call<{ error: string }>('PUT', '/settings/widget', maya.token, { ...next, departments: ['Orders', 'orders'] });
    expect(dup).toMatchObject({ status: 400, body: { error: 'Each department needs a different name' } });

    const saved = await call<WidgetSettings>('PUT', '/settings/widget', maya.token, next);
    expect(saved.body.color).toBe('#0F766E');
    const v = await visitor();
    expect(v.config).toMatchObject({ ...next, color: '#0F766E', accountName: 'Acme Books' });
    v.socket.disconnect();
  });
});
