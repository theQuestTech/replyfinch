import { and, asc, desc, eq, sql, type SQL } from 'drizzle-orm';
import type { CustomerList, CustomerProfile, CustomerSummary } from '@replyfinch/shared';
import type { Db } from '../db/client';
import { conversations, offlineMessages, pageViews, visitors } from '../db/schema';
import type { HistoryService } from './history';
import type { OfflineService } from './offline';
import type { TicketService } from './tickets';

export interface CustomerQuery {
  q?: string;
  tag?: string;
  sort: 'recent' | 'chats' | 'name';
  offset: number;
  limit: number;
}

const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

// Fully qualified: inside the count subqueries a bare "id" would mean the subquery's own table.
const VID = sql.raw('"visitors"."id"');

export function createCustomerService(db: Db, history: HistoryService, offline: OfflineService, tickets: TicketService) {
  const chats = sql<number>`(select count(*) from ${conversations} c where c.visitor_id = ${VID})`;
  const fields = {
    id: visitors.id,
    name: visitors.name,
    email: visitors.email,
    phone: visitors.phone,
    tags: visitors.tags,
    country: visitors.country,
    visits: visitors.visits,
    firstSeenAt: visitors.firstSeenAt,
    lastSeenAt: visitors.lastSeenAt,
    chats,
    lastChatAt: sql<string | null>`(select max(c.started_at) from ${conversations} c where c.visitor_id = ${VID})`,
    good: sql<number>`(select count(*) from ${conversations} c where c.visitor_id = ${VID} and c.rating = 'good')`,
    bad: sql<number>`(select count(*) from ${conversations} c where c.visitor_id = ${VID} and c.rating = 'bad')`,
    offlineMessages: sql<number>`(select count(*) from ${offlineMessages} o where o.visitor_id = ${VID})`,
  };
  const toSummary = (r: {
    [K in keyof typeof fields]: unknown;
  }): CustomerSummary => ({
    id: r.id as string,
    name: r.name as string | null,
    email: r.email as string | null,
    phone: r.phone as string | null,
    tags: r.tags as string[],
    country: r.country as string | null,
    visits: Number(r.visits),
    firstSeenAt: (r.firstSeenAt as Date).getTime(),
    lastSeenAt: (r.lastSeenAt as Date).getTime(),
    chats: Number(r.chats),
    lastChatAt: r.lastChatAt ? new Date(r.lastChatAt as string).getTime() : null,
    good: Number(r.good),
    bad: Number(r.bad),
    offlineMessages: Number(r.offlineMessages),
  });

  // Anyone the team has talked to or knows by name: not every anonymous page view.
  const isCustomer = sql`(${visitors.name} is not null or ${visitors.email} is not null
    or exists (select 1 from ${conversations} c where c.visitor_id = ${VID})
    or exists (select 1 from ${offlineMessages} o where o.visitor_id = ${VID}))`;

  return {
    async list(accountId: string, query: CustomerQuery): Promise<CustomerList> {
      const where: SQL[] = [eq(visitors.accountId, accountId), isCustomer];
      if (query.tag) where.push(sql`${query.tag.toLowerCase()} = any(${visitors.tags})`);
      if (query.q) {
        const p = likePattern(query.q);
        where.push(
          sql`(${visitors.name} ilike ${p} or ${visitors.email} ilike ${p} or ${visitors.phone} ilike ${p} or ${visitors.notes} ilike ${p}
            or exists (select 1 from unnest(${visitors.tags}) t where t ilike ${p}))`,
        );
      }
      const order =
        query.sort === 'chats'
          ? [desc(chats), desc(visitors.lastSeenAt)]
          : query.sort === 'name'
            ? [sql`lower(${visitors.name}) asc nulls last`, asc(visitors.email)]
            : [desc(visitors.lastSeenAt)];
      const [rows, [count]] = await Promise.all([
        db
          .select(fields)
          .from(visitors)
          .where(and(...where))
          .orderBy(...order, desc(visitors.id))
          .limit(query.limit)
          .offset(query.offset),
        db.select({ n: sql<number>`count(*)` }).from(visitors).where(and(...where)),
      ]);
      return { items: rows.map(toSummary), total: Number(count?.n ?? 0) };
    },

    async tags(accountId: string): Promise<string[]> {
      const rows = (await db.execute(
        sql`select distinct t from ${visitors}, unnest(${visitors.tags}) t where ${visitors.accountId} = ${accountId} order by t limit 200`,
      )) as unknown as { t: string }[];
      return rows.map((r) => r.t);
    },

    async profile(accountId: string, id: string): Promise<CustomerProfile | null> {
      const [row] = await db
        .select({ ...fields, notes: visitors.notes, timezone: visitors.timezone, browser: visitors.browser, os: visitors.os, device: visitors.device })
        .from(visitors)
        .where(and(eq(visitors.id, id), eq(visitors.accountId, accountId)));
      if (!row) return null;
      const [convs, offlineMsgs, ticketList, pages] = await Promise.all([
        history.list(accountId, { visitorId: id, status: 'all', limit: 100 }),
        offline.listForVisitor(accountId, id),
        tickets.forVisitor(accountId, id),
        db
          .select({ url: pageViews.url, title: pageViews.title, at: pageViews.createdAt })
          .from(pageViews)
          .where(and(eq(pageViews.visitorId, id), eq(pageViews.accountId, accountId)))
          .orderBy(desc(pageViews.createdAt))
          .limit(30),
      ]);
      return {
        customer: { ...toSummary(row), notes: row.notes, timezone: row.timezone, browser: row.browser, os: row.os, device: row.device },
        conversations: convs.items,
        offlineMessages: offlineMsgs,
        tickets: ticketList,
        pages: pages.map((p) => ({ url: p.url, title: p.title, at: p.at.getTime() })),
      };
    },
  };
}
export type CustomerService = ReturnType<typeof createCustomerService>;
