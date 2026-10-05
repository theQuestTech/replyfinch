import { and, count, eq, sql } from 'drizzle-orm';
import { parseUserAgent, type DeviceType } from '@replyfinch/shared';
import type { Db } from '../db/client';
import { accounts, conversations, visitors } from '../db/schema';
import { newId } from '../ids';
import type { VisitorRecord } from '../presence';

type VisitorRow = typeof visitors.$inferSelect;

export function createVisitorService(db: Db) {
  return {
    async accountExists(accountId: string) {
      const [a] = await db.select({ id: accounts.id, name: accounts.name }).from(accounts).where(eq(accounts.id, accountId));
      return a ?? null;
    },

    async get(accountId: string, id: string) {
      const [v] = await db.select().from(visitors).where(and(eq(visitors.id, id), eq(visitors.accountId, accountId)));
      return v ?? null;
    },

    /** Find the visitor for an existing token, or create a new one. */
    async identify(input: {
      accountId: string;
      visitorId: string | null;
      userAgent: string;
      country: string | null;
      timezone: string | null;
      newSession: boolean;
    }): Promise<VisitorRow> {
      const ua = parseUserAgent(input.userAgent);
      if (input.visitorId) {
        const existing = await this.get(input.accountId, input.visitorId);
        if (existing) {
          const [updated] = await db
            .update(visitors)
            .set({
              lastSeenAt: new Date(),
              browser: ua.browser,
              os: ua.os,
              device: ua.device,
              ...(input.country ? { country: input.country } : {}),
              ...(input.timezone ? { timezone: input.timezone } : {}),
              ...(input.newSession ? { visits: sql`${visitors.visits} + 1` } : {}),
            })
            .where(eq(visitors.id, existing.id))
            .returning();
          return updated!;
        }
      }
      const [created] = await db
        .insert(visitors)
        .values({
          id: newId.visitor(),
          accountId: input.accountId,
          browser: ua.browser,
          os: ua.os,
          device: ua.device,
          country: input.country,
          timezone: input.timezone,
        })
        .returning();
      return created!;
    },

    async pastChats(visitorId: string) {
      const [r] = await db.select({ n: count() }).from(conversations).where(eq(conversations.visitorId, visitorId));
      return Number(r?.n ?? 0);
    },

    async patch(accountId: string, id: string, p: Partial<Pick<VisitorRow, 'name' | 'email' | 'phone' | 'notes' | 'tags'>>) {
      const [row] = await db
        .update(visitors)
        .set(p)
        .where(and(eq(visitors.id, id), eq(visitors.accountId, accountId)))
        .returning();
      return row ?? null;
    },

    toRecord(
      v: VisitorRow,
      extra: { pastChats: number; conversationId: string | null; conversationStatus: VisitorRecord['conversationStatus']; now: number },
    ): VisitorRecord {
      return {
        id: v.id,
        accountId: v.accountId,
        name: v.name,
        email: v.email,
        phone: v.phone,
        notes: v.notes,
        tags: v.tags,
        country: v.country,
        timezone: v.timezone,
        browser: v.browser ?? 'Unknown',
        os: v.os ?? 'Unknown',
        device: (v.device as DeviceType) ?? 'desktop',
        referrer: null,
        onlineSince: extra.now,
        lastActivityAt: extra.now,
        lastSeenAt: extra.now,
        currentPage: null,
        path: [],
        visits: v.visits,
        pastChats: extra.pastChats,
        conversationId: extra.conversationId,
        conversationStatus: extra.conversationStatus,
        lastState: null,
      };
    },
  };
}
export type VisitorService = ReturnType<typeof createVisitorService>;
