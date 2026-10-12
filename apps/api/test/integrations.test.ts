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
  Webhook,
  WebhookDelivery,
  WebhookEvent,
  ChatEventData,
  TicketEventData,
  WidgetConfig,
  VisitorClientEvents,
  VisitorServerEvents,
} from '@replyfinch/shared';
import { buildApp } from '../src/app';
import { createServer, type IncomingMessage } from 'node:http';
import { createHmac } from 'node:crypto';
import { EmailError, type Mailer, type OutgoingEmail } from '../src/email';
import { checkUrl } from '../src/services/webhooks';
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


type Hit = { path: string; headers: IncomingMessage['headers']; body: string; event: WebhookEvent };
const hits: Hit[] = [];
/** How the test receiver answers, per path: a list of status codes used in turn (then 200). */
const answers = new Map<string, number[]>();
let receiver = '';
let stopReceiver: () => void;

beforeAll(async () => {
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const queue = answers.get(req.url!) ?? [];
      const status = queue.shift() ?? 200;
      if (status === 200) hits.push({ path: req.url!, headers: req.headers, body, event: JSON.parse(body) });
      res.writeHead(status).end('ok');
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  const a = srv.address();
  receiver = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
  stopReceiver = () => srv.close();

  await runMigrations(env.DATABASE_URL);
  const sql = postgres(env.DATABASE_URL, { onnotice: () => {} });
  await sql`truncate offline_messages, shortcuts, messages, conversations, page_views, visitors, users, accounts cascade`;
  await sql.end();
  await seed(env.DATABASE_URL);
  const r = new Redis(env.REDIS_URL);
  await r.flushdb();
  r.disconnect();
  const built = await buildApp(env, { leaveGraceMs: 200, mailer, webhookRetryDelaysMs: [100, 100] });
  await built.app.listen({ port: 0, host: '127.0.0.1' });
  const addr = built.app.server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  close = () => built.app.close();
});
afterAll(async () => {
  for (const s of sockets) s.disconnect();
  await close?.();
  stopReceiver?.();
});

