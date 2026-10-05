// Socket.IO event contracts. Two namespaces:
//   /visitor — the website widget
//   /agent   — the agent app
import type { AgentStatus, AuthorType, Conversation, LiveVisitor, Message, TeamMember } from './types';

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
}

export interface VisitorServerEvents {
  /** An open chat to show (on reconnect, from another tab, or started by an agent). */
  'chat:resume': (p: { conversation: Conversation; messages: Message[]; proactive?: boolean }) => void;
  'message:new': (m: Message) => void;
  typing: (p: TypingPayload) => void;
  'chat:ended': (p: { conversationId: string }) => void;
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
}
