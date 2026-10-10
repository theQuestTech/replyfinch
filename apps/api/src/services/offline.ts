import { and, desc, eq, sql } from 'drizzle-orm';
import type { OfflineMessage } from '@replyfinch/shared';
import type { Db } from '../db/client';
import { offlineMessages, users, visitors } from '../db/schema';
import { newId } from '../ids';

type Row = typeof offlineMessages.$inferSelect;

export function createOfflineService(db: Db) {
  async function dto(r: Row): Promise<OfflineMessage> {
    const handler = r.handledBy
      ? (await db.select({ name: users.name }).from(users).where(eq(users.id, r.handledBy)))[0]
      : undefined;
    return {
      id: r.id,
      visitorId: r.visitorId,
      name: r.name,
      email: r.email,
      department: r.department,
      message: r.message,
      pageUrl: r.pageUrl,
      status: r.status,
      handledById: r.handledBy,
      handledByName: handler?.name ?? null,
      handledAt: r.handledAt?.getTime() ?? null,
      createdAt: r.createdAt.getTime(),
    };
  }

  return {
    dto,

    async create(
      accountId: string,
      visitorId: string,
      input: { name: string; email: string; department?: string; message: string; pageUrl?: string },
    ) {
      // Remember who they are, like starting a chat does.
      await db.update(visitors).set({ name: input.name, email: input.email }).where(eq(visitors.id, visitorId));
      const [row] = await db
        .insert(offlineMessages)
        .values({
          id: newId.offlineMessage(),
          accountId,
          visitorId,
          name: input.name,
          email: input.email,
          department: input.department || null,
          message: input.message,
          pageUrl: input.pageUrl || null,
        })
        .returning();
      return dto(row!);
    },

    async list(accountId: string, status?: 'new' | 'handled') {
      const rows = await db
        .select()
        .from(offlineMessages)
        .where(and(eq(offlineMessages.accountId, accountId), status ? eq(offlineMessages.status, status) : undefined))
        .orderBy(desc(offlineMessages.id))
        .limit(200);
      return Promise.all(rows.map(dto));
    },

    async countNew(accountId: string) {
      const [r] = await db
        .select({ n: sql<number>`count(*)` })
        .from(offlineMessages)
        .where(and(eq(offlineMessages.accountId, accountId), eq(offlineMessages.status, 'new')));
      return Number(r?.n ?? 0);
    },

    async setStatus(accountId: string, id: string, status: 'new' | 'handled', userId: string) {
      const [row] = await db
        .update(offlineMessages)
        .set(status === 'handled' ? { status, handledBy: userId, handledAt: new Date() } : { status, handledBy: null, handledAt: null })
        .where(and(eq(offlineMessages.id, id), eq(offlineMessages.accountId, accountId)))
        .returning();
      return row ? dto(row) : null;
    },
  };
}
export type OfflineService = ReturnType<typeof createOfflineService>;
