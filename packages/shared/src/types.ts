// Domain types shared by the API, the agent app and the widget.
// IDs are ULIDs with a type prefix (e.g. "vis_01J…") so they sort by time and are
// unique across database shards — see docs/PLAN.md "Scaling decisions".

export type VisitorState = 'chatting' | 'browsing' | 'idle';
export type DeviceType = 'desktop' | 'mobile' | 'tablet';
export type AgentStatus = 'online' | 'away' | 'offline';
export type ConversationStatus = 'waiting' | 'active' | 'ended';
export type AuthorType = 'visitor' | 'agent' | 'bot' | 'system';

export interface PageVisit {
  url: string;
  title: string;
  at: number; // epoch ms
}

/** A visitor as agents see it on the Visitors screen (live presence + profile). */
export interface LiveVisitor {
  id: string;
  accountId: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  tags: string[];
  country: string | null;
  timezone: string | null;
  browser: string;
  os: string;
  device: DeviceType;
  referrer: string | null;
  onlineSince: number;
  lastActivityAt: number;
  lastSeenAt: number;
  currentPage: PageVisit | null;
  /** Pages viewed in this session, oldest first (capped). */
  path: PageVisit[];
  visits: number;
  pastChats: number;
  conversationId: string | null;
  state: VisitorState;
}

export interface Conversation {
  id: string;
  accountId: string;
  visitorId: string;
  visitorName: string | null;
  status: ConversationStatus;
  assigneeId: string | null;
  assigneeName: string | null;
  participantIds: string[];
  department: string | null;
  startedAt: number;
  firstReplyAt: number | null;
  endedAt: number | null;
  lastMessageAt: number;
  /** The visitor's latest message, for queue previews. */
  preview: string | null;
  /** How the visitor rated the chat once it ended. */
  rating: Rating | null;
  ratingComment: string | null;
}

export type Rating = 'good' | 'bad';

export interface Message {
  id: string;
  conversationId: string;
  authorType: AuthorType;
  authorId: string | null;
  authorName: string;
  body: string;
  /** Internal notes are only visible to agents. */
  internal: boolean;
  clientId: string | null;
  createdAt: number;
}

export interface Agent {
  id: string;
  accountId: string;
  name: string;
  email: string;
  role: 'admin' | 'agent';
  /** Runs the Replyfinch service itself: can create customer accounts. */
  platformAdmin?: boolean;
}

export interface TeamMember extends Agent {
  status: AgentStatus;
  activeChats: number;
  maxChats: number;
}

export interface HomeStats {
  waiting: number;
  open: number;
  assignedToMe: number;
  avgFirstReplySeconds: number | null;
  conversationsToday: number;
  chatsByHour: { hour: number; count: number }[];
  visitorsOnline: number;
}

export const DEFAULT_DEPARTMENTS = ['Orders & shipping', 'Billing', 'Technical support', 'Sales'];

/** How the website chat widget looks and what it asks. Admins edit it in Settings → Chat widget. */
export interface WidgetSettings {
  /** Theme color (#rrggbb) for the header, bubble and buttons; null keeps the Replyfinch look. */
  color: string | null;
  position: 'right' | 'left';
  /** Shown above the pre-chat form. */
  greeting: string;
  /** Shown above the leave-a-message form when nobody is online. */
  offlineGreeting: string;
  /** Chat topics: agents transfer chats to them, and visitors can pick one (see departmentField). */
  departments: string[];
  /** Ask visitors to pick a department on the pre-chat form. */
  departmentField: 'shown' | 'hidden';
  /** The phone number field on the pre-chat and leave-a-message forms. */
  phoneField: 'optional' | 'required' | 'hidden';
  /** The email field on the pre-chat form (the leave-a-message form always asks for it). */
  emailField: 'optional' | 'required' | 'hidden';
  /** Ask visitors to rate the chat when it ends. */
  ratings: boolean;
  /** Agents see what a visitor is typing before they send it ("sneak peek"). */
  typingPreview: boolean;
  /** Let visitors search published help articles in the widget before they chat. */
  helpSearch: boolean;
}

export const DEFAULT_WIDGET_SETTINGS: WidgetSettings = {
  color: null,
  position: 'right',
  greeting: "Hi there 👋 Tell us a little about you and we'll connect you with the right team.",
  offlineGreeting: "We're not online right now. Leave a message and we'll get back to you by email.",
  departments: DEFAULT_DEPARTMENTS,
  departmentField: 'hidden',
  phoneField: 'optional',
  emailField: 'optional',
  ratings: true,
  typingPreview: true,
  helpSearch: true,
};

export interface WidgetConfig extends WidgetSettings {
  accountName: string;
  agentsOnline: number;
  /** Email is set up, so visitors can ask for a copy of their chat. */
  emailTranscripts?: boolean;
  /** Published help articles (the widget offers article search when there are some). */
  helpArticles?: number;
}

