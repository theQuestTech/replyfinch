import { sql } from 'drizzle-orm';
import { bigint, boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import type { AiSettings, WidgetSettings } from '@replyfinch/shared';

// Every tenant-owned table carries account_id so customers can later be split
// across database clusters ("cells") without a rewrite.

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const accounts = pgTable('accounts', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /** Chat widget look and questions; null until an admin saves them (defaults apply). */
  widgetSettings: jsonb('widget_settings').$type<Partial<WidgetSettings>>(),
  aiSettings: jsonb('ai_settings').$type<Partial<AiSettings>>(),
  createdAt: createdAt(),
});

export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull().references(() => accounts.id),
    email: text('email').notNull(),
    name: text('name').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: text('role', { enum: ['admin', 'agent'] }).notNull().default('agent'),
    maxChats: integer('max_chats').notNull().default(4),
    /** Removed agents are deactivated, not deleted, so their chat history keeps its author. */
    active: boolean('active').notNull().default(true),
    /** Sign-in tokens issued before this moment are rejected (set when the password changes). */
    tokensValidAfter: timestamp('tokens_valid_after', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('users_email_idx').on(t.email), index('users_account_idx').on(t.accountId)],
);

export const visitors = pgTable(
  'visitors',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull().references(() => accounts.id),
    name: text('name'),
    email: text('email'),
    phone: text('phone'),
    notes: text('notes'),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    visits: integer('visits').notNull().default(1),
    country: text('country'),
    timezone: text('timezone'),
    browser: text('browser'),
    os: text('os'),
    device: text('device'),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('visitors_account_idx').on(t.accountId), index('visitors_account_seen_idx').on(t.accountId, t.lastSeenAt)],
);

export const pageViews = pgTable(
  'page_views',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    visitorId: text('visitor_id').notNull().references(() => visitors.id),
    url: text('url').notNull(),
    title: text('title').notNull(),
    referrer: text('referrer'),
    createdAt: createdAt(),
  },
  (t) => [index('page_views_visitor_idx').on(t.visitorId, t.createdAt)],
);

export const conversations = pgTable(
  'conversations',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull().references(() => accounts.id),
    visitorId: text('visitor_id').notNull().references(() => visitors.id),
    status: text('status', { enum: ['waiting', 'active', 'ended'] }).notNull().default('waiting'),
    assigneeId: text('assignee_id').references(() => users.id),
    participantIds: text('participant_ids').array().notNull().default(sql`'{}'::text[]`),
    department: text('department'),
    /** Who started it: the visitor (from the widget) or an agent (proactive chat). */
    initiatedBy: text('initiated_by', { enum: ['visitor', 'agent'] }).notNull().default('visitor'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    firstReplyAt: timestamp('first_reply_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull().defaultNow(),
    /** The visitor's rating after the chat ended. */
    rating: text('rating', { enum: ['good', 'bad'] }),
    ratingComment: text('rating_comment'),
    ratedAt: timestamp('rated_at', { withTimezone: true }),
  },
  (t) => [
    index('conversations_account_status_idx').on(t.accountId, t.status),
    index('conversations_visitor_idx').on(t.visitorId),
    // A visitor has at most one open chat (two tabs starting at once can't create two).
    uniqueIndex('conversations_one_open_per_visitor').on(t.visitorId).where(sql`status in ('waiting', 'active')`),
    index('conversations_account_started_idx').on(t.accountId, t.startedAt),
  ],
);

export const messages = pgTable(
  'messages',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    conversationId: text('conversation_id').notNull().references(() => conversations.id),
    authorType: text('author_type', { enum: ['visitor', 'agent', 'bot', 'system'] }).notNull(),
    authorId: text('author_id'),
    authorName: text('author_name').notNull(),
    body: text('body').notNull(),
    internal: boolean('internal').notNull().default(false),
    clientId: text('client_id'),
    createdAt: createdAt(),
  },
  (t) => [
    index('messages_conversation_idx').on(t.conversationId, t.createdAt),
    // Retries of the same send (same clientId) are de-duplicated.
    uniqueIndex('messages_client_id_idx').on(t.conversationId, t.clientId),
  ],
);

