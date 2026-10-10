import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import type {
  AgentClientEvents,
  AgentServerEvents,
  Conversation,
  OfflineMessage,
  OfflineReply,
  Message,
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
  const built = await buildApp(env, { leaveGraceMs: 200, mailer });
  await built.app.listen({ port: 0, host: '127.0.0.1' });
  const addr = built.app.server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  close = () => built.app.close();
});
afterAll(async () => {
  for (const s of sockets) s.disconnect();
  await close?.();
});

describe('email', () => {
  it('reports that email is set up, and tells the widget', async () => {
    const maya = await login('maya@replyfinch.dev');
    expect((await call('GET', '/settings/email', maya.token)).body).toEqual({ enabled: true, from: 'Acme Books <support@acme.test>', replyTo: null });
    const v = await visitor();
    expect(v.config.emailTranscripts).toBe(true);
    v.socket.disconnect();
    const test = await call<{ to: string }>('POST', '/settings/email/test', maya.token);
    expect(test.body.to).toBe('maya@replyfinch.dev');
    expect(sent.pop()).toMatchObject({ to: 'maya@replyfinch.dev', subject: 'Replyfinch email is working' });
  });

  it('replies to an offline message by email and marks it handled', async () => {
    const maya = await login('maya@replyfinch.dev');
    const v = await visitor();
    const { id } = await emitAck<{ id: string }>(v.socket, 'offline:send', {
      name: 'Pia Novak',
      email: 'pia@example.com',
      message: 'Do you sell <gift cards>?',
    });
    const res = await call<{ reply: OfflineReply; message: OfflineMessage }>('POST', `/offline-messages/${id}/reply`, maya.token, {
      body: 'Yes! From €10.\nSee you soon',
    });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatchObject({ status: 'handled', handledByName: 'Maya Chen' });
    const email = sent.pop()!;
    expect(email).toMatchObject({ to: 'pia@example.com', subject: 'Re: your message to Acme Books' });
    expect(email.text).toContain('Yes! From €10.');
    expect(email.text).toContain('> Do you sell <gift cards>?');
    expect(email.html).toContain('Do you sell &lt;gift cards&gt;?'); // escaped
    expect(email.html).toContain('Hi Pia,');
    const replies = (await call<OfflineReply[]>('GET', `/offline-messages/${id}/replies`, maya.token)).body;
    expect(replies).toEqual([expect.objectContaining({ authorName: 'Maya Chen', to: 'pia@example.com', body: 'Yes! From €10.\nSee you soon' })]);

    // A failure from the email service is shown to the agent, and nothing is saved.
    failNext = 'The domain is not verified';
    const bad = await call<{ error: string }>('POST', `/offline-messages/${id}/reply`, maya.token, { body: 'again' });
    expect(bad).toMatchObject({ status: 502, body: { error: 'The domain is not verified' } });
    expect((await call<OfflineReply[]>('GET', `/offline-messages/${id}/replies`, maya.token)).body).toHaveLength(1);
    v.socket.disconnect();
  });

  it('emails chat transcripts — from the agent app and from the widget — without internal notes', async () => {
    const maya = await login('maya@replyfinch.dev');
    const m = await connected(maya.token);
    const v = await visitor();
    const { conversation } = await emitAck<{ conversation: Conversation }>(v.socket, 'chat:start', {
      name: 'Otto Berg',
      email: 'otto@example.com',
      message: 'Is the atlas back in stock?',
      clientId: 'o1',
    });
    await emitAck(m, 'message:send', { conversationId: conversation.id, body: 'Yes, since Monday!', clientId: 'o2' });
    await emitAck(m, 'message:send', { conversationId: conversation.id, body: 'secret note', clientId: 'o3', internal: true });

    // Only ended chats can be sent from the widget.
    const early = await v.socket.timeout(5000).emitWithAck('chat:transcript', { conversationId: conversation.id, email: 'otto@example.com' });
    expect(early).toEqual({ ok: false, error: 'not_ended' });
    m.emit('chat:end', { conversationId: conversation.id });
    await waitFor<Conversation>(m, 'conversation:update', (c) => c.id === conversation.id && c.status === 'ended');

    const note = waitFor<Message>(m, 'message:new', (x) => x.body.startsWith('Transcript emailed'));
    expect((await call<{ to: string }>('POST', `/conversations/${conversation.id}/transcript`, maya.token, {})).body).toEqual({ to: 'otto@example.com' });
    expect(await note).toMatchObject({ internal: true, body: 'Transcript emailed to otto@example.com' });
    const email = sent.pop()!;
    expect(email).toMatchObject({ to: 'otto@example.com', subject: 'Your chat with Acme Books' });
    expect(email.text).toContain('Otto Berg: Is the atlas back in stock?');
    expect(email.text).toContain('Maya Chen: Yes, since Monday!');
    expect(email.text).not.toContain('secret note');

    // The visitor asks for a copy (a few times at most).
    await emitAck(v.socket, 'chat:transcript', { conversationId: conversation.id, email: 'otto+copy@example.com' });
    expect(sent.pop()).toMatchObject({ to: 'otto+copy@example.com' });
    await emitAck(v.socket, 'chat:transcript', { conversationId: conversation.id, email: 'otto@example.com' });
    await emitAck(v.socket, 'chat:transcript', { conversationId: conversation.id, email: 'otto@example.com' });
    const limited = await v.socket.timeout(5000).emitWithAck('chat:transcript', { conversationId: conversation.id, email: 'otto@example.com' });
    expect(limited).toEqual({ ok: false, error: 'rate_limited' });
    m.disconnect();
  });
});

describe('Resend mailer', () => {
  it('is off without settings, and posts to Resend with them', async () => {
    const off = createMailer({});
    expect(off.enabled).toBe(false);
    await expect(off.send({ to: 'a@b.c', subject: 's', text: 't', html: 'h' })).rejects.toThrow('isn’t set up');

    const fetch = vi.fn(async () => new Response(JSON.stringify({ id: 'e1' }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    try {
      const on = createMailer({ apiKey: 're_123', from: 'Acme <hi@acme.test>', replyTo: 'help@acme.test' });
      await on.send({ to: 'x@y.z', subject: 'Hello', text: 'T', html: '<p>H</p>' });
      const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe('https://api.resend.com/emails');
      expect((init.headers as Record<string, string>).authorization).toBe('Bearer re_123');
      expect(JSON.parse(init.body as string)).toEqual({
        from: 'Acme <hi@acme.test>',
        to: ['x@y.z'],
        subject: 'Hello',
        text: 'T',
        html: '<p>H</p>',
        reply_to: 'help@acme.test',
      });
      fetch.mockResolvedValueOnce(new Response(JSON.stringify({ message: 'The quscer.com domain is not verified' }), { status: 403 }));
      await expect(on.send({ to: 'x@y.z', subject: 's', text: 't', html: 'h' })).rejects.toThrow('The quscer.com domain is not verified');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