async function received(path: string, type: string, n = 1, ms = 8000) {
  const t0 = Date.now();
  for (;;) {
    const got = hits.filter((h) => h.path === path && h.event.type === type);
    if (got.length >= n) return got;
    if (Date.now() - t0 > ms) throw new Error(`no ${type} at ${path} (got ${hits.map((h) => `${h.path}:${h.event.type}`).join(', ')})`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

const v1 = async <T = unknown>(method: string, path: string, key: string, body?: unknown) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${key}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: (await res.json()) as T };
};

describe('webhooks', () => {
  it('only admins manage integrations', async () => {
    const daniel = await login('daniel@replyfinch.dev');
    expect((await call('GET', '/integrations/webhooks', daniel.token)).status).toBe(403);
    expect((await call('POST', '/integrations/api-keys', daniel.token, { name: 'x' })).status).toBe(403);
  });

  it('delivers signed chat and ticket events', async () => {
    const maya = await login('maya@replyfinch.dev');
    const created = await call<Webhook>('POST', '/integrations/webhooks', maya.token, {
      url: `${receiver}/all`,
      events: ['chat.started', 'chat.ended', 'ticket.created', 'ticket.status_changed', 'offline_message.created'],
      description: 'Everything',
    });
    expect(created.status).toBe(201);
    expect(created.body.secret).toMatch(/^whsec_/);
    // A second, turned-off webhook gets nothing.
    const off = (await call<Webhook>('POST', '/integrations/webhooks', maya.token, { url: `${receiver}/off`, events: ['chat.started'] })).body;
    await call('PATCH', `/integrations/webhooks/${off.id}`, maya.token, { enabled: false });

    const v = await visitor();
    const { conversation } = await emitAck<{ conversation: Conversation }>(v.socket, 'chat:start', { name: 'Ana', email: 'ana@example.com', message: 'Hi there', clientId: 'c1' });
    const [hit] = await received('/all', 'chat.started');
    const data = hit!.event.data as ChatEventData;
    expect(data.conversation.id).toBe(conversation.id);
    expect(data.customer).toMatchObject({ name: 'Ana', email: 'ana@example.com' });
    expect(hit!.headers['replyfinch-event']).toBe('chat.started');
    // The signature checks out with the webhook's secret.
    const sig = String(hit!.headers['replyfinch-signature']);
    const [, ts, v1sig] = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(sig)!;
    expect(createHmac('sha256', created.body.secret).update(`${ts}.${hit!.body}`).digest('hex')).toBe(v1sig);

    const agent = agentSocket(maya.token);
    await new Promise<void>((r) => agent.once('connect', () => r()));
    agent.emit('chat:end', { conversationId: conversation.id });
    const [ended] = await received('/all', 'chat.ended');
    expect((ended!.event.data as ChatEventData).messages!.map((m) => m.body)).toContain('Hi there');

    const t = await call<Ticket>('POST', '/tickets', maya.token, { subject: 'Hook test', email: 'zed@example.com' });
    expect(((await received('/all', 'ticket.created'))[0]!.event.data as TicketEventData).ticket.id).toBe(t.body.id);
    await call('PATCH', `/tickets/${t.body.id}`, maya.token, { status: 'solved' });
    const changed = (await received('/all', 'ticket.status_changed'))[0]!.event.data as TicketEventData;
    expect(changed).toMatchObject({ previousStatus: 'open', ticket: { status: 'solved' } });

    await new Promise((r) => setTimeout(r, 300));
    expect(hits.some((h) => h.path === '/off')).toBe(false);
  });

  it('retries failures, and lets admins test and retry by hand', async () => {
    const maya = await login('maya@replyfinch.dev');
    const w = (await call<Webhook>('POST', '/integrations/webhooks', maya.token, { url: `${receiver}/flaky`, events: ['ticket.created'] })).body;
    answers.set('/flaky', [500]); // fails once, then works
    await call('POST', '/tickets', maya.token, { subject: 'Retry me' });
    await received('/flaky', 'ticket.created');
    const dels = (await call<WebhookDelivery[]>('GET', `/integrations/webhooks/${w.id}/deliveries`, maya.token)).body;
    expect(dels[0]).toMatchObject({ status: 'succeeded', attempts: 2, responseStatus: 200 });

    // Fails every time: after the retries it's marked failed; a manual retry sends it again.
    answers.set('/flaky', [500, 500, 500]);
    await call('POST', '/tickets', maya.token, { subject: 'Give up' });
    let failed: WebhookDelivery | undefined;
    for (let i = 0; i < 60 && !failed; i++) {
      await new Promise((r) => setTimeout(r, 100));
      failed = (await call<WebhookDelivery[]>('GET', `/integrations/webhooks/${w.id}/deliveries`, maya.token)).body.find((d) => d.status === 'failed');
    }
    expect(failed).toMatchObject({ attempts: 3, responseStatus: 500, error: 'The address answered 500' });
    expect((await call<Webhook[]>('GET', '/integrations/webhooks', maya.token)).body.find((x) => x.id === w.id)?.failingSince).toBeTypeOf('number');
    await call('POST', `/integrations/deliveries/${failed!.id}/retry`, maya.token);
    await received('/flaky', 'ticket.created', 2);

    const ping = await call<WebhookDelivery>('POST', `/integrations/webhooks/${w.id}/test`, maya.token);
    expect(ping.body).toMatchObject({ type: 'ping', status: 'succeeded' });
  });

  it('refuses addresses inside our own network (in production)', async () => {
    for (const url of ['http://example.com/x', 'https://localhost/x', 'https://127.0.0.1/x', 'https://10.1.2.3/x', 'https://[::1]/x', 'https://169.254.169.254/latest', 'https://user:pw@example.com/']) {
      await expect(checkUrl(url, false), url).rejects.toThrow();
    }
    await expect(checkUrl('https://93.184.215.14/hook', false)).resolves.toBeUndefined();
  });
});

describe('public API (Zapier)', () => {
  it('API keys: create, use, revoke', async () => {
    const maya = await login('maya@replyfinch.dev');
    const k = await call<{ id: string; key: string; prefix: string }>('POST', '/integrations/api-keys', maya.token, { name: 'Zapier' });
    expect(k.body.key).toMatch(/^rf_live_/);
    expect((await call<{ name: string; prefix: string }[]>('GET', '/integrations/api-keys', maya.token)).body[0]).toMatchObject({ name: 'Zapier', prefix: k.body.prefix });
    expect((await v1<{ account: { name: string } }>('GET', '/v1/me', k.body.key)).body.account.name).toBe('Acme Books');
    expect((await v1('GET', '/v1/me', 'rf_live_nope')).status).toBe(401);

    const t = await v1<Ticket>('POST', '/v1/tickets', k.body.key, { subject: 'From Zapier', email: 'Lee@Example.com', name: 'Lee', description: 'Row 12 in the sheet' });
    expect(t.status).toBe(201);
    expect(t.body).toMatchObject({ subject: 'From Zapier', source: 'api', requesterEmail: 'lee@example.com', createdByName: null });

    await call('DELETE', `/integrations/api-keys/${k.body.id}`, maya.token);
    expect((await v1('GET', '/v1/me', k.body.key)).status).toBe(401);
  });

  it('REST hooks: subscribe, get samples, unsubscribe (also when the receiver says 410 Gone)', async () => {
    const maya = await login('maya@replyfinch.dev');
    const { key } = (await call<{ key: string }>('POST', '/integrations/api-keys', maya.token, { name: 'Zapier' })).body;
    const sub = await v1<{ id: string }>('POST', '/v1/hooks', key, { url: `${receiver}/zap`, event: 'ticket.created' });
    expect(sub.status).toBe(201);
    const listed = (await call<Webhook[]>('GET', '/integrations/webhooks', maya.token)).body.find((w) => w.id === sub.body.id);
    expect(listed).toMatchObject({ source: 'api', events: ['ticket.created'] });

    await call('POST', '/tickets', maya.token, { subject: 'Zap me' });
    await received('/zap', 'ticket.created');
    const samples = await v1<WebhookEvent<TicketEventData>[]>('GET', '/v1/samples/ticket.created', key);
    expect(samples.body[0]!.data.ticket.subject).toBeTruthy();
    expect((await v1('GET', '/v1/samples/nope', key)).status).toBe(404);

    expect((await v1('DELETE', `/v1/hooks/${sub.body.id}`, key)).status).toBe(200);
    expect((await call<Webhook[]>('GET', '/integrations/webhooks', maya.token)).body.some((w) => w.id === sub.body.id)).toBe(false);

    // Zapier turned the Zap off: it answers 410, and we drop the subscription.
    const gone = (await v1<{ id: string }>('POST', '/v1/hooks', key, { url: `${receiver}/gone`, event: 'ticket.created' })).body;
    answers.set('/gone', [410]);
    await call('POST', '/tickets', maya.token, { subject: 'Anyone there?' });
    let still = true;
    for (let i = 0; i < 50 && still; i++) {
      await new Promise((r) => setTimeout(r, 100));
      still = (await call<Webhook[]>('GET', '/integrations/webhooks', maya.token)).body.some((w) => w.id === gone.id);
    }
    expect(still).toBe(false);
  });
});
