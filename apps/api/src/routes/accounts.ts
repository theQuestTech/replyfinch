import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { eq } from 'drizzle-orm';
import { forgotPasswordSchema, platformAccountSchema, resetPasswordSchema, type Agent, type PasswordLinkInfo, type PlatformAccountCreated } from '@replyfinch/shared';
import type { Auth } from '../auth';
import type { Db } from '../db/client';
import { users } from '../db/schema';
import { EmailError, passwordResetEmail, welcomeEmail, type Mailer } from '../email';
import type { Env } from '../env';
import { EmailTakenError, type AccountService } from '../services/accounts';
import type { ConversationService } from '../services/conversations';
import type { TicketService } from '../services/tickets';

type Deps = {
  db: Db;
  env: Env;
  auth: Auth;
  accounts: AccountService;
  mailer: Mailer;
  limit: (name: string, max: number, windowSec: number, key?: (req: FastifyRequest) => string) => preHandlerHookHandler[];
};

/** Links in emails point at the agent app the request came from (if it's one of ours), else APP_URL. */
export function appUrl(env: Env, req: FastifyRequest) {
  const origin = req.headers.origin;
  if (origin && env.corsOrigins.includes(origin)) return origin;
  return (env.APP_URL || env.corsOrigins[0] || 'http://localhost:5173').replace(/\/$/, '');
}

/** Forgot password and one-time password links. No sign-in needed. */
export async function passwordRoutes(app: FastifyInstance, d: Deps) {
  // Same answer whether or not the email has an account, so nobody can probe for accounts.
  const emailKey = (req: FastifyRequest) => `${req.ip}:${String((req.body as { email?: unknown })?.email ?? '').toLowerCase()}`;
  app.post('/auth/forgot', { preHandler: [...d.limit('forgot-ip', 20, 900), ...d.limit('forgot', 3, 900, emailKey)] }, async (req, reply) => {
    const b = forgotPasswordSchema.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'Please check your email address' });
    const user = await d.accounts.findActiveUser(b.data.email);
    if (user && d.mailer.enabled) {
      const token = await d.accounts.issueToken(user.id, 'reset');
      const link = `${appUrl(d.env, req)}/reset-password?token=${token}`;
      await d.mailer.send({ ...passwordResetEmail({ name: user.name, link }), to: user.email }).catch((err) => req.log.error(err, 'reset email failed'));
    }
    return { ok: true, emailEnabled: d.mailer.enabled };
  });

  app.get<{ Params: { token: string } }>('/auth/reset/:token', { preHandler: d.limit('reset-check', 30, 300) }, async (req, reply) => {
    const t = await d.accounts.checkToken(req.params.token);
    if (!t) return reply.code(404).send({ error: 'This link has expired or was already used' });
    return { purpose: t.purpose, name: t.name, email: t.email, accountName: t.accountName } satisfies PasswordLinkInfo;
  });

  app.post('/auth/reset', { preHandler: d.limit('reset', 10, 300) }, async (req, reply) => {
    const b = resetPasswordSchema.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: b.error.issues[0]?.message ?? 'invalid_input' });
    const u = await d.accounts.useToken(b.data.token, b.data.password);
    if (!u) return reply.code(400).send({ error: 'This link has expired or was already used' });
    // Signed in straight away.
    const agent: Agent = { id: u.id, accountId: u.accountId, name: u.name, email: u.email, role: u.role, platformAdmin: d.env.platformAdmins.includes(u.email) };
    return { token: d.auth.signAgent({ sub: u.id, acc: u.accountId, name: u.name }), agent };
  });
}

/** The Accounts page: platform admins create customer workspaces. Registered behind agent auth. */
export async function platformRoutes(
  r: FastifyInstance,
  d: Deps & { tickets: TicketService; conversations: ConversationService; onTicketNote: (acc: string, ticketId: string) => void },
) {
  const requirePlatformAdmin = async (req: FastifyRequest, reply: FastifyReply) => {
    const [me] = await d.db.select({ email: users.email }).from(users).where(eq(users.id, req.agent.sub));
    if (!me || !d.env.platformAdmins.includes(me.email)) return reply.code(403).send({ error: 'platform_admins_only' });
  };

  const sendWelcome = async (req: FastifyRequest, admin: { id: string; name: string; email: string }, accountName: string) => {
    const token = await d.accounts.issueToken(admin.id, 'welcome');
    const setPasswordUrl = `${appUrl(d.env, req)}/reset-password?token=${token}`;
    let emailed = false;
    if (d.mailer.enabled) {
      try {
        await d.mailer.send({ ...welcomeEmail({ name: admin.name, accountName, link: setPasswordUrl }), to: admin.email });
        emailed = true;
      } catch (err) {
        if (!(err instanceof EmailError)) throw err;
        req.log.warn(err, 'welcome email failed');
      }
    }
    return { setPasswordUrl, emailed };
  };

  await r.register(async (p) => {
    p.addHook('preHandler', requirePlatformAdmin);

    p.get('/platform/accounts', async () => d.accounts.list());

    p.post('/platform/accounts', async (req, reply) => {
      const b = platformAccountSchema.safeParse(req.body);
      if (!b.success) return reply.code(400).send({ error: b.error.issues[0]?.message ?? 'invalid_input' });
      let created;
      try {
        created = await d.accounts.create(b.data);
      } catch (err) {
        if (err instanceof EmailTakenError) return reply.code(400).send({ error: err.message });
        throw err;
      }
      const sent = await sendWelcome(req, created.admin, created.account.name);
      // Made from an early-access ticket: say so on the ticket.
      if (b.data.ticketId) {
        const t = await d.tickets.get(req.agent.acc, b.data.ticketId);
        if (t) {
          await d.tickets.addMessage(req.agent.acc, t.id, {
            kind: 'note',
            author: { id: req.agent.sub, name: req.agent.name },
            body: `Created their Replyfinch account “${created.account.name}” (${created.account.id}). ${sent.emailed ? `Welcome email sent to ${created.admin.email}.` : 'Email isn’t set up: send them the set-password link from the Accounts page.'}`,
          });
          d.onTicketNote(req.agent.acc, t.id);
        }
      }
      return reply.code(201).send({ ...created, ...sent } satisfies PlatformAccountCreated);
    });

    /** A new welcome link for an admin who hasn't set a password yet (the old one stops working). */
    p.post<{ Params: { userId: string } }>('/platform/users/:userId/welcome-link', async (req, reply) => {
      const [u] = await d.db.select().from(users).where(eq(users.id, req.params.userId));
      if (!u) return reply.code(404).send({ error: 'not_found' });
      const list = await d.accounts.list();
      const acc = list.find((a) => a.id === u.accountId);
      return sendWelcome(req, { id: u.id, name: u.name, email: u.email }, acc?.name ?? '');
    });
  });
}
