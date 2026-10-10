import { and, desc, eq, gte, inArray, lt, or, sql, type SQL } from 'drizzle-orm';
import type { HistoryEntry, HistoryPage } from '@replyfinch/shared';
import type { Db } from '../db/client';
import { conversations, messages, users, visitors } from '../db/schema';

export interface HistoryQuery {
  q?: string;
  agentId?: string;
  status: 'all' | 'open' | 'ended';
  days?: number;
  cursor?: string;
  limit: number;
}

/** Escape LIKE wildcards so a search for "50%" matches literally. */
const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export function createHistoryService(db: Db) {
  return {
    /**
     * Past and current chats, newest first. Conversation ids are ULIDs, so they sort
     * by start time and double as the page cursor.
     */
    async list(accountId: string, query: HistoryQuery): Promise<HistoryPage> {
      const where: SQL[] = [eq(conversations.accountId, accountId)];
      if (query.status === 'ended') where.push(eq(conversations.status, 'ended'));
      if (query.status === 'open') where.push(inArray(conversations.status, ['waiting', 'active']));
      if (query.agentId) {
        where.push(
          or(eq(conversations.assigneeId, query.agentId), sql`${query.agentId} = any(${conversations.participantIds})`)!,
        );
      }
      if (query.days) where.push(gte(conversations.startedAt, new Date(Date.now() - query.days * 86_400_000)));
      if (query.cursor) where.push(lt(conversations.id, query.cursor));
      if (query.q) {
        const p = likePattern(query.q);
        where.push(
          or(
            sql`${visitors.name} ilike ${p}`,
            sql`${visitors.email} ilike ${p}`,
            sql`exists (select 1 from ${messages} m where m.conversation_id = ${conversations.id} and m.author_type in ('visitor', 'agent') and m.body ilike ${p})`,
          )!,
        );
      }

      const rows = await db
        .select({
          id: conversations.id,
          visitorId: conversations.visitorId,
          visitorName: visitors.name,
          visitorEmail: visitors.email,
          status: conversations.status,
          assigneeId: conversations.assigneeId,
          assigneeName: users.name,
          department: conversations.department,
          startedAt: conversations.startedAt,
          endedAt: conversations.endedAt,
          firstReplyAt: conversations.firstReplyAt,
          messageCount: sql<number>`(select count(*) from ${messages} m where m.conversation_id = ${conversations.id} and m.author_type in ('visitor', 'agent') and not m.internal)`,
          preview: sql<string | null>`(select m.body from ${messages} m where m.conversation_id = ${conversations.id} and m.author_type = 'visitor' order by m.created_at limit 1)`,
        })
        .from(conversations)
        .innerJoin(visitors, eq(visitors.id, conversations.visitorId))
        .leftJoin(users, eq(users.id, conversations.assigneeId))
        .where(and(...where))
        .orderBy(desc(conversations.id))
        .limit(query.limit + 1);

      const page = rows.slice(0, query.limit);
      const items: HistoryEntry[] = page.map((r) => ({
        ...r,
        startedAt: r.startedAt.getTime(),
        endedAt: r.endedAt?.getTime() ?? null,
        firstReplyAt: r.firstReplyAt?.getTime() ?? null,
        messageCount: Number(r.messageCount),
      }));
      return { items, nextCursor: rows.length > query.limit ? page[page.length - 1]!.id : null };
    },
  };
}
export type HistoryService = ReturnType<typeof createHistoryService>;
