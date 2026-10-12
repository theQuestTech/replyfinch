import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import {
  apiKeyCreateSchema,
  apiTicketCreateSchema,
  hookSubscribeSchema,
  webhookCreateSchema,
  webhookUpdateSchema,
  type ChatEventData,
  type TicketEventData,
  type WebhookEvent,
  type WebhookEventType,
} from '@replyfinch/shared';
import type { Db } from '../db/client';
import { accounts, conversations, offlineMessages, tickets as ticketsTable, users } from '../db/schema';
import type { ApiKeyService } from '../services/api-keys';
import type { ConversationService } from '../services/conversations';
import type { OfflineService } from '../services/offline';
import type { TicketService } from '../services/tickets';
import { eventCustomer, UnsafeUrlError, type WebhookService } from '../services/webhooks';

const firstIssue = (e: { issues: { message: string }[] }) => e.issues[0]?.message ?? 'invalid_input';

/** Settings → Integrations (admins): webhooks and API keys. Registered behind agent auth. */
export async function integrationRoutes(r: FastifyInstance, d: { db: Db; webhooks: WebhookService; apiKeys: ApiKeyService }) {
  const requireAdmin = async (req: FastifyRequest, reply: FastifyReply) => {
    const [me] = await d.db.select({ role: users.role }).from(users).where(eq(users.id, req.agent.sub));
    if (me?.role !== 'admin') return reply.code(403).send({ error: 'admins_only' });
  };
  const unsafe = (reply: FastifyReply, err: unknown) => {
    if (err instanceof UnsafeUrlError) return reply.code(400).send({ error: err.message });
    throw err;
  };

  await r.register(async (a) => {
    a.addHook('preHandler', requireAdmin);

    a.get('/integrations/webhooks', async (req) => d.webhooks.list(req.agent.acc));

    a.post('/integrations/webhooks', async (req, reply) => {
      const b = webhookCreateSchema.safeParse(req.body);
      if (!b.success) return reply.code(400).send({ error: firstIssue(b.error) });
      try {
        return reply.code(201).send(await d.webhooks.create(req.agent.acc, { ...b.data, createdBy: req.agent.sub }));
      } catch (err) {
        return unsafe(reply, err);
      }
    });

    a.patch<{ Params: { id: string } }>('/integrations/webhooks/:id', async (req, reply) => {
      const b = webhookUpdateSchema.safeParse(req.body);
      if (!b.success) return reply.code(400).send({ error: firstIssue(b.error) });
      try {
        const w = await d.webhooks.update(req.agent.acc, req.params.id, b.data);
        return w ?? reply.code(404).send({ error: 'not_found' });
      } catch (err) {
        return unsafe(reply, err);
      }
    });

    a.delete<{ Params: { id: string } }>('/integrations/webhooks/:id', async (req, reply) =>
      (await d.webhooks.remove(req.agent.acc, req.params.id)) ? { ok: true } : reply.code(404).send({ error: 'not_found' }),
    );

    a.post<{ Params: { id: string } }>('/integrations/webhooks/:id/test', async (req, reply) => {
      const del = await d.webhooks.test(req.agent.acc, req.params.id);
      return del ?? reply.code(404).send({ error: 'not_found' });
    });

    a.get<{ Params: { id: string } }>('/integrations/webhooks/:id/deliveries', async (req) => d.webhooks.deliveries(req.agent.acc, req.params.id));

    a.post<{ Params: { id: string } }>('/integrations/deliveries/:id/retry', async (req, reply) => {
      const del = await d.webhooks.retry(req.agent.acc, req.params.id);
      if (!del) return reply.code(404).send({ error: 'not_found' });
      await d.webhooks.tick();
      return { ok: true };
    });

    a.get('/integrations/api-keys', async (req) => d.apiKeys.list(req.agent.acc));

    a.post('/integrations/api-keys', async (req, reply) => {
      const b = apiKeyCreateSchema.safeParse(req.body);
      if (!b.success) return reply.code(400).send({ error: firstIssue(b.error) });
      return reply.code(201).send(await d.apiKeys.create(req.agent.acc, b.data.name, req.agent.sub));
    });

    a.delete<{ Params: { id: string } }>('/integrations/api-keys/:id', async (req, reply) =>
      (await d.apiKeys.revoke(req.agent.acc, req.params.id)) ? { ok: true } : reply.code(404).send({ error: 'not_found' }),
    );
  });
}

declare module 'fastify' {
  interface FastifyRequest {
    apiKey: { accountId: string; keyId: string; name: string };
  }
}

/**
 * The public API, authenticated with an API key ("Authorization: Bearer rf_live_…").
 * What Zapier (or a customer's own code) uses: check the key, subscribe to events, sample data, create tickets.
 */
