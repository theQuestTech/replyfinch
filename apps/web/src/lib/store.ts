import { create } from 'zustand';
import type { Conversation, LiveVisitor, Message, TeamMember } from '@replyfinch/shared';

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
  setMessages: (conversationId: string, m: Message[]) => void;
  addMessage: (m: Message) => void;
  setTyping: (conversationId: string, name: string | null) => void;
  setTeam: (t: TeamMember[]) => void;
  openChat: (visitorId: string, mode?: ChatMode) => void;
  setMode: (mode: ChatMode) => void;
  minimize: () => void;
  closeChat: (visitorId: string) => void;
  reset: () => void;
}

const initial = {
  connected: false,
  visitors: {},
  conversations: {},
  messages: {},
  typing: {},
  team: [],
  openTabs: [],
  active: null,
  unread: {},
};

export const useDesk = create<DeskState>((set, get) => ({
  ...initial,

  setConnected: (connected) => set({ connected }),

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
      const unread =
        visitorId && m.authorType === 'visitor' && !viewing
          ? { ...s.unread, [visitorId]: (s.unread[visitorId] ?? 0) + 1 }
          : s.unread;
      const typing = m.authorType === 'visitor' ? { ...s.typing, [m.conversationId]: null } : s.typing;
      const conversations =
        conv && m.authorType === 'visitor' ? { ...s.conversations, [conv.id]: { ...conv, preview: m.body, lastMessageAt: m.createdAt } } : s.conversations;
      return { messages, unread, typing, conversations };
    }),

  setTyping: (conversationId, name) => set((s) => ({ typing: { ...s.typing, [conversationId]: name } })),

  setTeam: (team) => set({ team }),

  openChat: (visitorId, mode) =>
    set((s) => ({
      openTabs: s.openTabs.includes(visitorId) ? s.openTabs : [...s.openTabs, visitorId],
      active: { visitorId, mode: mode ?? s.active?.mode ?? 'side' },
      unread: { ...s.unread, [visitorId]: 0 },
    })),

  setMode: (mode) => set((s) => (s.active ? { active: { ...s.active, mode } } : {})),

  minimize: () => set({ active: null }),

  closeChat: (visitorId) =>
    set((s) => {
      const openTabs = s.openTabs.filter((id) => id !== visitorId);
      const visitors = { ...s.visitors };
      if (visitors[visitorId]?.left) delete visitors[visitorId];
      const active =
        s.active?.visitorId === visitorId
          ? s.active.mode === 'main' && openTabs.length
            ? { visitorId: openTabs[openTabs.length - 1]!, mode: 'main' as const }
            : null
          : s.active;
      return { openTabs, visitors, active };
    }),

  reset: () => set({ ...initial }),
}));

export const selectVisitorConversation = (visitorId: string) => (s: DeskState) => {
  const v = s.visitors[visitorId];
  return v?.conversationId ? s.conversations[v.conversationId] : undefined;
};

// Used by the "type to join" handler to know which window is focused.
export const getActive = () => useDesk.getState().active;
