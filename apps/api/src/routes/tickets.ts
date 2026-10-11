import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { eq } from 'drizzle-orm';
import { ticketCreateSchema, ticketMessageSchema, ticketsQuerySchema, ticketUpdateSchema, type TicketMessage } from '@replyfinch/shared';
import type { Db } from '../db/client';
import { visitors as visitorsTable } from '../db/schema';
import { EmailError } from '../email';
import type { Realtime } from '../realtime';
import type { ConversationService } from '../services/conversations';
import type { MailActions } from '../services/mail-actions';
import type { OfflineService } from '../services/offline';
import { offlineThread, type TicketService } from '../services/tickets';
import type { VisitorService } from '../services/visitors';

type Deps = {
  db: Db;
  tickets: TicketService;
  conversations: ConversationService;
  offline: OfflineService;
  visitors: VisitorService;
  mail: MailActions;
  realtime: Realtime;
  /** Rate limit for emailed replies (per agent). */
  replyLimit: preHandlerHookHandler[];
};

const firstIssue = (e: { issues: { message: string }[] }) => e.issues[0]?.message ?? 'invalid_input';

/** Helpdesk tickets. Registered behind agent auth. */
export async function ticketRoutes(r: FastifyInstance, d: Deps) {
  const by = (req: { agent: { sub: string; name: string } }) => ({ id: req.agent.sub, name: req.agent.name });

  r.get('/tickets', async (req, reply) => {
    const q = ticketsQuerySchema.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'invalid_input' });
    return d.tickets.list(req.agent.acc, req.agent.sub, q.data);
  });

  r.get('/tickets/counts', async (req) => d.tickets.counts(req.agent.acc, req.agent.sub));

  r.post('/tickets', async (req, reply) => {
    const parsed = ticketCreateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: firstIssue(parsed.error) });
    const b = parsed.data;
    const acc = req.agent.acc;
    const me = by(req);
    if (b.assigneeId && !(await d.tickets.isAgent(acc, b.assigneeId))) return reply.code(400).send({ error: 'That teammate can’t be assigned' });

    let visitorId: string | null = null;
    let name = b.name || null;
    let email = b.email || null;
    let source: 'manual' | 'chat' | 'offline' = 'manual';
    let sourceId: string | null = null;
    const messages: Parameters<TicketService['create']>[1]['messages'] = [];
    let offlineId: string | null = null;

    if (b.from?.type === 'chat') {
      const conv = await d.conversations.get(acc, b.from.id);
      if (!conv) return reply.code(404).send({ error: 'not_found' });
      const v = await d.visitors.get(acc, conv.visitorId);
      visitorId = conv.visitorId;
      name ??= v?.name ?? null;
      email ??= v?.email ?? null;
      // An email typed in for a customer we had none for: remember it on their profile too.
      if (email && v && !v.email) await d.db.update(visitorsTable).set({ email }).where(eq(visitorsTable.id, v.id));
      source = 'chat';
      sourceId = conv.id;
    } else if (b.from?.type === 'offline') {
      const m = await d.offline.get(acc, b.from.id);
      if (!m) return reply.code(404).send({ error: 'not_found' });
      visitorId = m.visitorId;
      name ??= m.name;
      email ??= m.email;
      source = 'offline';
      sourceId = m.id;
      offlineId = m.id;
      messages.push(...(await offlineThread(d.offline, m)));
    } else if (b.visitorId) {
      const v = await d.visitors.get(acc, b.visitorId);
      if (!v) return reply.code(404).send({ error: 'not_found' });
      visitorId = v.id;
      name ??= v.name;
      email ??= v.email;
    } else {
      const v = await d.tickets.findOrCreateCustomer(acc, name, email);
      visitorId = v?.id ?? null;
      name ??= v?.name ?? null;
    }
    if (b.description) messages.push({ kind: 'note', author: me, body: b.description });

    const row = await d.tickets.create(acc, {
      subject: b.subject,
      priority: b.priority,
      assigneeId: b.assigneeId ?? null,
      visitorId,
      requesterName: name,
      requesterEmail: email,
      source,
      sourceId,
      createdBy: me,
      messages,
    });

    if (source === 'chat' && sourceId) {
      const conv = await d.conversations.get(acc, sourceId);
      if (conv) d.realtime.announce(acc, await d.conversations.note(conv, me, `Ticket #${row.number} created by ${me.name}`));
    }
    if (offlineId) {
      const m = await d.offline.setStatus(acc, offlineId, 'handled', me.id);
      if (m) d.realtime.offlineChanged(acc, m);
    }
    const ticket = await d.tickets.dto(row);
    d.realtime.ticketChanged(acc, ticket, me);
    return reply.code(201).send(ticket);
  });

  r.get<{ Params: { id: string } }>('/tickets/:id', async (req, reply) => {
    const row = await d.tickets.get(req.agent.acc, req.params.id);
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return { ticket: await d.tickets.dto(row), messages: await d.tickets.messages(req.agent.acc, row.id) };
  });

  r.patch<{ Params: { id: string } }>('/tickets/:id', async (req, reply) => {
    const parsed = ticketUpdateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: firstIssue(parsed.error) });
    const acc = req.agent.acc;
    const row = await d.tickets.get(acc, req.params.id);
    if (!row) return reply.code(404).send({ error: 'not_found' });
    const { assigneeId } = parsed.data;
    if (assigneeId && !(await d.tickets.isAgent(acc, assigneeId))) return reply.code(400).send({ error: 'That teammate can’t be assigned' });
    const res = await d.tickets.update(acc, row, parsed.data, by(req));
    if (!res) return { ticket: await d.tickets.dto(row), events: [] };
    const ticket = await d.tickets.dto(res.row);
    d.realtime.ticketChanged(acc, ticket, assigneeId !== undefined ? by(req) : undefined);
    return { ticket, events: res.events };
  });

  // A reply (emailed to the customer) or an agents-only note, optionally changing the status too.
  r.post<{ Params: { id: string } }>('/tickets/:id/messages', { preHandler: d.replyLimit }, async (req, reply) => {
    const parsed = ticketMessageSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: firstIssue(parsed.error) });
    const b = parsed.data;
    const acc = req.agent.acc;
    const me = by(req);
    const row = await d.tickets.get(acc, req.params.id);
    if (!row) return reply.code(404).send({ error: 'not_found' });

    let emailedTo: string | null = null;
    if (!b.internal) {
      if (!row.requesterEmail) return reply.code(400).send({ error: 'This ticket has no customer email address — add one, or write an internal note' });
      const lastCustomer = (await d.tickets.messages(acc, row.id)).filter((m) => m.kind === 'customer').pop();
      try {
        emailedTo = await d.mail.replyToTicket(acc, row, me.name, b.body, lastCustomer ? { body: lastCustomer.body, createdAt: lastCustomer.createdAt } : null);
      } catch (err) {
        if (err instanceof EmailError) return reply.code(502).send({ error: err.message });
        throw err;
      }
    }
    const message = await d.tickets.addMessage(acc, row.id, { kind: b.internal ? 'note' : 'reply', author: me, body: b.body, emailedTo });

    // Answering an unassigned ticket takes it.
    const patch = { ...(b.status ? { status: b.status } : {}), ...(!b.internal && !row.assigneeId ? { assigneeId: me.id } : {}) };
    let events: TicketMessage[] = [];
    const fresh = (await d.tickets.get(acc, row.id))!;
    const res = Object.keys(patch).length ? await d.tickets.update(acc, fresh, patch, me) : null;
    if (res) events = res.events;
    const ticket = await d.tickets.dto(res?.row ?? fresh);
    d.realtime.ticketChanged(acc, ticket);
    return { message, events, ticket };
  });
}
