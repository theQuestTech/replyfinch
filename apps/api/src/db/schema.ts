import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import type { WidgetSettings } from '@replyfinch/shared';

// Every tenant-owned table carries account_id so customers can later be split
// across database clusters ("cells") without a rewrite.

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const accounts = pgTable('accounts', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /** Chat widget look and questions; null until an admin saves them (defaults apply). */
  widgetSettings: jsonb('widget_settings').$type<Partial<WidgetSettings>>(),
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
  (t) => [index('visitors_account_idx').on(t.accountId)],
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
    department: text('department'),
    message: text('message').notNull(),
    pageUrl: text('page_url'),
    status: text('status', { enum: ['new', 'handled'] }).notNull().default('new'),
    handledBy: text('handled_by').references(() => users.id),
    handledAt: timestamp('handled_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('offline_messages_account_idx').on(t.accountId, t.status, t.createdAt)],
);
