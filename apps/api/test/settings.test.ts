import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as connect } from 'socket.io-client';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { buildApp } from '../src/app';
import { env } from '../src/env';
import { runMigrations } from '../src/db/migrate';
import { DEMO_PASSWORD, seed } from '../src/db/seed';

let base = '';
let close: () => Promise<void>;

async function call<T = unknown>(method: string, path: string, token?: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: (await res.json()) as T };
}
const login = async (email: string, password = DEMO_PASSWORD) =>
  (await call<{ token: string; error?: string }>('POST', '/auth/login', undefined, { email, password }));

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
afterAll(async () => close?.());

describe('my profile', () => {
  it('changes my name and password', async () => {
    const { body } = await login('daniel@replyfinch.dev');
    const t = body.token;
    expect((await call<{ name: string }>('PATCH', '/me', t, { name: 'Dan Brooks' })).body.name).toBe('Dan Brooks');
    expect((await call('POST', '/me/password', t, { currentPassword: 'wrong', newPassword: 'a-new-password-1' })).status).toBe(400);
    expect((await call('POST', '/me/password', t, { currentPassword: DEMO_PASSWORD, newPassword: 'short' })).status).toBe(400);
    expect((await call('POST', '/me/password', t, { currentPassword: DEMO_PASSWORD, newPassword: 'a-new-password-1' })).status).toBe(200);
    expect((await login('daniel@replyfinch.dev')).status).toBe(401);
    expect((await login('daniel@replyfinch.dev', 'a-new-password-1')).status).toBe(200);
  });
});

describe('team', () => {
  it('lets admins add, edit, reset and remove agents — and only admins', async () => {
    const admin = (await login('maya@replyfinch.dev')).body.token;
    const agent = (await login('daniel@replyfinch.dev', 'a-new-password-1')).body.token;
    const newAgent = { name: 'Aisha Rahman', email: 'Aisha@Example.com', role: 'agent', maxChats: 3, password: 'temp-pass-123' };

    expect((await call('POST', '/team', agent, newAgent)).status).toBe(403);
    const created = await call<{ id: string; email: string }>('POST', '/team', admin, newAgent);
    expect(created.status).toBe(201);
    expect(created.body.email).toBe('aisha@example.com');
    expect((await call('POST', '/team', admin, newAgent)).status).toBe(409);
    expect((await login('aisha@example.com', 'temp-pass-123')).status).toBe(200);

    const team = await call<{ email: string; maxChats: number }[]>('GET', '/team', admin);
    expect(team.body.find((m) => m.email === 'aisha@example.com')?.maxChats).toBe(3);

    expect((await call('PATCH', `/team/${created.body.id}`, admin, { maxChats: 6, role: 'admin' })).status).toBe(200);
    expect((await call('POST', `/team/${created.body.id}/password`, admin, { password: 'reset-pass-456' })).status).toBe(200);
    const aisha = (await login('aisha@example.com', 'reset-pass-456')).body.token;
    expect(aisha).toBeTruthy();

    // Removing an agent locks them out immediately — REST and realtime.
    const sock = connect(`${base}/agent`, { auth: { token: aisha }, transports: ['websocket'] });
    await new Promise<void>((r) => sock.on('connect', () => r()));
    const kicked = new Promise((r) => sock.on('disconnect', r));
    expect((await call('DELETE', `/team/${created.body.id}`, admin)).status).toBe(200);
    await kicked;
    expect((await call('GET', '/me', aisha)).status).toBe(401);
    expect((await login('aisha@example.com', 'reset-pass-456')).status).toBe(401);
    sock.disconnect();
  });

  it('protects the last admin and yourself', async () => {
    const admin = (await login('maya@replyfinch.dev')).body.token;
    const me = (await call<{ id: string }>('GET', '/me', admin)).body;
    expect((await call('DELETE', `/team/${me.id}`, admin)).status).toBe(400);
    const res = await call<{ error: string }>('PATCH', `/team/${me.id}`, admin, { role: 'agent' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least one admin/);
  });
});

describe('shortcuts', () => {
  it('starts with defaults and supports create, edit, delete', async () => {
    const t = (await login('maya@replyfinch.dev')).body.token;
    const list = await call<{ name: string }[]>('GET', '/shortcuts', t);
    expect(list.body.map((s) => s.name)).toContain('refund');

    const created = await call<{ id: string; name: string }>('POST', '/shortcuts', t, {
      name: '/Order Status',
      message: 'Hi {{visitor.name}}, your order is on its way!',
      tags: ['Tracking'],
    });
    expect(created.status).toBe(201);
    expect(created.body.name).toBe('order-status');
    expect((await call('POST', '/shortcuts', t, { name: 'order-status', message: 'dup' })).status).toBe(409);
    expect((await call('POST', '/shortcuts', t, { name: 'bad name!', message: 'x' })).status).toBe(400);

    const edited = await call<{ message: string }>('PUT', `/shortcuts/${created.body.id}`, t, {
      name: 'order-status',
      message: 'Updated text',
      tags: [],
    });
    expect(edited.body.message).toBe('Updated text');
    expect((await call('PUT', `/shortcuts/${created.body.id}`, t, { name: 'refund', message: 'x' })).status).toBe(409);
    expect((await call('DELETE', `/shortcuts/${created.body.id}`, t)).status).toBe(200);
    expect((await call('DELETE', `/shortcuts/${created.body.id}`, t)).status).toBe(404);
  });
});

describe('CORS', () => {
  it('lets the agent app use every method the settings pages need', async () => {
    for (const method of ['PUT', 'DELETE', 'PATCH']) {
      const res = await fetch(`${base}/shortcuts/x`, {
        method: 'OPTIONS',
        headers: { origin: 'http://localhost:5173', 'access-control-request-method': method },
      });
      expect(res.headers.get('access-control-allow-methods')).toContain(method);
    }
  });
});
