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
}

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
  /** Visitors pick one before chatting; empty hides the question. Also the targets for transfers. */
  departments: string[];
  /** The email field on the pre-chat form (the leave-a-message form always asks for it). */
  emailField: 'optional' | 'required' | 'hidden';
}

export const DEFAULT_WIDGET_SETTINGS: WidgetSettings = {
  color: null,
  position: 'right',
  greeting: "Hi there 👋 Tell us a little about you and we'll connect you with the right team.",
  offlineGreeting: "We're not online right now. Leave a message and we'll get back to you by email.",
  departments: DEFAULT_DEPARTMENTS,
  emailField: 'optional',
};

export interface WidgetConfig extends WidgetSettings {
  accountName: string;
  agentsOnline: number;
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
}

export interface HistoryPage {
  items: HistoryEntry[];
  /** Pass back as ?cursor= to load older chats; null when there are no more. */
  nextCursor: string | null;
}
