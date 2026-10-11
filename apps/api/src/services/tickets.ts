import { and, asc, desc, eq, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import type { Ticket, TicketCounts, TicketList, TicketMessage, TicketPriority, TicketStatus, TicketView } from '@replyfinch/shared';
import type { Db } from '../db/client';
import { ticketMessages, tickets, users, visitors } from '../db/schema';
import { newId } from '../ids';
import { isUniqueViolation } from './conversations';

type Row = typeof tickets.$inferSelect;
type MsgRow = typeof ticketMessages.$inferSelect;
type Author = { id: string | null; name: string };
type NewMessage = { kind: TicketMessage['kind']; author: Author; body: string; emailedTo?: string | null; createdAt?: Date };

const STATUS_LABEL: Record<TicketStatus, string> = { open: 'Open', pending: 'Pending', solved: 'Solved' };
const PRIORITY_LABEL: Record<TicketPriority, string> = { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' };

const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

const msgDto = (m: MsgRow): TicketMessage => ({
  id: m.id,
  kind: m.kind,
  authorId: m.authorId,
  authorName: m.authorName,
  body: m.body,
  emailedTo: m.emailedTo,
  createdAt: m.createdAt.getTime(),
});

export function createTicketService(db: Db) {
  /** One query for every agent name the rows mention. */
  async function dtoMany(rows: Row[]): Promise<Ticket[]> {
    const ids = [...new Set(rows.flatMap((r) => [r.assigneeId, r.createdBy]).filter((x): x is string => !!x))];
    const names = new Map(
      ids.length ? (await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids))).map((u) => [u.id, u.name]) : [],
    );
    return rows.map((r) => ({
      id: r.id,
      number: r.number,
      subject: r.subject,
      status: r.status,
      priority: r.priority,
      assigneeId: r.assigneeId,
      assigneeName: (r.assigneeId && names.get(r.assigneeId)) || null,
      visitorId: r.visitorId,
      requesterName: r.requesterName,
      requesterEmail: r.requesterEmail,
      source: r.source,
      sourceId: r.sourceId,
      createdByName: (r.createdBy && names.get(r.createdBy)) || null,
      createdAt: r.createdAt.getTime(),
      updatedAt: r.updatedAt.getTime(),
      solvedAt: r.solvedAt?.getTime() ?? null,
    }));
  }
  const dto = async (r: Row) => (await dtoMany([r]))[0]!;

  type Exec = Pick<Db, 'insert'>;
  const insertMessages = (accountId: string, ticketId: string, msgs: NewMessage[], exec: Exec = db) =>
    msgs.length
      ? exec
          .insert(ticketMessages)
          .values(
            msgs.map((m) => ({
              id: newId.ticketMessage(),
              accountId,
              ticketId,
              kind: m.kind,
              authorId: m.author.id,
              authorName: m.author.name,
              body: m.body,
              emailedTo: m.emailedTo ?? null,
              ...(m.createdAt ? { createdAt: m.createdAt } : {}),
            })),
          )
          .returning()
      : Promise.resolve([] as MsgRow[]);

  function viewFilter(view: TicketView, userId: string): SQL | undefined {
    switch (view) {
      case 'unsolved':
        return ne(tickets.status, 'solved');
      case 'mine':
        return and(eq(tickets.assigneeId, userId), ne(tickets.status, 'solved'));
      case 'unassigned':
        return and(isNull(tickets.assigneeId), ne(tickets.status, 'solved'));
      case 'all':
        return undefined;
      default:
        return eq(tickets.status, view);
    }
  }

  return {
    dto,
    dtoMany,

    async get(accountId: string, id: string) {
      const [row] = await db.select().from(tickets).where(and(eq(tickets.id, id), eq(tickets.accountId, accountId)));
      return row ?? null;
    },

    /** An active agent on this account (for assigning). */
    async isAgent(accountId: string, userId: string) {
      const [u] = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, userId), eq(users.accountId, accountId), eq(users.active, true)));
      return !!u;
    },

    /** The customer record for a name/email typed in: an existing one with that email, or a new one. */
    async findOrCreateCustomer(accountId: string, name: string | null, email: string | null) {
      if (email) {
        const [v] = await db
          .select()
          .from(visitors)
          .where(and(eq(visitors.accountId, accountId), sql`lower(${visitors.email}) = ${email.toLowerCase()}`))
          .orderBy(desc(visitors.lastSeenAt))
          .limit(1);
        if (v) {
          if (name && !v.name) await db.update(visitors).set({ name }).where(eq(visitors.id, v.id));
          return { ...v, name: v.name ?? name };
        }
      }
      if (!name && !email) return null;
      const [v] = await db.insert(visitors).values({ id: newId.visitor(), accountId, name, email, visits: 0 }).returning();
      return v!;
    },

    async create(
      accountId: string,
      t: {
        subject: string;
        priority: TicketPriority;
        assigneeId: string | null;
        visitorId: string | null;
        requesterName: string | null;
        requesterEmail: string | null;
        source: Row['source'];
        sourceId: string | null;
        createdBy: Author;
        messages: NewMessage[];
      },
    ) {
      // Numbers are per account: next = highest + 1, retried if two agents create one at the same moment.
      for (let attempt = 0; ; attempt++) {
        try {
          const row = await db.transaction(async (tx) => {
            const [r] = await tx
              .insert(tickets)
              .values({
                id: newId.ticket(),
                accountId,
                number: sql`(select coalesce(max(${tickets.number}), 0) + 1 from ${tickets} where ${tickets.accountId} = ${accountId})`,
                subject: t.subject,
                priority: t.priority,
                assigneeId: t.assigneeId,
                visitorId: t.visitorId,
                requesterName: t.requesterName,
                requesterEmail: t.requesterEmail,
                source: t.source,
                sourceId: t.sourceId,
                createdBy: t.createdBy.id,
              })
              .returning();
            await insertMessages(accountId, r!.id, t.messages, tx);
            return r!;
          });
          return row;
        } catch (err) {
          if (attempt < 4 && isUniqueViolation(err)) continue;
          throw err;
        }
      }
    },

    async list(accountId: string, userId: string, q: { view: TicketView; q?: string; visitorId?: string; offset: number; limit: number }): Promise<TicketList> {
      const where: (SQL | undefined)[] = [eq(tickets.accountId, accountId), viewFilter(q.view, userId)];
      if (q.visitorId) where.push(eq(tickets.visitorId, q.visitorId));
      if (q.q) {
        const num = /^#?(\d{1,9})$/.exec(q.q)?.[1];
        const p = likePattern(q.q);
        where.push(
          or(
            num ? eq(tickets.number, Number(num)) : undefined,
            sql`${tickets.subject} ilike ${p}`,
            sql`${tickets.requesterName} ilike ${p}`,
            sql`${tickets.requesterEmail} ilike ${p}`,
          ),
        );
      }
      const [rows, [count]] = await Promise.all([
        db
          .select()
          .from(tickets)
          .where(and(...where))
          .orderBy(desc(tickets.updatedAt), desc(tickets.id))
          .limit(q.limit)
          .offset(q.offset),
        db.select({ n: sql<number>`count(*)` }).from(tickets).where(and(...where)),
      ]);
      return { items: await dtoMany(rows), total: Number(count?.n ?? 0) };
    },

    async counts(accountId: string, userId: string): Promise<TicketCounts> {
      const unsolved = sql`${tickets.status} <> 'solved'`;
      const [r] = await db
        .select({
          unsolved: sql<number>`count(*) filter (where ${unsolved})`,
          mine: sql<number>`count(*) filter (where ${unsolved} and ${tickets.assigneeId} = ${userId})`,
          unassigned: sql<number>`count(*) filter (where ${unsolved} and ${tickets.assigneeId} is null)`,
          open: sql<number>`count(*) filter (where ${tickets.status} = 'open')`,
          pending: sql<number>`count(*) filter (where ${tickets.status} = 'pending')`,
          solved: sql<number>`count(*) filter (where ${tickets.status} = 'solved')`,
          all: sql<number>`count(*)`,
        })
        .from(tickets)
        .where(eq(tickets.accountId, accountId));
      return Object.fromEntries(Object.entries(r ?? {}).map(([k, v]) => [k, Number(v ?? 0)])) as TicketCounts;
    },

    async messages(accountId: string, ticketId: string): Promise<TicketMessage[]> {
      const rows = await db
        .select()
        .from(ticketMessages)
        .where(and(eq(ticketMessages.ticketId, ticketId), eq(ticketMessages.accountId, accountId)))
        .orderBy(asc(ticketMessages.createdAt), asc(ticketMessages.id));
      return rows.map(msgDto);
    },

    async addMessage(accountId: string, ticketId: string, m: NewMessage): Promise<TicketMessage> {
      const [row] = await insertMessages(accountId, ticketId, [m]);
      await db.update(tickets).set({ updatedAt: new Date() }).where(eq(tickets.id, ticketId));
      return msgDto(row!);
    },

    /** Change fields, leaving a line in the thread for each change. Returns null if nothing changed. */
    async update(
      accountId: string,
      row: Row,
      patch: { subject?: string; status?: TicketStatus; priority?: TicketPriority; assigneeId?: string | null },
      by: Author,
    ) {
      const set: Partial<typeof tickets.$inferInsert> = {};
      const events: string[] = [];
      if (patch.subject !== undefined && patch.subject !== row.subject) {
        set.subject = patch.subject;
        events.push(`renamed the ticket to “${patch.subject}”`);
      }
      if (patch.status && patch.status !== row.status) {
        set.status = patch.status;
        set.solvedAt = patch.status === 'solved' ? new Date() : null;
        events.push(`set status to ${STATUS_LABEL[patch.status]}`);
      }
      if (patch.priority && patch.priority !== row.priority) {
        set.priority = patch.priority;
        events.push(`set priority to ${PRIORITY_LABEL[patch.priority]}`);
      }
      if (patch.assigneeId !== undefined && patch.assigneeId !== row.assigneeId) {
        set.assigneeId = patch.assigneeId;
        if (!patch.assigneeId) events.push('unassigned the ticket');
        else if (patch.assigneeId === by.id) events.push('took the ticket');
        else {
          const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, patch.assigneeId));
          events.push(`assigned the ticket to ${u?.name ?? 'a teammate'}`);
        }
      }
      if (!events.length) return null;
      const [updated] = await db
        .update(tickets)
        .set({ ...set, updatedAt: new Date() })
        .where(and(eq(tickets.id, row.id), eq(tickets.accountId, accountId)))
        .returning();
      const msgs = await insertMessages(
        accountId,
        row.id,
        events.map((body) => ({ kind: 'event' as const, author: by, body })),
      );
      return { row: updated!, events: msgs.map(msgDto) };
    },

    async forVisitor(accountId: string, visitorId: string) {
      const rows = await db
        .select()
        .from(tickets)
        .where(and(eq(tickets.accountId, accountId), eq(tickets.visitorId, visitorId)))
        .orderBy(desc(tickets.updatedAt))
        .limit(100);
      return dtoMany(rows);
    },
  };
}
export type TicketService = ReturnType<typeof createTicketService>;
