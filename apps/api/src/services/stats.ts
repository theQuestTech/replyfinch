import { and, count, eq, gte, inArray, sql } from 'drizzle-orm';
import type { HomeStats, TeamMember } from '@replyfinch/shared';
import type { Db } from '../db/client';
import { conversations, users } from '../db/schema';
import type { Presence } from '../presence';

function startOfTodayUtc() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export function createStatsService(db: Db, presence: Presence) {
  return {
    async team(accountId: string): Promise<TeamMember[]> {
      const rows = await db.select().from(users).where(eq(users.accountId, accountId));
      const load = await db
        .select({ assigneeId: conversations.assigneeId, n: count() })
        .from(conversations)
        .where(and(eq(conversations.accountId, accountId), eq(conversations.status, 'active')))
        .groupBy(conversations.assigneeId);
      const loadBy = new Map(load.map((l) => [l.assigneeId, Number(l.n)]));
      const live = await presence.listAgents(accountId);
      return rows.map((u) => ({
        id: u.id,
        accountId: u.accountId,
        name: u.name,
        email: u.email,
        role: u.role,
        status: live[u.id] && live[u.id]!.conns > 0 ? live[u.id]!.status : 'offline',
        activeChats: loadBy.get(u.id) ?? 0,
        maxChats: u.maxChats,
      }));
    },

    async home(accountId: string, userId: string): Promise<HomeStats> {
      const today = startOfTodayUtc();
      const [open] = await db
        .select({
          waiting: sql<number>`count(*) filter (where ${conversations.status} = 'waiting')`,
          open: count(),
          mine: sql<number>`count(*) filter (where ${conversations.assigneeId} = ${userId})`,
        })
        .from(conversations)
        .where(and(eq(conversations.accountId, accountId), inArray(conversations.status, ['waiting', 'active'])));
      const [todayRow] = await db
        .select({
          total: count(),
          avgFirst: sql<
            number | null
          >`avg(extract(epoch from (${conversations.firstReplyAt} - ${conversations.startedAt})))`,
        })
        .from(conversations)
        .where(and(eq(conversations.accountId, accountId), gte(conversations.startedAt, today)));
      const byHour = await db
        .select({ hour: sql<number>`extract(hour from ${conversations.startedAt})::int`, n: count() })
        .from(conversations)
        .where(and(eq(conversations.accountId, accountId), gte(conversations.startedAt, today)))
        .groupBy(sql`1`);
      const visitorsOnline = (await presence.listVisitors(accountId)).length;
      return {
        waiting: Number(open?.waiting ?? 0),
        open: Number(open?.open ?? 0),
        assignedToMe: Number(open?.mine ?? 0),
        avgFirstReplySeconds: todayRow?.avgFirst == null ? null : Math.round(Number(todayRow.avgFirst)),
        conversationsToday: Number(todayRow?.total ?? 0),
        chatsByHour: byHour.map((r) => ({ hour: Number(r.hour), count: Number(r.n) })),
        visitorsOnline,
      };
    },
  };
}
export type StatsService = ReturnType<typeof createStatsService>;
