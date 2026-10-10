import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import { Redis } from 'ioredis';
import { eq } from 'drizzle-orm';
import {
  historyQuerySchema,
  loginSchema,
  offlineStatusSchema,
  reportQuerySchema,
  visitorPatchSchema,
  widgetSessionSchema,
  type Agent,
  type WidgetConfig,
} from '@replyfinch/shared';
import { checkPassword, createAuth, type AgentClaims } from './auth';
import { createDb } from './db/client';
import { users } from './db/schema';
import type { Env } from './env';
import { createPresence, toLiveVisitor } from './presence';
import { createRealtime } from './realtime';
import { createConversationService } from './services/conversations';
import { createStatsService } from './services/stats';
import { createVisitorService } from './services/visitors';
import { createShortcutService } from './services/shortcuts';
import { createHistoryService } from './services/history';
import { createOfflineService } from './services/offline';
import { createWidgetSettingsService } from './services/widget-settings';
import { createReportService } from './services/reports';
import { settingsRoutes } from './routes/settings';

declare module 'fastify' {
  interface FastifyRequest {
    agent: AgentClaims;
  }
}

export async function buildApp(env: Env, opts: { leaveGraceMs?: number } = {}) {
  const app = Fastify({ logger: env.NODE_ENV === 'development' ? { level: 'info' } : env.NODE_ENV === 'production' });
  const { db, sql } = createDb(env.DATABASE_URL);
  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3 });
  const auth = createAuth(env.JWT_SECRET);
  const presence = createPresence(redis);
  const conversations = createConversationService(db);
  const visitors = createVisitorService(db);
  const stats = createStatsService(db, presence);
  const shortcuts = createShortcutService(db);
  const history = createHistoryService(db);
  const offline = createOfflineService(db);
  const widgetSettings = createWidgetSettingsService(db);
  const reports = createReportService(db);

  // Never send internal details (SQL, stack traces) to clients; log them instead.
  app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    const status = err.statusCode && err.statusCode < 600 ? err.statusCode : 500;
    if (status >= 500) req.log.error(err);
    reply.code(status).send({ error: status >= 500 ? 'internal_error' : err.message });
  });

  // The widget is embedded on customers' websites, so /widget/* accepts any origin
  // (it is authenticated by account id + visitor token). Everything else is limited
  // to the agent app's origins.
  await app.register(cors, {
    delegator: (req, cb) => {
      const origin = req.headers.origin;
      const isWidget = req.url?.startsWith('/widget/');
      cb(null, { origin: isWidget ? true : !origin || env.corsOrigins.includes(origin), methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] });
    },
  });

  const realtime = createRealtime({
    httpServer: app.server,
    redis,
    db,
    auth,
    presence,
    conversations,
    offline,
    visitors,
    stats,
    corsOrigins: env.corsOrigins,
    leaveGraceMs: opts.leaveGraceMs,
    isActiveAgent: (id: string) => isActiveAgent(id),
  });

  // Removed agents lose access immediately, even with an unexpired token.
  async function isActiveAgent(userId: string) {
    const [u] = await db.select({ active: users.active }).from(users).where(eq(users.id, userId));
    return !!u?.active;
  }

  async function requireAgent(req: FastifyRequest, reply: FastifyReply) {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    const claims = auth.verifyAgent(token);
    if (!claims || !(await isActiveAgent(claims.sub))) return reply.code(401).send({ error: 'unauthorized' });
    req.agent = claims;
  }

  // `version` is the deployed commit (Railway sets RAILWAY_GIT_COMMIT_SHA), to check a deploy went out.
  const version = process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? null;
  app.get('/health', async () => ({ ok: true, version }));

  // ---------------- auth ----------------
  app.post('/auth/login', async (req, reply) => {
    const body = loginSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' });
    const [u] = await db.select().from(users).where(eq(users.email, body.data.email.toLowerCase()));
    if (!u || !u.active || !(await checkPassword(body.data.password, u.passwordHash))) {
      return reply.code(401).send({ error: 'invalid_credentials' });
    }
    const agent: Agent = { id: u.id, accountId: u.accountId, name: u.name, email: u.email, role: u.role };
    return { token: auth.signAgent({ sub: u.id, acc: u.accountId, name: u.name }), agent };
  });

  // ---------------- agent API ----------------
  app.register(async (r) => {
    r.addHook('preHandler', requireAgent);
    await settingsRoutes(r, { db, realtime, shortcuts, widgetSettings });

    r.get('/me', async (req) => {
      const [u] = await db.select().from(users).where(eq(users.id, req.agent.sub));
      return { id: u!.id, accountId: u!.accountId, name: u!.name, email: u!.email, role: u!.role } satisfies Agent;
    });

    r.get('/visitors', async (req) => (await presence.listVisitors(req.agent.acc)).map((v) => toLiveVisitor(v)));

    r.patch<{ Params: { id: string } }>('/visitors/:id', async (req, reply) => {
      const body = visitorPatchSchema.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: 'invalid_input' });
      const row = await visitors.patch(req.agent.acc, req.params.id, body.data);
      if (!row) return reply.code(404).send({ error: 'not_found' });
      await realtime.visitorChanged(req.agent.acc, row.id, {
        name: row.name,
        email: row.email,
        phone: row.phone,
        notes: row.notes,
        tags: row.tags,
      });
      return row;
    });

    r.get<{ Params: { id: string } }>('/visitors/:id/conversations', async (req) =>
      conversations.listForVisitor(req.agent.acc, req.params.id),
    );

    r.get('/conversations', async (req) => conversations.listOpen(req.agent.acc));

    r.get<{ Params: { id: string } }>('/conversations/:id', async (req, reply) => {
      const conv = await conversations.get(req.agent.acc, req.params.id);
      if (!conv) return reply.code(404).send({ error: 'not_found' });
      return {
        conversation: await conversations.dto(conv),
        messages: await conversations.listMessages(conv.id, { includeInternal: true }),
      };
    });

    r.get('/history', async (req, reply) => {
      const q = historyQuerySchema.safeParse(req.query);
      if (!q.success) return reply.code(400).send({ error: 'invalid_input' });
      return history.list(req.agent.acc, q.data);
    });

    r.get<{ Querystring: { status?: string } }>('/offline-messages', async (req) => {
      const status = req.query.status === 'new' || req.query.status === 'handled' ? req.query.status : undefined;
      return offline.list(req.agent.acc, status);
    });

    r.get('/offline-messages/count', async (req) => ({ new: await offline.countNew(req.agent.acc) }));

    r.patch<{ Params: { id: string } }>('/offline-messages/:id', async (req, reply) => {
      const body = offlineStatusSchema.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: 'invalid_input' });
      const m = await offline.setStatus(req.agent.acc, req.params.id, body.data.status, req.agent.sub);
      if (!m) return reply.code(404).send({ error: 'not_found' });
      realtime.offlineChanged(req.agent.acc, m);
      return m;
    });

    r.get('/reports', async (req, reply) => {
      const q = reportQuerySchema.safeParse(req.query);
      if (!q.success) return reply.code(400).send({ error: 'invalid_input' });
      return reports.report(req.agent.acc, q.data.days, q.data.tz);
    });

    r.get('/stats/home', async (req) => stats.home(req.agent.acc, req.agent.sub));
    r.get('/team', async (req) => stats.team(req.agent.acc));
  });

  // ---------------- widget API ----------------
  app.post('/widget/session', async (req, reply) => {
    const body = widgetSessionSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' });
    const account = await visitors.accountExists(body.data.accountId);
    if (!account) return reply.code(404).send({ error: 'unknown_account' });
    const prior = auth.verifyVisitor(body.data.visitorToken);
    const country =
      (req.headers['cf-ipcountry'] as string | undefined) ??
      (req.headers['x-vercel-ip-country'] as string | undefined) ??
      null;
    const v = await visitors.identify({
      accountId: account.id,
      visitorId: prior && prior.acc === account.id ? prior.sub : null,
      userAgent: req.headers['user-agent'] ?? '',
      country: country && country !== 'XX' ? country.toUpperCase() : null,
      timezone: body.data.timezone ?? null,
      newSession: body.data.newSession,
    });
    const team = await stats.team(account.id);
    return {
      visitorToken: auth.signVisitor({ sub: v.id, acc: account.id }),
      visitorId: v.id,
      name: v.name,
      email: v.email,
      config: {
        ...(await widgetSettings.get(account.id)),
        accountName: account.name,
        agentsOnline: team.filter((t) => t.status === 'online').length,
      } satisfies WidgetConfig,
    };
  });

  app.addHook('onClose', async () => {
    await realtime.close();
    redis.disconnect();
    await sql.end();
  });

  return { app, realtime, db, redis };
}
