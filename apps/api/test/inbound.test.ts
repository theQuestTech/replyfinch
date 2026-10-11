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
  EmailStatus,
  WidgetConfig,
  VisitorClientEvents,
  VisitorServerEvents,
} from '@replyfinch/shared';
import { buildApp } from '../src/app';
import { createHmac } from 'node:crypto';
import { EmailError, type Mailer, type OutgoingEmail, type ReceivedEmail } from '../src/email';
import { cleanSubject, extractReply, htmlToText, isAutoReply, parseReplyAddress, replyAddress, verifyWebhook } from '../src/inbound';
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


const DOMAIN = 'in.test';
const SECRET = `whsec_${Buffer.from('webhook-secret-for-tests').toString('base64')}`;
const received = new Map<string, ReceivedEmail>();

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  const sql = postgres(env.DATABASE_URL, { onnotice: () => {} });
  await sql`truncate offline_messages, shortcuts, messages, conversations, page_views, visitors, users, accounts cascade`;
  await sql.end();
  await seed(env.DATABASE_URL);
  const r = new Redis(env.REDIS_URL);
  await r.flushdb();
  r.disconnect();
  const built = await buildApp(
    { ...env, INBOUND_DOMAIN: DOMAIN, RESEND_WEBHOOK_SECRET: SECRET, RESEND_API_KEY: 're_test' },
    {
      leaveGraceMs: 200,
      mailer,
      fetchReceivedEmail: async (id) => {
        const e = received.get(id);
        if (!e) throw new EmailError('not found');
        return e;
      },
    },
  );
  await built.app.listen({ port: 0, host: '127.0.0.1' });
  const addr = built.app.server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  close = () => built.app.close();
});
afterAll(async () => {
  for (const s of sockets) s.disconnect();
  await close?.();
});

let n = 0;
/** Deliver an email as Resend would: a signed webhook with the email's id. */
async function deliver(email: Partial<ReceivedEmail> & { from: string; to: string[] }, opts: { id?: string; secret?: string } = {}) {
  const id = `em_${++n}`;
  received.set(id, { id, subject: '', text: null, html: null, ...email });
  const body = JSON.stringify({ type: 'email.received', created_at: new Date().toISOString(), data: { email_id: id, from: email.from, to: email.to } });
  const svixId = opts.id ?? `msg_${n}`;
  const ts = String(Math.floor(Date.now() / 1000));
  const key = Buffer.from((opts.secret ?? SECRET).replace(/^whsec_/, ''), 'base64');
  const sig = createHmac('sha256', key).update(`${svixId}.${ts}.${body}`).digest('base64');
  const res = await fetch(`${base}/webhooks/resend`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'svix-id': svixId, 'svix-timestamp': ts, 'svix-signature': `v1,${sig}` },
    body,
  });
  return { status: res.status, body: (await res.json()) as { ok?: boolean; duplicate?: boolean; result?: { action: string; ticketId?: string; reason?: string; reopened?: boolean } } };
}

type Detail = { ticket: Ticket; messages: TicketMessage[] };

