import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import type {
  AgentClientEvents,
  AgentServerEvents,
  Conversation,
  OfflineMessage,
  HelpArticle,
  HelpCategory,
  PublicHelpArticle,
  PublicHelpArticleSummary,
  PublicHelpCenter,
  WidgetConfig,
  VisitorClientEvents,
  VisitorServerEvents,
} from '@replyfinch/shared';
import { buildApp } from '../src/app';
import { renderMarkdown } from '@replyfinch/shared/markdown';
import { slugify } from '../src/services/help';
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



describe('help center', () => {
  it('writes, organizes and publishes articles', async () => {
    const maya = await login('maya@replyfinch.dev');
    const cat = await call<HelpCategory>('POST', '/help/categories', maya.token, { name: 'Shipping' });
    expect(cat.status).toBe(201);
    const a = await call<HelpArticle>('POST', '/help/articles', maya.token, {
      title: 'How long does delivery take?',
      body: 'Most orders arrive in **3–5 days**.\n\n- Europe: 3–5 days\n- Elsewhere: 7–10 days',
      categoryId: cat.body.id,
    });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ slug: 'how-long-does-delivery-take', status: 'draft', publishedAt: null, updatedByName: 'Maya Chen' });

    // Drafts aren't public; the address follows the title until it's published.
    expect((await call('GET', `/widget/help/${DEMO_ACCOUNT_ID}/articles/how-long-does-delivery-take`)).status).toBe(404);
    const renamed = await call<HelpArticle>('PATCH', `/help/articles/${a.body.id}`, maya.token, { title: 'Delivery times' });
    expect(renamed.body).toMatchObject({ slug: 'delivery-times', body: a.body.body, categoryId: cat.body.id });
    const pub = await call<HelpArticle>('PATCH', `/help/articles/${a.body.id}`, maya.token, { status: 'published' });
    expect(pub.body.publishedAt).toBeTypeOf('number');
    const renamedAgain = await call<HelpArticle>('PATCH', `/help/articles/${a.body.id}`, maya.token, { title: 'Delivery times and costs' });
    expect(renamedAgain.body.slug).toBe('delivery-times'); // shared links keep working

    // Same title → a different address.
    const dup = await call<HelpArticle>('POST', '/help/articles', maya.token, { title: 'Delivery times', status: 'published' });
    expect(dup.body.slug).toBe('delivery-times-2');

    const cats = await call<HelpCategory[]>('GET', '/help/categories', maya.token);
    expect(cats.body.find((c) => c.id === cat.body.id)?.articles).toBe(1);
    expect((await call('POST', '/help/articles', maya.token, { title: 'x', categoryId: 'hc_nope' })).status).toBe(400);
    expect((await call('POST', '/help/articles', maya.token, { title: '' })).status).toBe(400);
    expect((await call('GET', '/help/articles')).status).toBe(401);

    // The widget learns there are articles.
    const session = await call<{ config: WidgetConfig }>('POST', '/widget/session', undefined, { accountId: DEMO_ACCOUNT_ID, newSession: true });
    expect(session.body.config.helpArticles).toBe(2);

    // Deleting a category keeps its articles.
    await call('DELETE', `/help/categories/${cat.body.id}`, maya.token);
    expect((await call<HelpArticle>('GET', `/help/articles/${a.body.id}`, maya.token)).body.categoryId).toBeNull();
    await call('DELETE', `/help/articles/${dup.body.id}`, maya.token);
    expect((await call('GET', `/help/articles/${dup.body.id}`, maya.token)).status).toBe(404);
  });

  it('serves published articles publicly, with search, views and feedback', async () => {
    const maya = await login('maya@replyfinch.dev');
    const cat = await call<HelpCategory>('POST', '/help/categories', maya.token, { name: 'Returns' });
    const make = (title: string, body: string, status = 'published') =>
      call<HelpArticle>('POST', '/help/articles', maya.token, { title, body, status, categoryId: cat.body.id });
    const ret = (await make('Returning a book', 'Send it back within 30 days for a full refund. See [our policy](https://acme.test/returns).')).body;
    await make('Damaged items', 'If a book arrives damaged, email us a photo and we send a new one.');
    await make('Secret draft', 'refund draft', 'draft');

    const center = await call<PublicHelpCenter>('GET', `/widget/help/${DEMO_ACCOUNT_ID}`);
    expect(center.body.accountName).toBe('Acme Books');
    const returns = center.body.categories.find((c) => c.name === 'Returns')!;
    expect(returns.articles.map((x) => x.title)).toEqual(['Damaged items', 'Returning a book']);
    expect(returns.articles[1]!.excerpt).toBe('Send it back within 30 days for a full refund. See our policy.');

    const search = async (q: string) =>
      (await call<PublicHelpArticleSummary[]>('GET', `/widget/help/${DEMO_ACCOUNT_ID}/search?q=${encodeURIComponent(q)}`)).body.map((x) => x.title);
    expect(await search('refund')).toEqual(['Returning a book']); // not the draft
    expect(await search('book damaged')).toEqual(['Damaged items']); // every word, anywhere
    expect(await search('BOOK')).toEqual(expect.arrayContaining(['Returning a book', 'Damaged items']));
    expect(await search('zzzz')).toEqual([]);

    const art = await call<PublicHelpArticle>('GET', `/widget/help/${DEMO_ACCOUNT_ID}/articles/${ret.slug}`);
    expect(art.body).toMatchObject({ title: 'Returning a book', categoryName: 'Returns' });
    expect(art.body.related.map((x) => x.title)).toEqual(['Damaged items']);
    await call('GET', `/widget/help/${DEMO_ACCOUNT_ID}/articles/${ret.slug}`); // same reader again: one view
    expect((await call<{ ok: boolean }>('POST', `/widget/help/${DEMO_ACCOUNT_ID}/articles/${ret.slug}/feedback`, undefined, { helpful: true })).body.ok).toBe(true);
    await call('POST', `/widget/help/${DEMO_ACCOUNT_ID}/articles/${ret.slug}/feedback`, undefined, { helpful: false });
    expect((await call<HelpArticle>('GET', `/help/articles/${ret.id}`, maya.token)).body).toMatchObject({ views: 1, helpful: 1, notHelpful: 1 });
    // The most-read come first when nothing is typed.
    expect((await search(''))[0]).toBe('Returning a book');

    expect((await call('GET', `/widget/help/acc_nope`)).status).toBe(404);
    expect((await call('GET', `/widget/help/${DEMO_ACCOUNT_ID}/articles/nope`)).status).toBe(404);
  });
});

