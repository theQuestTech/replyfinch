import { useEffect } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { AgentClientEvents, AgentServerEvents, AgentStatus } from '@replyfinch/shared';
import type { Conversation } from '@replyfinch/shared';
import { api, API_URL } from './api';
import { useAuth } from './auth';
import { useDesk } from './store';
import { alertAgent } from './notify';
import { visitorLabel } from './format';

const myStatus = () => {
  const me = useAuth.getState().agent?.id;
  return useDesk.getState().team.find((t) => t.id === me)?.status ?? 'online';
};

export type AgentSocket = Socket<AgentServerEvents, AgentClientEvents>;

let socket: AgentSocket | null = null;
export const getSocket = () => socket;

/** Connects the agent socket while logged in and mirrors server events into the store. */
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
        .then((list) => list.forEach((c) => useDesk.getState().upsertConversation(c)))
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
      const isNew = !useDesk.getState().conversations[c.id];
      useDesk.getState().upsertConversation(c);
      if (isNew && c.status === 'waiting') {
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
    s.on('team:update', (t) => useDesk.getState().setTeam(t));
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
