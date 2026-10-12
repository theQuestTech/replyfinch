import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import type { PlatformAccount } from '@replyfinch/shared';
import { hashPassword, tokensValidFrom } from '../auth';
import type { Db } from '../db/client';
import { accounts, conversations, passwordTokens, users } from '../db/schema';
import { newId } from '../ids';
import { createShortcutService } from './shortcuts';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const LIFETIME_MS = { reset: 3_600_000, welcome: 7 * 86_400_000 };

/** A password nobody knows: the account can only be entered through the welcome link. */
const UNUSABLE_PREFIX = '!unset:';

export class EmailTakenError extends Error {}

/** Customer accounts (platform admins) and one-time password links. */
export function createAccountService(db: Db) {
  return {
    async list(): Promise<PlatformAccount[]> {
      const rows = await db.select().from(accounts).orderBy(desc(accounts.createdAt)).limit(500);
      if (!rows.length) return [];
      const ids = rows.map((r) => r.id);
      const [people, chats] = await Promise.all([
        db
          .select({ id: users.id, accountId: users.accountId, name: users.name, email: users.email, role: users.role, hash: users.passwordHash })
          .from(users)
          .where(and(inArray(users.accountId, ids), eq(users.active, true))),
        db
          .select({
            accountId: conversations.accountId,
            n: sql<number>`count(*) filter (where ${conversations.startedAt} > now() - interval '30 days')`,
            last: sql<Date | null>`max(${conversations.startedAt})`,
          })
          .from(conversations)
          .where(inArray(conversations.accountId, ids))
          .groupBy(conversations.accountId),
      ]);
      return rows.map((a) => {
        const mine = people.filter((u) => u.accountId === a.id);
        const c = chats.find((x) => x.accountId === a.id);
        return {
          id: a.id,
          name: a.name,
          createdAt: a.createdAt.getTime(),
          users: mine.length,
          admins: mine
            .filter((u) => u.role === 'admin')
            .map((u) => ({ id: u.id, name: u.name, email: u.email, passwordSet: !u.hash.startsWith(UNUSABLE_PREFIX) })),
          chats30d: Number(c?.n ?? 0),
          lastActivityAt: c?.last ? new Date(c.last).getTime() : null,
        };
      });
    },

    /** A new workspace with its first admin, who sets a password through a welcome link. */
    async create(input: { company: string; name: string; email: string }) {
      const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.email, input.email));
      if (taken) throw new EmailTakenError('There’s already a Replyfinch user with this email');
      const accountId = newId.account();
      const userId = newId.user();
      await db.transaction(async (tx) => {
        await tx.insert(accounts).values({ id: accountId, name: input.company });
        await tx.insert(users).values({
          id: userId,
          accountId,
          email: input.email,
          name: input.name,
          role: 'admin',
          passwordHash: UNUSABLE_PREFIX + randomBytes(24).toString('hex'),
        });
      });
      await createShortcutService(db).addDefaults(accountId);
      return { account: { id: accountId, name: input.company }, admin: { id: userId, name: input.name, email: input.email } };
    },

    /** A fresh one-time link (older unused links for the same person stop working). */
    async issueToken(userId: string, purpose: 'reset' | 'welcome') {
      const token = randomBytes(32).toString('base64url');
      await db
        .update(passwordTokens)
        .set({ usedAt: new Date() })
        .where(and(eq(passwordTokens.userId, userId), isNull(passwordTokens.usedAt)));
      await db.insert(passwordTokens).values({
        id: newId.passwordToken(),
        userId,
        purpose,
        hash: sha(token),
        expiresAt: new Date(Date.now() + LIFETIME_MS[purpose]),
      });
      return token;
    },

    /** Who a link is for, if it's still valid. */
    async checkToken(token: string) {
      const [row] = await db
        .select({ purpose: passwordTokens.purpose, userId: users.id, name: users.name, email: users.email, active: users.active, accountName: accounts.name })
        .from(passwordTokens)
        .innerJoin(users, eq(users.id, passwordTokens.userId))
        .innerJoin(accounts, eq(accounts.id, users.accountId))
        .where(and(eq(passwordTokens.hash, sha(token)), isNull(passwordTokens.usedAt), gt(passwordTokens.expiresAt, new Date())));
      return row && row.active ? row : null;
    },

    /** Use a link: set the password, sign out everywhere else. Returns the user, or null if the link is bad. */
    async useToken(token: string, password: string) {
      const valid = await this.checkToken(token);
      if (!valid) return null;
      // Claim it first, so the same link can't be used twice at once.
      const [claimed] = await db
        .update(passwordTokens)
        .set({ usedAt: new Date() })
        .where(and(eq(passwordTokens.hash, sha(token)), isNull(passwordTokens.usedAt)))
        .returning({ id: passwordTokens.id });
      if (!claimed) return null;
      const [user] = await db
        .update(users)
        .set({ passwordHash: await hashPassword(password), tokensValidAfter: tokensValidFrom() })
        .where(eq(users.id, valid.userId))
        .returning();
      return user ?? null;
    },

    async findActiveUser(email: string) {
      const [u] = await db.select().from(users).where(and(eq(users.email, email.toLowerCase()), eq(users.active, true)));
      return u ?? null;
    },
  };
}
export type AccountService = ReturnType<typeof createAccountService>;
