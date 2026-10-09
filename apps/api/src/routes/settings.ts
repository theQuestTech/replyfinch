import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, eq, ne } from 'drizzle-orm';
import {
  passwordChangeSchema,
  passwordResetSchema,
  profileUpdateSchema,
  shortcutSchema,
  teamCreateSchema,
  teamUpdateSchema,
  type Agent,
} from '@replyfinch/shared';
import { checkPassword, hashPassword } from '../auth';
import type { Db } from '../db/client';
import { users } from '../db/schema';
import { newId } from '../ids';
import type { Realtime } from '../realtime';
import type { ShortcutService } from '../services/shortcuts';

type Deps = { db: Db; realtime: Realtime; shortcuts: ShortcutService };

const firstIssue = (e: { issues: { message: string }[] }) => e.issues[0]?.message ?? 'invalid_input';

/** Profile, team management (admins) and shortcuts. Registered behind agent auth. */
export async function settingsRoutes(r: FastifyInstance, { db, realtime, shortcuts }: Deps) {
  const requireAdmin = async (req: FastifyRequest, reply: FastifyReply) => {
    const [me] = await db.select({ role: users.role }).from(users).where(eq(users.id, req.agent.sub));
    if (me?.role !== 'admin') return reply.code(403).send({ error: 'admins_only' });
  };

  const getMember = async (accountId: string, id: string) =>
    (await db.select().from(users).where(and(eq(users.id, id), eq(users.accountId, accountId), eq(users.active, true))))[0];

  const otherActiveAdmins = async (accountId: string, exceptId: string) =>
    (
      await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.accountId, accountId), eq(users.role, 'admin'), eq(users.active, true), ne(users.id, exceptId)))
    ).length;

  // ---------------- my profile ----------------
  r.patch('/me', async (req, reply) => {
    const body = profileUpdateSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: firstIssue(body.error) });
    const [u] = await db.update(users).set({ name: body.data.name }).where(eq(users.id, req.agent.sub)).returning();
    await realtime.teamChanged(req.agent.acc);
    return { id: u!.id, accountId: u!.accountId, name: u!.name, email: u!.email, role: u!.role } satisfies Agent;
  });

  r.post('/me/password', async (req, reply) => {
    const body = passwordChangeSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: firstIssue(body.error) });
    const [u] = await db.select().from(users).where(eq(users.id, req.agent.sub));
    if (!u || !(await checkPassword(body.data.currentPassword, u.passwordHash))) {
      return reply.code(400).send({ error: 'Your current password is incorrect' });
    }
    await db.update(users).set({ passwordHash: await hashPassword(body.data.newPassword) }).where(eq(users.id, u.id));
    return { ok: true };
  });

  // ---------------- team (admins) ----------------
  r.post('/team', { preHandler: requireAdmin }, async (req, reply) => {
    const body = teamCreateSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: firstIssue(body.error) });
    const [existing] = await db.select().from(users).where(eq(users.email, body.data.email));
    if (existing && (existing.active || existing.accountId !== req.agent.acc)) {
      return reply.code(409).send({ error: 'Someone with this email already has an account' });
    }
    const passwordHash = await hashPassword(body.data.password);
    const values = { name: body.data.name, role: body.data.role, maxChats: body.data.maxChats, passwordHash, active: true };
    // Re-adding a removed agent brings their old account back (keeps their chat history).
    const [u] = existing
      ? await db.update(users).set(values).where(eq(users.id, existing.id)).returning()
      : await db
          .insert(users)
          .values({ id: newId.user(), accountId: req.agent.acc, email: body.data.email, ...values })
          .returning();
    await realtime.teamChanged(req.agent.acc);
    return reply.code(201).send({ id: u!.id, name: u!.name, email: u!.email, role: u!.role, maxChats: u!.maxChats });
  });

  r.patch<{ Params: { id: string } }>('/team/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const body = teamUpdateSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: firstIssue(body.error) });
    const member = await getMember(req.agent.acc, req.params.id);
    if (!member) return reply.code(404).send({ error: 'not_found' });
    if (body.data.role === 'agent' && member.role === 'admin' && (await otherActiveAdmins(req.agent.acc, member.id)) === 0) {
      return reply.code(400).send({ error: 'Your team needs at least one admin' });
    }
    const [u] = await db.update(users).set(body.data).where(eq(users.id, member.id)).returning();
    await realtime.teamChanged(req.agent.acc);
    return { id: u!.id, name: u!.name, email: u!.email, role: u!.role, maxChats: u!.maxChats };
  });

  r.post<{ Params: { id: string } }>('/team/:id/password', { preHandler: requireAdmin }, async (req, reply) => {
    const body = passwordResetSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: firstIssue(body.error) });
    const member = await getMember(req.agent.acc, req.params.id);
    if (!member) return reply.code(404).send({ error: 'not_found' });
    await db.update(users).set({ passwordHash: await hashPassword(body.data.password) }).where(eq(users.id, member.id));
    return { ok: true };
  });

  r.delete<{ Params: { id: string } }>('/team/:id', { preHandler: requireAdmin }, async (req, reply) => {
    if (req.params.id === req.agent.sub) return reply.code(400).send({ error: 'You can’t remove yourself' });
    const member = await getMember(req.agent.acc, req.params.id);
    if (!member) return reply.code(404).send({ error: 'not_found' });
    if (member.role === 'admin' && (await otherActiveAdmins(req.agent.acc, member.id)) === 0) {
      return reply.code(400).send({ error: 'Your team needs at least one admin' });
    }
    await db.update(users).set({ active: false }).where(eq(users.id, member.id));
    await realtime.disconnectAgent(member.id);
    await realtime.teamChanged(req.agent.acc);
    return { ok: true };
  });

  // ---------------- shortcuts ----------------
  r.get('/shortcuts', async (req) => shortcuts.list(req.agent.acc));

  r.post('/shortcuts', async (req, reply) => {
    const body = shortcutSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: firstIssue(body.error) });
    const created = await shortcuts.create(req.agent.acc, req.agent.sub, body.data);
    if (!created) return reply.code(409).send({ error: `A shortcut named /${body.data.name} already exists` });
    return reply.code(201).send(created);
  });

  r.put<{ Params: { id: string } }>('/shortcuts/:id', async (req, reply) => {
    const body = shortcutSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: firstIssue(body.error) });
    const updated = await shortcuts.update(req.agent.acc, req.params.id, body.data);
    if (updated === undefined) return reply.code(404).send({ error: 'not_found' });
    if (updated === null) return reply.code(409).send({ error: `A shortcut named /${body.data.name} already exists` });
    return updated;
  });

  r.delete<{ Params: { id: string } }>('/shortcuts/:id', async (req, reply) => {
    if (!(await shortcuts.remove(req.agent.acc, req.params.id))) return reply.code(404).send({ error: 'not_found' });
    return { ok: true };
  });
}