describe('markdown', () => {
  it('renders the supported subset and escapes everything else', () => {
    const html = renderMarkdown(
      '# Title\nSome **bold**, *italic* and `code`.\nNext line\n\n- one\n- two\n\n1. first\n2. second\n\n> quoted\n\n[link](https://a.test/x?y=1&z=2) ![pic](https://a.test/p.png)\n\n---',
    );
    expect(html).toBe(
      [
        '<h2>Title</h2>',
        '<p>Some <strong>bold</strong>, <em>italic</em> and <code>code</code>.<br>Next line</p>',
        '<ul><li>one</li><li>two</li></ul>',
        '<ol><li>first</li><li>second</li></ol>',
        '<blockquote>quoted</blockquote>',
        '<p><a href="https://a.test/x?y=1&amp;z=2" target="_blank" rel="noopener noreferrer">link</a> <img src="https://a.test/p.png" alt="pic" loading="lazy"></p>',
        '<hr>',
      ].join('\n'),
    );
    expect(renderMarkdown('<script>alert(1)</script> [x](javascript:alert(1)) <img src=x onerror=alert(1)>')).toBe(
      '<p>&lt;script&gt;alert(1)&lt;/script&gt; [x](javascript:alert(1)) &lt;img src=x onerror=alert(1)&gt;</p>',
    );
    expect(renderMarkdown('[x](https://a.test/"onmouseover="alert(1))')).not.toContain('"onmouseover');
    expect(renderMarkdown('snake_case_name and 2*3*4')).toBe('<p>snake_case_name and 2*3*4</p>');
    expect(slugify('Où est ma commande ?')).toBe('ou-est-ma-commande');
    expect(slugify('!!!')).toBe('article');
  });
});