/** A saved reply. Agents insert it in the composer with "/name". */
export interface Shortcut {
  id: string;
  name: string;
  message: string;
  tags: string[];
  updatedAt: number;
}

/** A message left in the widget while no agent was online. */
export interface OfflineMessage {
  id: string;
  visitorId: string;
  name: string;
  email: string;
  phone: string | null;
  department: string | null;
  message: string;
  pageUrl: string | null;
  status: 'new' | 'handled';
  handledById: string | null;
  handledByName: string | null;
  handledAt: number | null;
  createdAt: number;
}

/** One row of the chat History page. */
export interface HistoryEntry {
  id: string;
  visitorId: string;
  visitorName: string | null;
  visitorEmail: string | null;
  status: ConversationStatus;
  assigneeId: string | null;
  assigneeName: string | null;
  department: string | null;
  startedAt: number;
  endedAt: number | null;
  firstReplyAt: number | null;
  /** Messages from the visitor and agents (not system notes). */
  messageCount: number;
  /** The visitor's first message. */
  preview: string | null;
  rating: Rating | null;
  ratingComment: string | null;
}

export interface HistoryPage {
  items: HistoryEntry[];
  /** Pass back as ?cursor= to load older chats; null when there are no more. */
  nextCursor: string | null;
}

/** Numbers for one period on the Reports page. */
export interface ReportSummary {
  chats: number;
  /** Chats visitors started (agents can also start chats). */
  visitorChats: number;
  /** Visitor chats that ended before any agent replied. */
  missed: number;
  avgFirstReplySeconds: number | null;
  avgDurationSeconds: number | null;
  good: number;
  bad: number;
  offlineMessages: number;
}

export interface Report {
  days: number;
  timezone: string;
  /** First and last day of the period (YYYY-MM-DD, in `timezone`). */
  from: string;
  to: string;
  current: ReportSummary;
  /** The same number of days just before, for comparison. */
  previous: ReportSummary;
  byDay: { date: string; answered: number; missed: number }[];
  /** Visitor chats by hour of day (0–23), in `timezone`. */
  byHour: number[];
  departments: { name: string; chats: number }[];
  agents: {
    id: string;
    name: string;
    chats: number;
    avgFirstReplySeconds: number | null;
    avgDurationSeconds: number | null;
    good: number;
    bad: number;
  }[];
}

/** A row on the Customers page: anyone who chatted, left a message, or was named. */
export interface CustomerSummary {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  tags: string[];
  country: string | null;
  visits: number;
  firstSeenAt: number;
  lastSeenAt: number;
  chats: number;
  lastChatAt: number | null;
  good: number;
  bad: number;
  offlineMessages: number;
}

export interface CustomerList {
  items: CustomerSummary[];
  total: number;
}

export interface CustomerProfile {
  customer: CustomerSummary & {
    notes: string | null;
    timezone: string | null;
    browser: string | null;
    os: string | null;
    device: string | null;
  };
  conversations: HistoryEntry[];
  offlineMessages: OfflineMessage[];
  tickets: Ticket[];
  /** Most recent pages first. */
  pages: { url: string; title: string; at: number }[];
}

/** An email an agent sent in answer to an offline message. */
export interface OfflineReply {
  id: string;
  authorName: string;
  body: string;
  to: string;
  createdAt: number;
}

export interface EmailStatus {
  enabled: boolean;
  from: string | null;
  replyTo: string | null;
  /** Receiving email: customers' replies come back into tickets. */
  inbound?: { enabled: boolean; supportAddress: string | null };
}

/** Settings → AI assistant (admins). */
export interface AiSettings {
  /** Company facts, policies and tone the AI may use when drafting replies. */
  knowledge: string;
  /** Hard monthly spending limit for AI mode, in US dollars. */
  monthlyCapUsd: number;
}

export const DEFAULT_AI_SETTINGS: AiSettings = { knowledge: '', monthlyCapUsd: 10 };

export interface AiStatus {
  /** "claude" once an Anthropic API key is set on the server; otherwise free mode (best saved reply). */
  engine: 'claude' | 'shortcuts';
  model: string | null;
  /** YYYY-MM (UTC) */
  month: string;
  suggestions: number;
  spentUsd: number;
}

export interface AiSuggestion {
  text: string | null;
  engine: 'claude' | 'shortcuts';
  /** Free mode: which saved reply was used. */
  shortcutName?: string;
  /** Why there is no text, or why free mode was used instead of AI. */
  note?: 'no_match' | 'budget_reached' | 'ai_unavailable' | 'ai_declined';
}

export type TicketStatus = 'open' | 'pending' | 'solved';
export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent';
export type TicketView = 'unsolved' | 'mine' | 'unassigned' | 'open' | 'pending' | 'solved' | 'all';

export interface Ticket {
  id: string;
  number: number;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  assigneeId: string | null;
  assigneeName: string | null;
  visitorId: string | null;
  requesterName: string | null;
  requesterEmail: string | null;
  source: 'manual' | 'chat' | 'offline' | 'email' | 'website' | 'api';
  sourceId: string | null;
  createdByName: string | null;
  createdAt: number;
  updatedAt: number;
  solvedAt: number | null;
}