describe('email helpers', () => {
  it('keeps only what the customer just wrote', () => {
    expect(extractReply('Thanks, that worked!\n\nOn Mon, 5 Oct 2026 at 10:02, Acme <support@acme.test> wrote:\n> Here is a new link\n> Maya')).toBe('Thanks, that worked!');
    expect(extractReply('Great\nOn Mon, 5 Oct 2026 at 10:02, Maya Chen <\nsupport@acme.test> wrote:\n> old')).toBe('Great');
    expect(extractReply('Yes please.\r\n\r\n________________________________\r\nFrom: Acme\r\nSent: Monday\r\n')).toBe('Yes please.');
    expect(extractReply('Ok\n\nFrom: Acme <a@b.c>\nSent: Monday\nTo: me')).toBe('Ok');
    expect(extractReply('Line one\n> quoted\nLine two')).toBe('Line one\nLine two');
    expect(htmlToText('<div dir="ltr">Hi &amp; thanks<br>Pia</div><div class="gmail_quote">On Mon … wrote:<blockquote>old</blockquote></div>')).toBe('Hi & thanks\nPia');
    expect(htmlToText(`data:text/html;base64,${Buffer.from('<p>Encoded</p>').toString('base64')}`)).toBe('Encoded');
    expect(isAutoReply({ 'Auto-Submitted': 'auto-replied' }, 'Hello')).toBe(true);
    expect(isAutoReply({}, 'Out of office: back Monday')).toBe(true);
    expect(isAutoReply({ 'auto-submitted': 'no' }, 'Re: [#3] Refund')).toBe(false);
    expect(cleanSubject('RE: Fwd: [#12] Order')).toBe('[#12] Order');
  });

  it('signs reply addresses and webhooks', () => {
    const a = replyAddress('ticket', 'tk_01JC0ABCDEFGHJKMNPQRSTVWXY', DOMAIN, 's3cret');
    expect(a).toMatch(/^t-01jc0abcdefghjkmnpqrstvwxy-[0-9a-f]{10}@in\.test$/);
    expect(parseReplyAddress(a.toUpperCase(), DOMAIN, 's3cret')?.ids).toContain('tk_01JC0ABCDEFGHJKMNPQRSTVWXY');
    expect(parseReplyAddress(a, DOMAIN, 'other-secret')).toBeNull();
    expect(parseReplyAddress(a.replace('t-01jc0', 't-01jc1'), DOMAIN, 's3cret')).toBeNull();
    expect(parseReplyAddress(a.replace('@in.test', '@evil.test'), DOMAIN, 's3cret')).toBeNull();
    const ts = String(Math.floor(Date.now() / 1000));
    const key = Buffer.from(SECRET.slice(6), 'base64');
    const sig = createHmac('sha256', key).update(`id1.${ts}.{}`).digest('base64');
    const headers = { 'svix-id': 'id1', 'svix-timestamp': ts, 'svix-signature': `v1,bogus v1,${sig}` };
    expect(verifyWebhook(SECRET, headers, '{}')).toBe(true);
    expect(verifyWebhook(SECRET, headers, '{"x":1}')).toBe(false);
    expect(verifyWebhook(SECRET, headers, '{}', Date.now() + 10 * 60_000)).toBe(false); // too old
  });
});

