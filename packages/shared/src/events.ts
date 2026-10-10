// Socket.IO event contracts. Two namespaces:
//   /visitor — the website widget
//   /agent   — the agent app
import type { AgentStatus, AuthorType, Conversation, LiveVisitor, Message, OfflineMessage, TeamMember } from './types';

export interface TypingPayload {
  conversationId: string;
  authorType: AuthorType;
  name: string;
  isTyping: boolean;
}

export type Ack<T> = (res: { ok: true; data: T } | { ok: false; error: string }) => void;

// ---------- /visitor ----------
export interface VisitorClientEvents {
  'visitor:page': (p: { url: string; title: string; referrer?: string | null }) => void;
  'visitor:activity': () => void;
  /** Keeps the visitor listed as online; sent every HEARTBEAT_INTERVAL_MS. */
  'visitor:heartbeat': () => void;
  'chat:start': (
    p: { name: string; email?: string; department?: string; message: string; clientId: string },
    ack: Ack<{ conversation: Conversation; messages: Message[] }>,
  ) => void;
  'message:send': (p: { conversationId: string; body: string; clientId: string }, ack: Ack<Message>) => void;
  typing: (p: { conversationId: string; isTyping: boolean }) => void;
  'chat:end': (p: { conversationId: string }) => void;
  /** Rate an ended chat (again to change the rating). */
  'chat:rate': (p: { conversationId: string; rating: 'good' | 'bad'; comment?: string }, ack: Ack<{ ok: true }>) => void;
  /** Leave a message while no agent is online. */
  'offline:send': (
    p: { name: string; email: string; department?: string; message: string; pageUrl?: string },
    ack: Ack<{ id: string }>,
  ) => void;
}

export interface VisitorServerEvents {
  /** An open chat to show (on reconnect, from another tab, or started by an agent). */
  'chat:resume': (p: { conversation: Conversation; messages: Message[]; proactive?: boolean }) => void;
  'message:new': (m: Message) => void;
  typing: (p: TypingPayload) => void;
  'chat:ended': (p: { conversationId: string }) => void;
  /** Whether any agent is online (status "online", not away) — switches the widget between chat and leave-a-message. */
  'agents:availability': (p: { online: boolean }) => void;
}

// ---------- /agent ----------
export interface AgentClientEvents {
  /** Start viewing a conversation (receive its messages and typing). Does NOT join it. */
  'conversation:watch': (p: { conversationId: string }, ack: Ack<{ conversation: Conversation; messages: Message[] }>) => void;
  'conversation:unwatch': (p: { conversationId: string }) => void;
  /** Sending the first message is what "joins" the chat. */
  'message:send': (
    p: { conversationId: string; body: string; clientId: string; internal?: boolean },
    ack: Ack<Message>,
  ) => void;
  /** Proactively start a chat with a visitor who is only browsing. */
  'chat:initiate': (
    p: { visitorId: string; body: string; clientId: string },
    ack: Ack<{ conversation: Conversation; messages: Message[] }>,
  ) => void;
  typing: (p: { conversationId: string; isTyping: boolean }) => void;
  'chat:end': (p: { conversationId: string }) => void;
  /** Hand an open chat to another agent, or back to the queue for a department. */
  'chat:transfer': (
    p: { conversationId: string; toAgentId?: string; department?: string; note?: string },
    ack: Ack<Conversation>,
  ) => void;
  'agent:status': (p: { status: AgentStatus }) => void;
}

export interface AgentServerEvents {
  'visitors:snapshot': (v: LiveVisitor[]) => void;
  'visitor:update': (v: LiveVisitor) => void;
  'visitor:remove': (p: { id: string }) => void;
  'conversation:update': (c: Conversation) => void;
  'message:new': (m: Message) => void;
  typing: (p: TypingPayload) => void;
  'team:update': (t: TeamMember[]) => void;
  /** A chat was transferred to you. */
  'chat:transferred': (p: { conversation: Conversation; fromName: string; note: string | null }) => void;
  /** A visitor left a message while nobody was online. */
  'offline:new': (m: OfflineMessage) => void;
  /** An offline message was marked handled or reopened. */
  'offline:update': (m: OfflineMessage) => void;
}