/** Saved replies agents insert with "/" in the chat composer. */
export const shortcuts = pgTable(
  'shortcuts',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull().references(() => accounts.id),
    name: text('name').notNull(),
    message: text('message').notNull(),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    createdBy: text('created_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('shortcuts_account_name_idx').on(t.accountId, t.name)],
);

/** Messages visitors leave in the widget while no agent is online. Agents follow up by email. */
export const offlineMessages = pgTable(
  'offline_messages',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull().references(() => accounts.id),
    visitorId: text('visitor_id').notNull().references(() => visitors.id),
    name: text('name').notNull(),
    email: text('email').notNull(),
    phone: text('phone'),
    department: text('department'),
    message: text('message').notNull(),
    pageUrl: text('page_url'),
    status: text('status', { enum: ['new', 'handled'] }).notNull().default('new'),
    handledBy: text('handled_by').references(() => users.id),
    handledAt: timestamp('handled_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('offline_messages_account_idx').on(t.accountId, t.status, t.createdAt),
    index('offline_messages_visitor_idx').on(t.visitorId),
  ],
);

/** Emails agents sent in answer to an offline message. */
export const offlineReplies = pgTable(
  'offline_replies',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull().references(() => accounts.id),
    offlineMessageId: text('offline_message_id').notNull().references(() => offlineMessages.id),
    authorId: text('author_id').references(() => users.id),
    authorName: text('author_name').notNull(),
    toEmail: text('to_email').notNull(),
    body: text('body').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('offline_replies_message_idx').on(t.offlineMessageId, t.createdAt)],
);

/** AI suggest usage per account per month, for the spending cap and the meter. */
export const aiUsage = pgTable(
  'ai_usage',
  {
    accountId: text('account_id').notNull().references(() => accounts.id),
    month: text('month').notNull(), // YYYY-MM (UTC)
    suggestions: integer('suggestions').notNull().default(0),
    /** Cost in millionths of a dollar. */
    costMicros: bigint('cost_micros', { mode: 'number' }).notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.month] })],
);

/** Helpdesk tickets: requests that need follow-up beyond a live chat. */
export const tickets = pgTable(
  'tickets',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull().references(() => accounts.id),
    /** Per-account number agents and customers see (#1, #2, …). */
    number: integer('number').notNull(),
    subject: text('subject').notNull(),
    status: text('status', { enum: ['open', 'pending', 'solved'] }).notNull().default('open'),
    priority: text('priority', { enum: ['low', 'normal', 'high', 'urgent'] }).notNull().default('normal'),
    assigneeId: text('assignee_id').references(() => users.id),
    visitorId: text('visitor_id').references(() => visitors.id),
    requesterName: text('requester_name'),
    requesterEmail: text('requester_email'),
    /** Where it came from: typed in by an agent, a chat, an offline message, or an email to the support address. */
    source: text('source', { enum: ['manual', 'chat', 'offline', 'email'] }).notNull().default('manual'),
    sourceId: text('source_id'),
    createdBy: text('created_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    solvedAt: timestamp('solved_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('tickets_account_number_idx').on(t.accountId, t.number),
    index('tickets_account_status_idx').on(t.accountId, t.status, t.updatedAt),
    index('tickets_visitor_idx').on(t.visitorId),
  ],
);

/** A ticket's thread: the customer's words, emailed replies, agents-only notes and changes. */
export const ticketMessages = pgTable(
  'ticket_messages',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull().references(() => accounts.id),
    ticketId: text('ticket_id').notNull().references(() => tickets.id),
    kind: text('kind', { enum: ['customer', 'reply', 'note', 'event'] }).notNull(),
    authorId: text('author_id').references(() => users.id),
    authorName: text('author_name').notNull(),
    body: text('body').notNull(),
    emailedTo: text('emailed_to'),
    createdAt: createdAt(),
  },
  (t) => [index('ticket_messages_ticket_idx').on(t.ticketId, t.createdAt)],
);

/** Help center: groups of articles ("Shipping", "Returns"…). */
export const helpCategories = pgTable(
  'help_categories',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull().references(() => accounts.id),
    name: text('name').notNull(),
    position: integer('position').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index('help_categories_account_idx').on(t.accountId, t.position)],
);

/** Help center articles customers read on the public help site and in the chat widget. */
export const helpArticles = pgTable(
  'help_articles',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull().references(() => accounts.id),
    categoryId: text('category_id').references(() => helpCategories.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    /** The address part: /help/<account>/<slug>. Fixed once published, so shared links keep working. */
    slug: text('slug').notNull(),
    /** Simple Markdown. */
    body: text('body').notNull().default(''),
    status: text('status', { enum: ['draft', 'published'] }).notNull().default('draft'),
    views: integer('views').notNull().default(0),
    helpful: integer('helpful').notNull().default(0),
    notHelpful: integer('not_helpful').notNull().default(0),
    createdBy: text('created_by').references(() => users.id),
    updatedBy: text('updated_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('help_articles_account_slug_idx').on(t.accountId, t.slug),
    index('help_articles_account_status_idx').on(t.accountId, t.status),
  ],
);
