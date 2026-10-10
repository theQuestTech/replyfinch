import { create } from 'zustand';
import type { Agent } from '@replyfinch/shared';
import { queryClient } from './query';

const KEY = 'rf_agent_session';

interface AuthState {
  token: string | null;
  agent: Agent | null;
  login: (token: string, agent: Agent) => void;
  logout: () => void;
  setAgent: (agent: Agent) => void;
}

function load(): Pick<AuthState, 'token' | 'agent'> {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Pick<AuthState, 'token' | 'agent'>;
  } catch {
    /* ignore */
  }
  return { token: null, agent: null };
}

export const useAuth = create<AuthState>((set) => ({
  ...load(),
  login: (token, agent) => {
    // Another person (or account) signing in must never see the previous one's cached data.
    if (useAuth.getState().agent?.id !== agent.id) queryClient.clear();
    try {
      localStorage.setItem(KEY, JSON.stringify({ token, agent }));
    } catch {
      /* ignore */
    }
    set({ token, agent });
  },
  setAgent: (agent) => {
    set((s) => {
      try {
        localStorage.setItem(KEY, JSON.stringify({ token: s.token, agent }));
      } catch {
        /* ignore */
      }
      return { agent };
    });
  },
  logout: () => {
    queryClient.clear();
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    set({ token: null, agent: null });
  },
}));
