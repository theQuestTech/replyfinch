import { create } from 'zustand';
import type { Conversation, LiveVisitor, Message, TeamMember } from '@replyfinch/shared';
import { useAuth } from './auth';

export type DeskVisitor = LiveVisitor & {
  /** Visitor left the site while their chat window was open — keep showing it. */
  left?: boolean;
};

export type ChatMode = 'side' | 'main';

interface DeskState {
  connected: boolean;
  visitors: Record<string, DeskVisitor>;
  conversations: Record<string, Conversation>;
  messages: Record<string, Message[]>;
  /** conversationId → name of the visitor currently typing */
  typing: Record<string, string | null>;
  /** conversationId → what the visitor has typed but not sent yet (typing preview) */
  preview: Record<string, string>;
  team: TeamMember[];
  /** Visitors whose chat windows are open (the dock / tabs), in open order. */
  openTabs: string[];
  active: { visitorId: string; mode: ChatMode } | null;
  unread: Record<string, number>;

  setConnected: (c: boolean) => void;
  setVisitors: (v: LiveVisitor[]) => void;
  upsertVisitor: (v: LiveVisitor) => void;
  removeVisitor: (id: string) => void;
  upsertConversation: (c: Conversation) => void;
  /** After (re)connecting: the server's list of open chats replaces ours. */
  replaceOpenConversations: (list: Conversation[]) => void;
  /** Bumped on every (re)connect so open windows reload their messages. */
  connectedAt: number;
  setMessages: (conversationId: string, m: Message[]) => void;
  addMessage: (m: Message) => void;
  setTyping: (conversationId: string, name: string | null) => void;
  setPreview: (conversationId: string, text: string) => void;
  setTeam: (t: TeamMember[]) => void;
  openChat: (visitorId: string, mode?: ChatMode) => void;
  /** Put a chat in the dock (with an unread mark) without opening it. */
  addTab: (visitorId: string) => void;
  setMode: (mode: ChatMode) => void;
  minimize: () => void;
  closeChat: (visitorId: string) => void;
  reset: () => void;
}

const initial = {
  connected: false,
  connectedAt: 0,
  visitors: {},
  conversations: {},
  messages: {},
  typing: {},
  preview: {},
  team: [],
  openTabs: [],
  active: null,
  unread: {},
};

export const useDesk = create<DeskState>((set, get) => ({
  ...initial,

  setConnected: (connected) => set(connected ? { connected, connectedAt: Date.now() } : { connected }),

  replaceOpenConversations: (list) =>
    set((s) => {
      const conversations: Record<string, Conversation> = {};
      // Keep ended chats we already know (open windows still show them)...
      for (const c of Object.values(s.conversations)) if (c.status === 'ended') conversations[c.id] = c;
      // ...and mark chats that ended while we were offline as ended.
      const open = new Set(list.map((c) => c.id));
      for (const c of Object.values(s.conversations)) if (c.status !== 'ended' && !open.has(c.id)) conversations[c.id] = { ...c, status: 'ended' };
      for (const c of list) conversations[c.id] = c;
      return { conversations };
    }),

  setVisitors: (list) =>
    set((s) => {
      const visitors: Record<string, DeskVisitor> = {};
      for (const v of list) visitors[v.id] = v;
      // keep windows of visitors who are no longer online
      for (const id of s.openTabs) if (!visitors[id] && s.visitors[id]) visitors[id] = { ...s.visitors[id]!, left: true };
      return { visitors };
    }),

  upsertVisitor: (v) => set((s) => ({ visitors: { ...s.visitors, [v.id]: v } })),

  removeVisitor: (id) =>
    set((s) => {
      const visitors = { ...s.visitors };
      if (s.openTabs.includes(id) && visitors[id]) visitors[id] = { ...visitors[id]!, left: true };
      else delete visitors[id];
      return { visitors };
    }),

  upsertConversation: (c) => set((s) => ({ conversations: { ...s.conversations, [c.id]: c } })),

  setMessages: (conversationId, m) => set((s) => ({ messages: { ...s.messages, [conversationId]: m } })),

  addMessage: (m) =>
    set((s) => {
      const list = s.messages[m.conversationId];
      const messages = list
        ? list.some((x) => x.id === m.id)
          ? s.messages
          : { ...s.messages, [m.conversationId]: [...list, m] }
        : s.messages;
      const conv = s.conversations[m.conversationId];
      const visitorId = conv?.visitorId;
      const viewing = visitorId && s.active?.visitorId === visitorId && document.visibilityState === 'visible';
      // Count unread only for chats that concern me: open in my dock, mine, or still waiting for anyone.
      const me = useAuth.getState().agent?.id ?? '';
      const concernsMe = !!visitorId && (s.openTabs.includes(visitorId) || conv?.status === 'waiting' || !!conv?.participantIds.includes(me));
      const unread =
        visitorId && m.authorType === 'visitor' && !viewing && concernsMe
          ? { ...s.unread, [visitorId]: (s.unread[visitorId] ?? 0) + 1 }
          : s.unread;
      const typing = m.authorType === 'visitor' ? { ...s.typing, [m.conversationId]: null } : s.typing;
      const preview = m.authorType === 'visitor' ? { ...s.preview, [m.conversationId]: '' } : s.preview;
      const conversations =
        conv && m.authorType === 'visitor' ? { ...s.conversations, [conv.id]: { ...conv, preview: m.body, lastMessageAt: m.createdAt } } : s.conversations;
      return { messages, unread, typing, preview, conversations };
    }),

  setTyping: (conversationId, name) =>
    set((s) => ({
      typing: { ...s.typing, [conversationId]: name },
      // Stopped typing: the preview goes too.
      ...(name ? {} : { preview: { ...s.preview, [conversationId]: '' } }),
    })),

  setPreview: (conversationId, text) => set((s) => ({ preview: { ...s.preview, [conversationId]: text } })),

  setTeam: (team) => set({ team }),

  openChat: (visitorId, mode) =>
    set((s) => ({
      openTabs: s.openTabs.includes(visitorId) ? s.openTabs : [...s.openTabs, visitorId],
      active: { visitorId, mode: mode ?? s.active?.mode ?? 'side' },
      unread: { ...s.unread, [visitorId]: 0 },
    })),

  addTab: (visitorId) =>
    set((s) =>
      s.openTabs.includes(visitorId)
        ? {}
        : { openTabs: [...s.openTabs, visitorId], unread: { ...s.unread, [visitorId]: (s.unread[visitorId] ?? 0) + 1 } },
    ),

  setMode: (mode) => set((s) => (s.active ? { active: { ...s.active, mode } } : {})),

  minimize: () => set({ active: null }),

  closeChat: (visitorId) =>
    set((s) => {
      const openTabs = s.openTabs.filter((id) => id !== visitorId);
      const unread = { ...s.unread };
      delete unread[visitorId];
      const visitors = { ...s.visitors };
      if (visitors[visitorId]?.left) delete visitors[visitorId];
      const active =
        s.active?.visitorId === visitorId
          ? s.active.mode === 'main' && openTabs.length
            ? { visitorId: openTabs[openTabs.length - 1]!, mode: 'main' as const }
            : null
          : s.active;
      return { openTabs, visitors, active, unread };
    }),

  reset: () => set({ ...initial }),
}));

export const selectVisitorConversation = (visitorId: string) => (s: DeskState) => {
  const v = s.visitors[visitorId];
  return v?.conversationId ? s.conversations[v.conversationId] : undefined;
};

// Used by the "type to join" handler to know which window is focused.
export const getActive = () => useDesk.getState().active;
