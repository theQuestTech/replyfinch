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
  TicketCounts,
  TicketList,
  TicketMessage,
  CustomerProfile,
  Message,
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


type Detail = { ticket: Ticket; messages: TicketMessage[] };

describe('tickets', () => {
  it('creates a ticket by hand, numbers it, and makes the customer', async () => {
    const maya = await login('maya@replyfinch.dev');
    const daniel = await login('daniel@replyfinch.dev');
    const dSock = await connected(daniel.token);
    const assigned = waitFor<{ ticket: Ticket; byName: string }>(dSock, 'ticket:assigned');

    const a = await call<Ticket>('POST', '/tickets', maya.token, {
      subject: 'Refund for order 1182',
      description: 'Called in: book arrived damaged.',
      name: 'Rosa Diaz',
      email: 'Rosa@Example.com',
      priority: 'high',
      assigneeId: daniel.agent.id,
    });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({
      subject: 'Refund for order 1182',
      status: 'open',
      priority: 'high',
      assigneeName: 'Daniel Brooks',
      requesterName: 'Rosa Diaz',
      source: 'manual',
      createdByName: 'Maya Chen',
    });
    expect((await assigned).byName).toBe('Maya Chen');
    const b = await call<Ticket>('POST', '/tickets', maya.token, { subject: 'Second', email: 'rosa@example.com' });
    expect(b.body.number).toBe(a.body.number + 1);
    // Same email → same customer, with the ticket on their profile.
    expect(b.body.visitorId).toBe(a.body.visitorId);
    expect(b.body.requesterName).toBe('Rosa Diaz');
    const profile = await call<CustomerProfile>('GET', `/customers/${a.body.visitorId}`, maya.token);
    expect(profile.body.tickets.map((t) => t.number).sort()).toEqual([a.body.number, b.body.number]);

    const detail = await call<Detail>('GET', `/tickets/${a.body.id}`, maya.token);
    expect(detail.body.messages).toMatchObject([{ kind: 'note', authorName: 'Maya Chen', body: 'Called in: book arrived damaged.' }]);

    // Numbers stay unique when created at the same moment.
    const many = await Promise.all([1, 2, 3, 4].map((i) => call<Ticket>('POST', '/tickets', maya.token, { subject: `Burst ${i}` })));
    expect(new Set(many.map((m) => m.body.number)).size).toBe(4);
  });

  it('rejects bad input and other accounts’ data', async () => {
    const maya = await login('maya@replyfinch.dev');
    expect((await call('POST', '/tickets', maya.token, { subject: '' })).status).toBe(400);
    expect((await call('POST', '/tickets', maya.token, { subject: 'x', assigneeId: 'usr_nope' })).status).toBe(400);
    expect((await call('POST', '/tickets', maya.token, { subject: 'x', from: { type: 'chat', id: 'cnv_nope' } })).status).toBe(404);
    expect((await call('GET', '/tickets/tk_nope', maya.token)).status).toBe(404);
    expect((await call('GET', '/tickets')).status).toBe(401);
  });

  it('turns an offline message into a ticket and replies by email', async () => {
    const maya = await login('maya@replyfinch.dev');
    const v = await visitor();
    const { id } = await emitAck<{ id: string }>(v.socket, 'offline:send', { name: 'Pia Novak', email: 'pia@example.com', message: 'Is my order shipped?' });
    const t = await call<Ticket>('POST', '/tickets', maya.token, { subject: 'Order status', from: { type: 'offline', id } });
    expect(t.body).toMatchObject({ source: 'offline', sourceId: id, requesterEmail: 'pia@example.com', visitorId: v.visitorId, assigneeId: null });
    const om = (await call<OfflineMessage[]>('GET', '/offline-messages', maya.token)).body.find((m) => m.id === id);
    expect(om?.status).toBe('handled');

    const res = await call<{ message: TicketMessage; events: TicketMessage[]; ticket: Ticket }>('POST', `/tickets/${t.body.id}/messages`, maya.token, {
      body: 'It ships tomorrow.',
      status: 'pending',
    });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatchObject({ kind: 'reply', emailedTo: 'pia@example.com' });
    // Replying took the unassigned ticket and set it pending.
    expect(res.body.ticket).toMatchObject({ status: 'pending', assigneeName: 'Maya Chen' });
    expect(res.body.events.map((e) => e.body).sort()).toEqual(['set status to Pending', 'took the ticket']);
    const email = sent.pop()!;
    expect(email).toMatchObject({ to: 'pia@example.com', subject: `[#${t.body.number}] Order status` });
    expect(email.text).toContain('It ships tomorrow.');
    expect(email.text).toContain('> Is my order shipped?');

    const thread = (await call<Detail>('GET', `/tickets/${t.body.id}`, maya.token)).body.messages;
    expect(thread.map((m) => m.kind)).toEqual(['customer', 'reply', 'event', 'event']);

    // A failed email is not saved to the thread.
    failNext = 'Domain not verified';
    const failed = await call<{ error: string }>('POST', `/tickets/${t.body.id}/messages`, maya.token, { body: 'Hello?' });
    expect(failed.status).toBe(502);
    expect(failed.body.error).toBe('Domain not verified');
    expect((await call<Detail>('GET', `/tickets/${t.body.id}`, maya.token)).body.messages).toHaveLength(4);
  });

  it('makes a ticket from a chat and leaves a note in the chat', async () => {
    const maya = await login('maya@replyfinch.dev');
    const v = await visitor();
    const { conversation } = await emitAck<{ conversation: Conversation }>(v.socket, 'chat:start', {
      name: 'Omar',
      message: 'My e-book won’t download',
      clientId: 'c1',
    });
    const t = await call<Ticket>('POST', '/tickets', maya.token, {
      subject: 'E-book download',
      email: 'omar@example.com',
      description: 'Needs a new link',
      from: { type: 'chat', id: conversation.id },
    });
    expect(t.body).toMatchObject({ source: 'chat', sourceId: conversation.id, requesterName: 'Omar', requesterEmail: 'omar@example.com' });
    const chat = await call<{ messages: Message[] }>('GET', `/conversations/${conversation.id}`, maya.token);
    expect(chat.body.messages.at(-1)).toMatchObject({ internal: true, body: `Ticket #${t.body.number} created by Maya Chen` });
    // The email typed in is saved on the customer.
    expect((await call<CustomerProfile>('GET', `/customers/${v.visitorId}`, maya.token)).body.customer.email).toBe('omar@example.com');

    // Notes don't need email and aren't sent.
    const before = sent.length;
    const note = await call<{ message: TicketMessage }>('POST', `/tickets/${t.body.id}/messages`, maya.token, { body: 'Checked the store', internal: true });
    expect(note.body.message).toMatchObject({ kind: 'note', emailedTo: null });
    expect(sent.length).toBe(before);
  });

  it('needs an email address to reply', async () => {
    const maya = await login('maya@replyfinch.dev');
    const t = await call<Ticket>('POST', '/tickets', maya.token, { subject: 'Internal task' });
    expect(t.body.visitorId).toBeNull();
    const res = await call<{ error: string }>('POST', `/tickets/${t.body.id}/messages`, maya.token, { body: 'hi' });
    expect(res.status).toBe(400);
  });

  it('updates fields, logs each change, and filters by view', async () => {
    const maya = await login('maya@replyfinch.dev');
    const daniel = await login('daniel@replyfinch.dev');
    const t = await call<Ticket>('POST', '/tickets', maya.token, { subject: 'Wrong address', email: 'lee@example.com' });
    const up = await call<{ ticket: Ticket; events: TicketMessage[] }>('PATCH', `/tickets/${t.body.id}`, daniel.token, {
      assigneeId: daniel.agent.id,
      priority: 'urgent',
    });
    expect(up.body.ticket).toMatchObject({ assigneeName: 'Daniel Brooks', priority: 'urgent' });
    expect(up.body.events.map((e) => `${e.authorName} ${e.body}`).sort()).toEqual(['Daniel Brooks set priority to Urgent', 'Daniel Brooks took the ticket']);
    // No change → no events.
    expect((await call<{ events: TicketMessage[] }>('PATCH', `/tickets/${t.body.id}`, daniel.token, { priority: 'urgent' })).body.events).toEqual([]);

    const mine = await call<TicketList>('GET', '/tickets?view=mine', daniel.token);
    expect(mine.body.items.map((x) => x.id)).toContain(t.body.id);
    const counts = (await call<TicketCounts>('GET', '/tickets/counts', daniel.token)).body;
    expect(counts.mine).toBe(mine.body.total);

    const solved = await call<{ ticket: Ticket }>('PATCH', `/tickets/${t.body.id}`, daniel.token, { status: 'solved' });
    expect(solved.body.ticket.solvedAt).toBeTypeOf('number');
    expect((await call<TicketList>('GET', '/tickets?view=mine', daniel.token)).body.items.map((x) => x.id)).not.toContain(t.body.id);
    expect((await call<TicketList>('GET', '/tickets?view=solved', daniel.token)).body.items.map((x) => x.id)).toContain(t.body.id);
    // Reopening clears the solved time.
    expect((await call<{ ticket: Ticket }>('PATCH', `/tickets/${t.body.id}`, daniel.token, { status: 'open' })).body.ticket.solvedAt).toBeNull();

    // Search by number, subject or customer.
    for (const q of [`#${t.body.number}`, 'wrong addr', 'lee@']) {
      const found = await call<TicketList>('GET', `/tickets?view=all&q=${encodeURIComponent(q)}`, maya.token);
      expect(found.body.items.map((x) => x.id)).toContain(t.body.id);
    }
  });

  it('turns the website’s early-access form into a ticket', async () => {
    const maya = await login('maya@replyfinch.dev');
    const form = { name: 'Sam Lee', email: 'Sam@Bakery.example', company: 'Sam’s Bakery', website: 'bakery.example', teamSize: '2-5', message: 'We get lots of order questions.' };
    expect((await call<{ ok: boolean }>('POST', '/widget/site/early-access', undefined, form)).body.ok).toBe(true);
    const list = (await call<TicketList>('GET', `/tickets?view=all&q=${encodeURIComponent('Sam’s Bakery')}`, maya.token)).body;
    expect(list.items[0]).toMatchObject({ subject: 'Early access: Sam’s Bakery', source: 'website', requesterEmail: 'sam@bakery.example', status: 'open' });
    const d = (await call<Detail>('GET', `/tickets/${list.items[0]!.id}`, maya.token)).body;
    expect(d.messages[0]).toMatchObject({
      kind: 'customer',
      body: 'Company: Sam’s Bakery\nWebsite: bakery.example\nTeam size: 2-5\n\nWe get lots of order questions.',
    });
    // Bots that fill the hidden field get a thank-you, and no ticket.
    await call('POST', '/widget/site/early-access', undefined, { ...form, company: 'Spam Inc', fax: 'x' });
    expect((await call<TicketList>('GET', '/tickets?view=all&q=Spam', maya.token)).body.total).toBe(0);
    expect((await call<{ error: string }>('POST', '/widget/site/early-access', undefined, { name: 'x', email: 'nope' })).body.error).toBe('Please check your email address');
  });
});
