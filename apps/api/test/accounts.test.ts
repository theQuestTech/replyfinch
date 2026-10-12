import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import type {
  AgentClientEvents,
  AgentServerEvents,
  Conversation,
  OfflineMessage,
  Ticket,
  TicketMessage,
  Agent,
  PasswordLinkInfo,
  PlatformAccount,
  PlatformAccountCreated,
  WidgetConfig,
  VisitorClientEvents,
  VisitorServerEvents,
} from '@replyfinch/shared';
import { buildApp } from '../src/app';
import { EmailError, type Mailer, type OutgoingEmail } from '../src/email';
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



const tokenFrom = (text: string) => /reset-password\?token=([\w-]+)/.exec(text)![1]!;

describe('forgot password', () => {
  it('emails a one-time link, sets the new password and signs out everywhere else', async () => {
    const before = sent.length;
    expect((await call<{ ok: boolean }>('POST', '/auth/forgot', undefined, { email: 'nobody@example.com' })).body.ok).toBe(true);
    expect(sent.length).toBe(before); // same answer, no email

    const old = await login('daniel@replyfinch.dev');
    await new Promise((r) => setTimeout(r, 1100)); // tokens are compared to the second
    expect((await call<{ ok: boolean }>('POST', '/auth/forgot', undefined, { email: 'Daniel@Replyfinch.dev' })).body.ok).toBe(true);
    const mail = sent.at(-1)!;
    expect(mail).toMatchObject({ to: 'daniel@replyfinch.dev', subject: 'Reset your Replyfinch password' });
    const token = tokenFrom(mail.text);

    const info = await call<PasswordLinkInfo>('GET', `/auth/reset/${token}`);
    expect(info.body).toMatchObject({ purpose: 'reset', name: 'Daniel Brooks', accountName: 'Acme Books' });
    expect((await call<{ error: string }>('POST', '/auth/reset', undefined, { token, password: 'short' })).body.error).toBe('Use at least 10 characters');
    const done = await call<{ token: string; agent: Agent }>('POST', '/auth/reset', undefined, { token, password: 'a-brand-new-password' });
    expect(done.status).toBe(200);
    expect(done.body.agent.email).toBe('daniel@replyfinch.dev');
    expect((await call('GET', '/me', done.body.token)).status).toBe(200);

    expect((await call('GET', '/me', old.token)).status).toBe(401); // the old sign-in is gone
    expect((await call('POST', '/auth/login', undefined, { email: 'daniel@replyfinch.dev', password: DEMO_PASSWORD })).status).toBe(401);
    expect((await call('POST', '/auth/login', undefined, { email: 'daniel@replyfinch.dev', password: 'a-brand-new-password' })).status).toBe(200);
    // A link works once.
    expect((await call('POST', '/auth/reset', undefined, { token, password: 'another-password-1' })).status).toBe(400);
    expect((await call('GET', `/auth/reset/${token}`)).status).toBe(404);
  });
});

describe('platform accounts', () => {
  it('only platform admins create accounts', async () => {
    const maya = await login('maya@replyfinch.dev');
    expect((await call<Agent>('GET', '/me', maya.token)).body.platformAdmin).toBe(true);
    const daniel = (await call<{ token: string; agent: Agent }>('POST', '/auth/login', undefined, { email: 'daniel@replyfinch.dev', password: 'a-brand-new-password' })).body;
    expect(daniel.agent.platformAdmin).toBe(false);
    expect((await call('GET', '/platform/accounts', daniel.token)).status).toBe(403);
    expect((await call('POST', '/platform/accounts', daniel.token, { company: 'X', name: 'Y', email: 'y@example.com' })).status).toBe(403);
  });

  it('creates an account from an early-access ticket; the new admin sets a password and signs in', async () => {
    const maya = await login('maya@replyfinch.dev');
    await call('POST', '/widget/site/early-access', undefined, { name: 'Rosa Diaz', email: 'rosa@plants.example', company: 'Rosa’s Plants' });
    const ticket = (await call<{ items: Ticket[] }>('GET', `/tickets?view=all&q=${encodeURIComponent('Rosa’s Plants')}`, maya.token)).body.items[0]!;

    const res = await call<PlatformAccountCreated>('POST', '/platform/accounts', maya.token, {
      company: 'Rosa’s Plants',
      name: 'Rosa Diaz',
      email: 'Rosa@Plants.example',
      ticketId: ticket.id,
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ account: { name: 'Rosa’s Plants' }, admin: { email: 'rosa@plants.example' }, emailed: true });
    const mail = sent.at(-1)!;
    expect(mail).toMatchObject({ to: 'rosa@plants.example', subject: 'Your Replyfinch account for Rosa’s Plants is ready' });
    expect(tokenFrom(mail.text)).toBe(tokenFrom(res.body.setPasswordUrl));

    // Nobody can sign in before the password is set.
    expect((await call('POST', '/auth/login', undefined, { email: 'rosa@plants.example', password: '!unset:' })).status).toBe(401);
    // The ticket says what happened.
    const thread = (await call<{ messages: TicketMessage[] }>('GET', `/tickets/${ticket.id}`, maya.token)).body.messages;
    expect(thread.at(-1)!.body).toContain('Created their Replyfinch account “Rosa’s Plants”');

    let list = (await call<PlatformAccount[]>('GET', '/platform/accounts', maya.token)).body;
    expect(list.find((a) => a.id === res.body.account.id)?.admins[0]).toMatchObject({ email: 'rosa@plants.example', passwordSet: false });

    // A new link replaces the old one.
    const again = await call<{ setPasswordUrl: string }>('POST', `/platform/users/${res.body.admin.id}/welcome-link`, maya.token);
    expect((await call('GET', `/auth/reset/${tokenFrom(res.body.setPasswordUrl)}`)).status).toBe(404);
    const token = tokenFrom(again.body.setPasswordUrl);
    expect((await call<PasswordLinkInfo>('GET', `/auth/reset/${token}`)).body).toMatchObject({ purpose: 'welcome', accountName: 'Rosa’s Plants' });

    const inside = await call<{ token: string; agent: Agent }>('POST', '/auth/reset', undefined, { token, password: 'rosas-plants-2026' });
    expect(inside.body.agent).toMatchObject({ role: 'admin', accountId: res.body.account.id, platformAdmin: false });
    // Their own, separate workspace: default saved replies, no Acme data.
    expect(((await call<unknown[]>('GET', '/shortcuts', inside.body.token)).body as unknown[]).length).toBeGreaterThan(0);
    expect((await call<{ total: number }>('GET', '/tickets?view=all', inside.body.token)).body.total).toBe(0);

    list = (await call<PlatformAccount[]>('GET', '/platform/accounts', maya.token)).body;
    expect(list.find((a) => a.id === res.body.account.id)?.admins[0]?.passwordSet).toBe(true);
    expect((await call<{ error: string }>('POST', '/platform/accounts', maya.token, { company: 'Dup', name: 'R', email: 'rosa@plants.example' })).body.error).toBe(
      'There’s already a Replyfinch user with this email',
    );
  });
});
