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

export interface WidgetConfig {
  accountName: string;
  departments: string[];
  agentsOnline: number;
}
