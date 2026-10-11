import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import type {
  AgentClientEvents,
  AgentServerEvents,
  Conversation,
  Message,
  WidgetConfig,
  VisitorClientEvents,
  VisitorServerEvents,
} from '@replyfinch/shared';
import { buildApp } from '../src/app';
import type Anthropic from '@anthropic-ai/sdk';
import type { AiClient } from '../src/services/ai';
import { createAiService } from '../src/services/ai';
import { createShortcutService } from '../src/services/shortcuts';
import { createDb } from '../src/db/client';
import { env } from '../src/env';
import { runMigrations } from '../src/db/migrate';
import { DEMO_ACCOUNT_ID, DEMO_PASSWORD, seed } from '../src/db/seed';

type AgentSock = Socket<AgentServerEvents, AgentClientEvents>;
type VisitorSock = Socket<VisitorServerEvents, VisitorClientEvents>;

let base = '';
// A stand-in for Claude: records requests, answers with whatever the test sets.
const requests: Anthropic.MessageCreateParamsNonStreaming[] = [];
let answer: Partial<Anthropic.Message> | Error = {};
const aiClient: AiClient = {
  messages: {
    async create(body) {
      requests.push(body);
      if (answer instanceof Error) throw answer;
      return {
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        model: body.model,
        content: [{ type: 'text', text: 'Yes — we ship to Norway in 3–5 days.', citations: null }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 2000, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        ...answer,
      } as Anthropic.Message;
    },
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
  const built = await buildApp(env, { leaveGraceMs: 200, aiClient });
  await built.app.listen({ port: 0, host: '127.0.0.1' });
  const addr = built.app.server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  close = () => built.app.close();
});
afterAll(async () => {
  for (const s of sockets) s.disconnect();
  await close?.();
});


async function chatWith(text: string) {
  const v = await visitor();
  const { conversation } = await emitAck<{ conversation: Conversation }>(v.socket, 'chat:start', { name: 'Nora Lind', message: text, clientId: `c${Math.random()}` });
  return conversation;
}

describe('AI suggest — free mode (no API key)', () => {
  it('offers the best-matching saved reply, with the customer name filled in', async () => {
    const { db } = createDb(env.DATABASE_URL);
    const free = createAiService({ db, shortcuts: createShortcutService(db), model: 'claude-haiku-5-5', client: null });
    const msg = (body: string) => ({ id: 'm', conversationId: 'c', authorType: 'visitor' as const, authorId: null, authorName: 'Nora', body, internal: false, clientId: null, createdAt: 0 });
    const s = await free.suggest(DEMO_ACCOUNT_ID, { messages: [msg('When will my order be delivered? Do you have tracking?')], visitorName: 'Nora Lind', agentName: 'Maya Chen' });
    expect(s).toMatchObject({ engine: 'shortcuts', shortcutName: 'shipping' });
    expect(s.text).toContain('Orders usually ship');
    const refund = await free.suggest(DEMO_ACCOUNT_ID, { messages: [msg('I was charged twice, I want my money back')], visitorName: 'Nora', agentName: 'Maya' });
    expect(refund.shortcutName).toBe('refund');
    const none = await free.suggest(DEMO_ACCOUNT_ID, { messages: [msg('hmm ok')], visitorName: 'Nora', agentName: 'Maya' });
    expect(none).toEqual({ text: null, engine: 'shortcuts', note: 'no_match' });
    expect((await free.status(DEMO_ACCOUNT_ID)).engine).toBe('shortcuts');
  });
});

describe('AI suggest — Claude mode', () => {
  it('drafts a reply from the conversation and business info, never sends internal notes, and meters spend', async () => {
    const maya = await login('maya@replyfinch.dev');
    const m = await connected(maya.token);
    await call('PUT', '/settings/ai', maya.token, { knowledge: 'We ship to all of Europe. Norway: 3–5 days. Tone: friendly.', monthlyCapUsd: 10 });
    const conv = await chatWith('Do you ship to Norway?');
    await emitAck(m, 'message:send', { conversationId: conv.id, body: 'secret internal note', clientId: 'n1', internal: true });

    const res = await call<{ text: string; engine: string }>('POST', `/conversations/${conv.id}/suggest`, maya.token);
    expect(res.body).toEqual({ text: 'Yes — we ship to Norway in 3–5 days.', engine: 'claude' });
    const req = requests.at(-1)!;
    expect(req.model).toBe('claude-haiku-5-5');
    const system = JSON.stringify(req.system);
    expect(system).toContain('Norway: 3–5 days');
    expect(system).toContain('Acme Books');
    const prompt = JSON.stringify(req.messages);
    expect(prompt).toContain('Customer (Nora Lind): Do you ship to Norway?');
    expect(prompt).not.toContain('secret internal note');

    const st = (await call<{ status: { engine: string; suggestions: number; spentUsd: number } }>('GET', '/settings/ai', maya.token)).body.status;
    expect(st).toMatchObject({ engine: 'claude', suggestions: 1 });
    expect(st.spentUsd).toBeCloseTo(2000 * 0.1e-6 + 200 * 0.5e-6, 6); // $0.0003
    m.disconnect();
  });

  it('stops at the monthly cap, and falls back to saved replies when the AI is unavailable or declines', async () => {
    const maya = await login('maya@replyfinch.dev');
    const conv = await chatWith('Where is my order tracking?');
    const before = requests.length;

    answer = new Error('credit balance too low');
    const down = (await call<{ engine: string; note: string; shortcutName: string }>('POST', `/conversations/${conv.id}/suggest`, maya.token)).body;
    expect(down).toMatchObject({ engine: 'shortcuts', note: 'ai_unavailable', shortcutName: 'shipping' });

    answer = { stop_reason: 'refusal', content: [] };
    const declined = (await call<{ note: string }>('POST', `/conversations/${conv.id}/suggest`, maya.token)).body;
    expect(declined.note).toBe('ai_declined');

    answer = {};
    await call('PUT', '/settings/ai', maya.token, { knowledge: '', monthlyCapUsd: 1 });
    answer = { usage: { input_tokens: 20_000_000, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } as Anthropic.Usage }; // $2
    await call('POST', `/conversations/${conv.id}/suggest`, maya.token);
    answer = {};
    const calls = requests.length;
    const capped = (await call<{ note: string; engine: string }>('POST', `/conversations/${conv.id}/suggest`, maya.token)).body;
    expect(capped).toMatchObject({ engine: 'shortcuts', note: 'budget_reached' });
    expect(requests.length).toBe(calls); // no AI call once over the cap
    expect(requests.length).toBeGreaterThan(before);
  });

  it('only admins change AI settings', async () => {
    const daniel = await login('daniel@replyfinch.dev');
    expect((await call('PUT', '/settings/ai', daniel.token, { knowledge: 'x', monthlyCapUsd: 5 })).status).toBe(403);
    const maya = await login('maya@replyfinch.dev');
    expect((await call('PUT', '/settings/ai', maya.token, { knowledge: 'x', monthlyCapUsd: 5000 })).status).toBe(400);
  });
});