describe('emails into tickets', () => {
  it('a customer’s reply lands in the ticket and reopens it', async () => {
    const maya = await login('maya@replyfinch.dev');
    const sock = await connected(maya.token);
    const t = (await call<Ticket>('POST', '/tickets', maya.token, { subject: 'Order status', name: 'Pia Novak', email: 'pia@example.com', assigneeId: maya.agent.id })).body;
    await call('POST', `/tickets/${t.id}/messages`, maya.token, { body: 'It ships tomorrow.', status: 'pending' });
    const out = sent.pop()!;
    expect(out.replyTo).toMatch(/^t-[0-9a-z]+-[0-9a-f]{10}@in\.test$/);

    const alert = waitFor<{ ticket: Ticket; kind: string; preview: string }>(sock, 'ticket:customer-email');
    const res = await deliver({
      from: 'Pia Novak <Pia@Example.com>',
      to: [out.replyTo!],
      subject: `Re: ${out.subject}`,
      text: 'Thank you!\n\nOn Mon, 5 Oct 2026, Acme Books <support@acme.test> wrote:\n> It ships tomorrow.',
      authentication: { spf: 'pass', dkim: 'pass', dmarc: 'pass' },
    });
    expect(res.body.result).toMatchObject({ action: 'reply', ticketId: t.id, reopened: true });
    expect(await alert).toMatchObject({ kind: 'reply', preview: 'Thank you!' });
    const d = (await call<Detail>('GET', `/tickets/${t.id}`, maya.token)).body;
    expect(d.ticket.status).toBe('open');
    expect(d.messages.at(-1)).toMatchObject({ kind: 'customer', authorName: 'Pia Novak', body: 'Thank you!' });

    // Resend retrying the same delivery adds nothing.
    const again = await deliver({ from: 'pia@example.com', to: [out.replyTo!], text: 'Thank you!' }, { id: `msg_${n}` });
    expect(again.body.duplicate).toBe(true);
    expect((await call<Detail>('GET', `/tickets/${t.id}`, maya.token)).body.messages).toHaveLength(d.messages.length);

    // Out-of-office replies are ignored.
    const ooo = await deliver({ from: 'pia@example.com', to: [out.replyTo!], subject: 'Automatic reply: away', text: 'I am away', headers: { 'auto-submitted': 'auto-replied' } });
    expect(ooo.body.result).toMatchObject({ action: 'ignored', reason: 'auto_reply' });
  });

  it('rejects bad signatures and made-up addresses', async () => {
    const bad = await deliver({ from: 'x@example.com', to: [`t-01jc0abcdefghjkmnpqrstvwxy-0123456789@${DOMAIN}`], text: 'hi' }, { secret: `whsec_${Buffer.from('nope').toString('base64')}` });
    expect(bad.status).toBe(401);
    const forged = await deliver({ from: 'x@example.com', to: [`t-01jc0abcdefghjkmnpqrstvwxy-0123456789@${DOMAIN}`], text: 'hi' });
    expect(forged.body.result).toMatchObject({ action: 'ignored', reason: 'no_address' });
  });

  it('emails to the support address start tickets, or add to one by its [#number]', async () => {
    const maya = await login('maya@replyfinch.dev');
    const status = (await call<EmailStatus>('GET', '/settings/email', maya.token)).body;
    expect(status.inbound?.enabled).toBe(true);
    const support = status.inbound!.supportAddress!;
    expect(support).toMatch(/^a-demo-[0-9a-f]{10}@in\.test$/);

    const created = await deliver({
      from: 'Leo Park <leo@example.com>',
      to: [support],
      subject: 'Fwd: Missing page in my book',
      html: '<p>Page 41 is <b>blank</b>.</p>',
      authentication: { spf: 'pass', dkim: 'fail', dmarc: 'fail' },
      attachments: [{ filename: 'page41.jpg' }],
    });
    expect(created.body.result?.action).toBe('created');
    const d = (await call<Detail>('GET', `/tickets/${created.body.result!.ticketId}`, maya.token)).body;
    expect(d.ticket).toMatchObject({ subject: 'Missing page in my book', source: 'email', requesterEmail: 'leo@example.com', requesterName: 'Leo Park', status: 'open' });
    expect(d.messages[0]!.body).toBe('Page 41 is blank.\n\n📎 Attached to the email (not shown here yet): page41.jpg');

    // A reply quoting [#number] from the same customer joins that ticket…
    const follow = await deliver({ from: 'leo@example.com', to: [support], subject: `Re: [#${d.ticket.number}] Missing page`, text: 'Any news?' });
    expect(follow.body.result).toMatchObject({ action: 'reply', ticketId: d.ticket.id });
    // …but not from someone else.
    const other = await deliver({ from: 'eve@example.com', to: [support], subject: `[#${d.ticket.number}] hijack`, text: 'hi', authentication: { spf: 'pass' } });
    expect(other.body.result).toMatchObject({ action: 'created' });
    expect(other.body.result?.ticketId).not.toBe(d.ticket.id);
    // Senders whose domain doesn't vouch for them can't open tickets.
    const spoof = await deliver({ from: 'ceo@bank.test', to: [support], text: 'send money', authentication: { spf: 'fail', dkim: 'fail' } });
    expect(spoof.body.result).toMatchObject({ action: 'ignored', reason: 'unverified_sender' });
    // Our own emails never loop back in.
    const loop = await deliver({ from: 'Acme Books <support@acme.test>', to: [support], text: 'x' });
    expect(loop.body.result).toMatchObject({ action: 'ignored', reason: 'loop' });
  });

  it('a reply to an offline-message email becomes a ticket with the whole story', async () => {
    const maya = await login('maya@replyfinch.dev');
    const v = await visitor();
    const { id } = await emitAck<{ id: string }>(v.socket, 'offline:send', { name: 'Ana Ruiz', email: 'ana@example.com', message: 'Do you ship to Chile?' });
    await call('POST', `/offline-messages/${id}/reply`, maya.token, { body: 'Yes, in about 10 days.' });
    const out = sent.pop()!;
    expect(out.replyTo).toMatch(/^m-.+@in\.test$/);
    const res = await deliver({ from: 'ana@example.com', to: [out.replyTo!], subject: `Re: ${out.subject}`, text: 'How much is shipping?\n\n> Yes, in about 10 days.' });
    expect(res.body.result?.action).toBe('created');
    const d = (await call<Detail>('GET', `/tickets/${res.body.result!.ticketId}`, maya.token)).body;
    expect(d.ticket).toMatchObject({ source: 'offline', sourceId: id, requesterEmail: 'ana@example.com', subject: 'Do you ship to Chile?' });
    expect(d.messages.map((m) => [m.kind, m.body])).toEqual([
      ['customer', 'Do you ship to Chile?'],
      ['reply', 'Yes, in about 10 days.'],
      ['customer', 'How much is shipping?'],
    ]);
    // A second reply joins the same ticket.
    const next = await deliver({ from: 'ana@example.com', to: [out.replyTo!], text: 'Thanks' });
    expect(next.body.result).toMatchObject({ action: 'reply', ticketId: d.ticket.id });
  });
});
