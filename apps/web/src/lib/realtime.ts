import { useEffect } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { AgentClientEvents, AgentServerEvents, AgentStatus } from '@replyfinch/shared';
import type { Conversation } from '@replyfinch/shared';
import { api, API_URL } from './api';
import { useAuth } from './auth';
import { useDesk } from './store';
import { alertAgent } from './notify';
import { visitorLabel } from './format';
import { queryClient } from './query';

const myStatus = () => {
  const me = useAuth.getState().agent?.id;
  return useDesk.getState().team.find((t) => t.id === me)?.status ?? 'online';
};

export type AgentSocket = Socket<AgentServerEvents, AgentClientEvents>;

let socket: AgentSocket | null = null;
export const getSocket = () => socket;

/** Connects the agent socket while logged in and mirrors server events into the store. */
/** Client-side navigation from outside React (react-router listens for popstate). */
export function goTo(path: string) {
  if (useDesk.getState().active) useDesk.getState().minimize(); // show the page, not a chat over it
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function useRealtime() {
  const token = useAuth((s) => s.token);

  useEffect(() => {
    if (!token) return;
    const s: AgentSocket = io(`${API_URL}/agent`, { auth: { token }, transports: ['websocket', 'polling'] });
    socket = s;
    const desk = useDesk.getState();

    s.on('connect', () => {
      desk.setConnected(true);
      // Open chats (waiting + active) for the live queue and visitor windows.
      api<Conversation[]>('/conversations')
        .then((list) => useDesk.getState().replaceOpenConversations(list))
        .catch(() => {});
    });
    s.on('disconnect', () => desk.setConnected(false));
    s.on('connect_error', (err) => {
      if (err.message === 'unauthorized') useAuth.getState().logout();
    });
    s.on('visitors:snapshot', (v) => useDesk.getState().setVisitors(v));
    s.on('visitor:update', (v) => useDesk.getState().upsertVisitor(v));
    s.on('visitor:remove', ({ id }) => useDesk.getState().removeVisitor(id));
    s.on('conversation:update', (c) => {
      const prev = useDesk.getState().conversations[c.id];
      useDesk.getState().upsertConversation(c);
      // New in the queue — or back in it after a transfer to a department.
      if (c.status === 'waiting' && (!prev || prev.status !== 'waiting')) {
        const v = useDesk.getState().visitors[c.visitorId];
        const who = c.visitorName ?? (v ? visitorLabel(v) : 'A visitor');
        alertAgent({
          kind: 'new-chat',
          agentStatus: myStatus(),
          viewingThisChat: false,
          title: `New chat from ${who}`,
          body: c.preview ?? (c.department ? `${c.department} · waiting for an agent` : 'Waiting for an agent'),
          tag: `chat-${c.id}`,
          onClick: () => useDesk.getState().openChat(c.visitorId, 'side'),
        });
      }
    });
    s.on('message:new', (m) => {
      const desk = useDesk.getState();
      desk.addMessage(m);
      if (m.authorType !== 'visitor') return;
      const c = desk.conversations[m.conversationId];
      const me = useAuth.getState().agent?.id;
      // Alert for chats you're in, and for chats still waiting for anyone.
      if (!c || !(c.participantIds.includes(me ?? '') || c.status === 'waiting')) return;
      if (Date.now() - c.startedAt < 3000) return; // the first message already rang as "new chat"
      alertAgent({
        kind: 'message',
        agentStatus: myStatus(),
        viewingThisChat: desk.active?.visitorId === c.visitorId,
        title: m.authorName,
        body: m.body,
        tag: `chat-${c.id}`,
        onClick: () => useDesk.getState().openChat(c.visitorId, 'side'),
      });
    });
    s.on('chat:transferred', ({ conversation: c, fromName, note }) => {
      const desk = useDesk.getState();
      desk.upsertConversation(c);
      desk.addTab(c.visitorId);
      const v = desk.visitors[c.visitorId];
      const who = c.visitorName ?? (v ? visitorLabel(v) : 'a visitor');
      alertAgent({
        kind: 'new-chat',
        agentStatus: myStatus(),
        viewingThisChat: false,
        title: `${fromName} transferred ${who} to you`,
        body: note ?? c.preview ?? 'Open the chat to reply',
        tag: `chat-${c.id}`,
        onClick: () => useDesk.getState().openChat(c.visitorId, 'side'),
      });
    });
    s.on('team:update', (t) => useDesk.getState().setTeam(t));
    s.on('offline:update', () => void queryClient.invalidateQueries({ queryKey: ['offline'] }));
    s.on('offline:new', (m) => {
      void queryClient.invalidateQueries({ queryKey: ['offline'] });
      alertAgent({
        kind: 'offline-message',
        agentStatus: myStatus(),
        viewingThisChat: false,
        title: `Offline message from ${m.name}`,
        body: m.message,
        tag: `offline-${m.id}`,
        onClick: () => goTo(`/inbox?m=${m.id}`),
      });
    });
    s.on('ticket:update', (t) => {
      void queryClient.invalidateQueries({ queryKey: ['tickets'] });
      void queryClient.invalidateQueries({ queryKey: ['ticket', t.id] });
      if (t.visitorId) void queryClient.invalidateQueries({ queryKey: ['customer', t.visitorId] });
    });
    s.on('ticket:customer-email', ({ ticket, kind, from, preview }) => {
      void queryClient.invalidateQueries({ queryKey: ['tickets'] });
      void queryClient.invalidateQueries({ queryKey: ['ticket', ticket.id] });
      alertAgent({
        kind: 'ticket',
        agentStatus: myStatus(),
        viewingThisChat: false,
        title:
          kind === 'reply'
            ? `${from} replied to ticket #${ticket.number}`
            : ticket.source === 'website'
              ? `${from} asked for early access (ticket #${ticket.number})`
              : `New ticket #${ticket.number} by email from ${from}`,
        body: preview,
        tag: `ticket-email-${ticket.id}`,
        onClick: () => goTo(`/tickets/${ticket.id}`),
      });
    });
    s.on('ticket:assigned', ({ ticket, byName }) =>
      alertAgent({
        kind: 'ticket',
        agentStatus: myStatus(),
        viewingThisChat: false,
        title: `${byName} assigned ticket #${ticket.number} to you`,
        body: ticket.subject,
        tag: `ticket-${ticket.id}`,
        onClick: () => goTo(`/tickets/${ticket.id}`),
      }),
    );
    s.on('typing:preview', ({ conversationId, text }) => useDesk.getState().setPreview(conversationId, text));
    s.on('typing', (t) => {
      if (t.authorType !== 'visitor') return;
      useDesk.getState().setTyping(t.conversationId, t.isTyping ? t.name : null);
    });

    return () => {
      s.removeAllListeners();
      s.disconnect();
      socket = null;
      useDesk.getState().reset();
    };
  }, [token]);
}

export function setAgentStatus(status: AgentStatus) {
  socket?.emit('agent:status', { status });
}