export async function publicApiRoutes(
  app: FastifyInstance,
  d: {
    db: Db;
    apiKeys: ApiKeyService;
    webhooks: WebhookService;
    tickets: TicketService;
    conversations: ConversationService;
    offline: OfflineService;
    limit: preHandlerHookHandler[];
    onTicket: (accountId: string, ticket: Awaited<ReturnType<TicketService['dto']>>) => void;
  },
) {
  await app.register(async (v1) => {
    v1.addHook('preHandler', async (req, reply) => {
      const key = req.headers.authorization?.replace(/^Bearer\s+/i, '') ?? (req.headers['x-api-key'] as string | undefined);
      const found = await d.apiKeys.verify(key);
      if (!found) return reply.code(401).send({ error: 'Invalid or revoked API key' });
      req.apiKey = found;
    });
    for (const h of d.limit) v1.addHook('preHandler', h);

    v1.get('/v1/me', async (req) => {
      const [a] = await d.db.select({ id: accounts.id, name: accounts.name }).from(accounts).where(eq(accounts.id, req.apiKey.accountId));
      return { account: a, key: { id: req.apiKey.keyId, name: req.apiKey.name } };
    });

    v1.post('/v1/hooks', async (req, reply) => {
      const b = hookSubscribeSchema.safeParse(req.body);
      if (!b.success) return reply.code(400).send({ error: firstIssue(b.error) });
      try {
        const w = await d.webhooks.create(req.apiKey.accountId, {
          url: b.data.url,
          events: [b.data.event],
          description: `Added through the API (${req.apiKey.name})`,
          source: 'api',
          apiKeyId: req.apiKey.keyId,
        });
        return reply.code(201).send({ id: w.id, event: b.data.event, url: w.url, secret: w.secret });
      } catch (err) {
        if (err instanceof UnsafeUrlError) return reply.code(400).send({ error: err.message });
        throw err;
      }
    });

    v1.delete<{ Params: { id: string } }>('/v1/hooks/:id', async (req, reply) =>
      (await d.webhooks.remove(req.apiKey.accountId, req.params.id, req.apiKey.keyId)) ? { ok: true } : reply.code(404).send({ error: 'not_found' }),
    );

    /** Recent real examples of an event's data (Zapier shows these while you build a Zap). */
    v1.get<{ Params: { event: string } }>('/v1/samples/:event', async (req, reply) => {
      const acc = req.apiKey.accountId;
      const type = req.params.event as WebhookEventType;
      const wrap = (id: string, at: Date, data: unknown): WebhookEvent => ({ id, type, createdAt: at.toISOString(), accountId: acc, data });
      if (type.startsWith('chat.')) {
        const rows = await d.db
          .select()
          .from(conversations)
          .where(and(eq(conversations.accountId, acc), type === 'chat.started' ? undefined : eq(conversations.status, 'ended')))
          .orderBy(desc(conversations.startedAt))
          .limit(3);
        return Promise.all(
          rows.map(async (c) => {
            const data: ChatEventData = { conversation: await d.conversations.dto(c), customer: (await eventCustomer(d.db, c.visitorId))! };
            if (type === 'chat.ended') data.messages = await d.conversations.listMessages(c.id, { includeInternal: false });
            return wrap(c.id, c.startedAt, data);
          }),
        );
      }
      if (type === 'offline_message.created') {
        const rows = await d.db.select().from(offlineMessages).where(eq(offlineMessages.accountId, acc)).orderBy(desc(offlineMessages.createdAt)).limit(3);
        return Promise.all(rows.map(async (m) => wrap(m.id, m.createdAt, { offlineMessage: await d.offline.dto(m) })));
      }
      if (type.startsWith('ticket.')) {
        const rows = await d.db.select().from(ticketsTable).where(eq(ticketsTable.accountId, acc)).orderBy(desc(ticketsTable.updatedAt)).limit(3);
        return Promise.all(
          rows.map(async (t) => {
            const data: TicketEventData = { ticket: await d.tickets.dto(t) };
            if (type === 'ticket.customer_replied') data.message = (await d.tickets.messages(acc, t.id)).filter((m) => m.kind === 'customer').pop();
            return wrap(t.id, t.updatedAt, data);
          }),
        );
      }
      return reply.code(404).send({ error: 'Unknown event' });
    });

    v1.post('/v1/tickets', async (req, reply) => {
      const b = apiTicketCreateSchema.safeParse(req.body);
      if (!b.success) return reply.code(400).send({ error: firstIssue(b.error) });
      const acc = req.apiKey.accountId;
      const customer = await d.tickets.findOrCreateCustomer(acc, b.data.name || null, b.data.email?.toLowerCase() || null);
      const row = await d.tickets.create(acc, {
        subject: b.data.subject,
        priority: b.data.priority,
        assigneeId: null,
        visitorId: customer?.id ?? null,
        requesterName: b.data.name || customer?.name || null,
        requesterEmail: b.data.email?.toLowerCase() || null,
        source: 'api',
        sourceId: null,
        createdBy: { id: null, name: req.apiKey.name },
        messages: b.data.description ? [{ kind: 'note', author: { id: null, name: req.apiKey.name }, body: b.data.description }] : [],
      });
      const ticket = await d.tickets.dto(row);
      d.onTicket(acc, ticket);
      return reply.code(201).send(ticket);
    });
  });
}
