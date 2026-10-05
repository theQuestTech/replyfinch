import { create } from 'zustand';
import type { Agent } from '@replyfinch/shared';

const KEY = 'rf_agent_session';

interface AuthState {
  token: string | null;
  agent: Agent | null;
  login: (token: string, agent: Agent) => void;
  logout: () => void;
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
    try {
      localStorage.setItem(KEY, JSON.stringify({ token, agent }));
    } catch {
      /* ignore */
    }
    set({ token, agent });
  },
  logout: () => {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    set({ token: null, agent: null });
  },
}));