export interface TicketMessage {
  id: string;
  /** customer: their words · reply: emailed to them · note: agents only · event: a change (status, assignee…) */
  kind: 'customer' | 'reply' | 'note' | 'event';
  authorId: string | null;
  authorName: string;
  body: string;
  emailedTo: string | null;
  createdAt: number;
}

export interface TicketList {
  items: Ticket[];
  total: number;
}

/** Ticket counts for each view in the sidebar. */
export type TicketCounts = Record<TicketView, number>;

export interface HelpCategory {
  id: string;
  name: string;
  position: number;
  /** All articles, drafts included (agent side). */
  articles: number;
}

/** An article as agents see it in the Help center list. */
export interface HelpArticleSummary {
  id: string;
  title: string;
  slug: string;
  categoryId: string | null;
  status: 'draft' | 'published';
  views: number;
  helpful: number;
  notHelpful: number;
  updatedAt: number;
  updatedByName: string | null;
  publishedAt: number | null;
}

export interface HelpArticle extends HelpArticleSummary {
  body: string;
}

/** What customers see: published articles only. */
export interface PublicHelpArticleSummary {
  slug: string;
  title: string;
  /** The first words of the article, as plain text. */
  excerpt: string;
  categoryName: string | null;
}

export interface PublicHelpArticle {
  slug: string;
  title: string;
  /** Simple Markdown; render with renderMarkdown from @replyfinch/shared/markdown. */
  body: string;
  categoryName: string | null;
  updatedAt: number;
  related: PublicHelpArticleSummary[];
}

export interface PublicHelpCenter {
  accountName: string;
  color: string | null;
  categories: { id: string | null; name: string; articles: PublicHelpArticleSummary[] }[];
  popular: PublicHelpArticleSummary[];
}

// ---------------------------------------------------------------- integrations (public API)

export const WEBHOOK_EVENTS = [
  'chat.started',
  'chat.ended',
  'chat.rated',
  'offline_message.created',
  'ticket.created',
  'ticket.status_changed',
  'ticket.customer_replied',
] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number];

export const WEBHOOK_EVENT_LABELS: Record<WebhookEventType, string> = {
  'chat.started': 'A chat started',
  'chat.ended': 'A chat ended (with the transcript)',
  'chat.rated': 'A visitor rated a chat',
  'offline_message.created': 'A visitor left an offline message',
  'ticket.created': 'A ticket was created',
  'ticket.status_changed': 'A ticket’s status changed',
  'ticket.customer_replied': 'A customer replied to a ticket by email',
};

/** The person behind a chat or ticket. */
export interface EventCustomer {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
}

export interface ChatEventData {
  conversation: Conversation;
  customer: EventCustomer;
  /** chat.ended: the visible transcript (agents-only notes left out). */
  messages?: Message[];
}

export interface TicketEventData {
  ticket: Ticket;
  /** ticket.status_changed */
  previousStatus?: TicketStatus;
  /** ticket.customer_replied */
  message?: TicketMessage;
}

/** What Replyfinch POSTs to a webhook. */
export interface WebhookEvent<T = unknown> {
  id: string;
  type: WebhookEventType | 'ping';
  createdAt: string;
  accountId: string;
  data: T;
}

export interface Webhook {
  id: string;
  url: string;
  events: WebhookEventType[];
  description: string;
  enabled: boolean;
  source: 'settings' | 'api';
  /** Shown so the receiver can check signatures. */
  secret: string;
  lastStatus: number | null;
  lastError: string | null;
  lastDeliveryAt: number | null;
  failingSince: number | null;
  createdAt: number;
}

export interface WebhookDelivery {
  id: string;
  eventId: string;
  type: string;
  status: 'pending' | 'sending' | 'succeeded' | 'failed';
  attempts: number;
  responseStatus: number | null;
  responseBody: string | null;
  error: string | null;
  createdAt: number;
  nextAttemptAt: number | null;
  deliveredAt: number | null;
  payload: WebhookEvent;
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  createdAt: number;
  lastUsedAt: number | null;
  createdByName: string | null;
}

/** A customer workspace, on the platform admin's Accounts page. */
export interface PlatformAccount {
  id: string;
  name: string;
  createdAt: number;
  users: number;
  admins: { id: string; name: string; email: string; passwordSet: boolean }[];
  chats30d: number;
  lastActivityAt: number | null;
}

export interface PlatformAccountCreated {
  account: { id: string; name: string };
  admin: { id: string; name: string; email: string };
  /** The "set your password" link (also emailed when email works). */
  setPasswordUrl: string;
  emailed: boolean;
}

/** What a password link is for, shown before choosing the password. */
export interface PasswordLinkInfo {
  purpose: 'reset' | 'welcome';
  name: string;
  email: string;
  accountName: string;
}
