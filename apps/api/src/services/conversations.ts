import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Conversation, Message } from '@replyfinch/shared';
import type { Db } from '../db/client';
import { conversations, messages, users, visitors } from '../db/schema';
import { newId } from '../ids';

type ConvRow = typeof conversations.$inferSelect;
type MsgRow = typeof messages.$inferSelect;

export const OPEN_STATUSES = ['waiting', 'active'] as const;

export function messageDto(m: MsgRow): Message {
  return {
    id: m.id,
    conversationId: m.conversationId,
    authorType: m.authorType,
    authorId: m.authorId,
    authorName: m.authorName,
    body: m.body,
    internal: m.internal,
    clientId: m.clientId,
    createdAt: m.createdAt.getTime(),
  };
}

export function createConversationService(db: Db) {
  async function dto(row: ConvRow): Promise<Conversation> {
    const [v] = await db.select({ name: visitors.name }).from(visitors).where(eq(visitors.id, row.visitorId));
    const [last] = await db
      .select({ body: messages.body })
      .from(messages)
      .where(and(eq(messages.conversationId, row.id), eq(messages.authorType, 'visitor')))
      .orderBy(desc(messages.createdAt))
      .limit(1);
    const assignee = row.assigneeId
      ? (await db.select({ name: users.name }).from(users).where(eq(users.id, row.assigneeId)))[0]
      : undefined;
    return {
      id: row.id,
      accountId: row.accountId,
      visitorId: row.visitorId,
      visitorName: v?.name ?? null,
      status: row.status,
      assigneeId: row.assigneeId,
      assigneeName: assignee?.name ?? null,
      participantIds: row.participantIds,
      department: row.department,
      startedAt: row.startedAt.getTime(),
      firstReplyAt: row.firstReplyAt?.getTime() ?? null,
      endedAt: row.endedAt?.getTime() ?? null,
      lastMessageAt: row.lastMessageAt.getTime(),
      preview: last?.body ?? null,
      rating: row.rating,
      ratingComment: row.ratingComment,
    };
  }

  async function insertMessage(
    conv: ConvRow,
    m: Pick<MsgRow, 'authorType' | 'authorId' | 'authorName' | 'body'> & { internal?: boolean; clientId?: string | null },
  ): Promise<{ message: MsgRow; duplicate: boolean }> {
    const inserted = await db
      .insert(messages)
      .values({
        id: newId.message(),
        accountId: conv.accountId,
        conversationId: conv.id,
        authorType: m.authorType,
        authorId: m.authorId,
        authorName: m.authorName,
        body: m.body,
        internal: m.internal ?? false,
        clientId: m.clientId ?? null,
      })
      .onConflictDoNothing()
      .returning();
    if (inserted[0]) {
      await db.update(conversations).set({ lastMessageAt: inserted[0].createdAt }).where(eq(conversations.id, conv.id));
      return { message: inserted[0], duplicate: false };
    }
    // Same clientId already stored: a retried send. Return the original.
    const [existing] = await db
      .select()
      .from(messages)
      .where(and(eq(messages.conversationId, conv.id), eq(messages.clientId, m.clientId!)));
    return { message: existing!, duplicate: true };
  }

  return {
    dto,

    async get(accountId: string, id: string) {
      const [row] = await db
        .select()
        .from(conversations)
        .where(and(eq(conversations.id, id), eq(conversations.accountId, accountId)));
      return row ?? null;
    },

    async openForVisitor(visitorId: string) {
      const [row] = await db
        .select()
        .from(conversations)
        .where(and(eq(conversations.visitorId, visitorId), inArray(conversations.status, [...OPEN_STATUSES])));
      return row ?? null;
    },

    async listMessages(conversationId: string, opts: { includeInternal: boolean }) {
      const rows = await db
        .select()
        .from(messages)
        .where(
          opts.includeInternal
            ? eq(messages.conversationId, conversationId)
            : and(eq(messages.conversationId, conversationId), eq(messages.internal, false)),
        )
        .orderBy(asc(messages.createdAt), asc(messages.id));
      return rows.map(messageDto);
    },

    async listOpen(accountId: string) {
      const rows = await db
        .select()
        .from(conversations)
        .where(and(eq(conversations.accountId, accountId), inArray(conversations.status, [...OPEN_STATUSES])));
      return Promise.all(rows.map(dto));
    },

    async listForVisitor(accountId: string, visitorId: string) {
      const rows = await db
        .select()
        .from(conversations)
        .where(and(eq(conversations.accountId, accountId), eq(conversations.visitorId, visitorId)))
        .orderBy(sql`${conversations.startedAt} desc`);
      return Promise.all(rows.map(dto));
    },

    /** Visitor starts a chat from the widget: conversation + first message + bot acknowledgement. */
    async start(
      accountId: string,
      visitorId: string,
      input: { name: string; email?: string; department?: string; message: string; clientId: string },
    ) {
      await db
        .update(visitors)
        .set({ name: input.name, ...(input.email ? { email: input.email } : {}) })
        .where(eq(visitors.id, visitorId));
      const [conv] = await db
        .insert(conversations)
        .values({ id: newId.conversation(), accountId, visitorId, department: input.department || null })
        .returning();
      const created: MsgRow[] = [];
      created.push(
        (await insertMessage(conv!, {
          authorType: 'visitor',
          authorId: visitorId,
          authorName: input.name,
          body: input.message,
          clientId: input.clientId,
        })).message,
      );
      const team = input.department ? `the ${input.department} team` : 'our team';
      created.push(
        (await insertMessage(conv!, {
          authorType: 'bot',
          authorId: null,
          authorName: 'Replyfinch Assistant',
          body: `Thanks ${input.name.split(' ')[0]}! I've passed your chat to ${team} — an agent will join in a moment.`,
        })).message,
      );
      return { conversation: conv!, messages: created.map(messageDto) };
    },

    /** An agent messages a browsing visitor first: the chat starts already assigned to them. */
    async startByAgent(accountId: string, visitorId: string, agent: { id: string; name: string }, body: string, clientId: string) {
      const now = new Date();
      const [conv] = await db
        .insert(conversations)
        .values({
          id: newId.conversation(),
          accountId,
          visitorId,
          status: 'active',
          assigneeId: agent.id,
          participantIds: [agent.id],
          firstReplyAt: now,
        })
        .returning();
      const sys = await insertMessage(conv!, {
        authorType: 'system',
        authorId: agent.id,
        authorName: agent.name,
        body: `${agent.name} started the chat`,
      });
      const msg = await insertMessage(conv!, { authorType: 'agent', authorId: agent.id, authorName: agent.name, body, clientId });
      return { conversation: conv!, messages: [messageDto(sys.message), messageDto(msg.message)] };
    },

    /**
     * Add a message. When an agent sends their first message in a conversation they
     * join it: they become a participant (and the assignee if nobody is), and a
     * "joined the chat" system message is posted first.
     */
    async addMessage(
      conv: ConvRow,
      author: { type: 'visitor' | 'agent'; id: string; name: string },
      body: string,
      clientId: string,
      internal = false,
    ): Promise<{ messages: Message[]; conversation: ConvRow; joined: boolean }> {
      const out: Message[] = [];
      let current = conv;
      let joined = false;
      if (author.type === 'agent' && !internal && !conv.participantIds.includes(author.id)) {
        const now = new Date();
        const [updated] = await db
          .update(conversations)
          .set({
            participantIds: sql`array_append(${conversations.participantIds}, ${author.id})`,
            assigneeId: conv.assigneeId ?? author.id,
            status: 'active',
            firstReplyAt: conv.firstReplyAt ?? now,
          })
          .where(eq(conversations.id, conv.id))
          .returning();
        current = updated!;
        joined = true;
        const sys = await insertMessage(current, {
          authorType: 'system',
          authorId: author.id,
          authorName: author.name,
          body: `${author.name} joined the chat`,
        });
        out.push(messageDto(sys.message));
      }
      const res = await insertMessage(current, {
        authorType: author.type,
        authorId: author.id,
        authorName: author.name,
        body,
        clientId,
        internal,
      });
      out.push(messageDto(res.message));
      return { messages: out, conversation: current, joined };
    },

    /**
     * Hand a chat to another agent (they become the assignee and join when they
     * type), or back to the queue for a department. The agent handing it over
     * leaves the chat. An optional note is posted as an internal note.
     */
    async transfer(
      conv: ConvRow,
      from: { id: string; name: string },
      to: { agent: { id: string; name: string } } | { department: string },
      note?: string,
    ) {
      const toAgent = 'agent' in to;
      const [updated] = await db
        .update(conversations)
        .set(
          toAgent
            ? { assigneeId: to.agent.id, participantIds: sql`array_remove(${conversations.participantIds}, ${from.id})` }
            : {
                department: to.department,
                assigneeId: null,
                status: 'waiting',
                participantIds: sql`array_remove(${conversations.participantIds}, ${from.id})`,
              },
        )
        .where(eq(conversations.id, conv.id))
        .returning();
      const out: Message[] = [];
      const sys = await insertMessage(updated!, {
        authorType: 'system',
        authorId: from.id,
        authorName: from.name,
        body: toAgent ? `${from.name} transferred the chat to ${to.agent.name}` : `${from.name} transferred the chat to the ${to.department} team`,
      });
      out.push(messageDto(sys.message));
      if (note) {
        const n = await insertMessage(updated!, { authorType: 'agent', authorId: from.id, authorName: from.name, body: note, internal: true });
        out.push(messageDto(n.message));
      }
      return { conversation: updated!, messages: out };
    },

    /** The visitor rates an ended chat. Agents get an internal note in the transcript. */
    async rate(conv: ConvRow, visitorName: string, rating: 'good' | 'bad', comment?: string) {
      const [updated] = await db
        .update(conversations)
        .set({ rating, ratingComment: comment || null, ratedAt: new Date() })
        .where(eq(conversations.id, conv.id))
        .returning();
      const label = rating === 'good' ? '👍 Good' : '👎 Bad';
      const note = await insertMessage(updated!, {
        authorType: 'system',
        authorId: conv.visitorId,
        authorName: visitorName,
        // The widget saves the thumbs first, then the comment: don't repeat the rating.
        body:
          conv.rating === rating && comment
            ? `${visitorName} added a comment: “${comment}”`
            : `${visitorName} rated the chat ${label}${comment ? `: “${comment}”` : ''}`,
        internal: true,
      });
      return { conversation: updated!, message: messageDto(note.message) };
    },

    async end(conv: ConvRow, by: { name: string; id: string | null }, note = `Chat ended by ${by.name}`) {
      const [updated] = await db
        .update(conversations)
        .set({ status: 'ended', endedAt: new Date() })
        .where(eq(conversations.id, conv.id))
        .returning();
      const sys = await insertMessage(updated!, {
        authorType: 'system',
        authorId: by.id,
        authorName: by.name,
        body: note,
      });
      return { conversation: updated!, message: messageDto(sys.message) };
    },
  };
}
export type ConversationService = ReturnType<typeof createConversationService>;
