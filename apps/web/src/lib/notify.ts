import { create } from 'zustand';
import type { AgentStatus } from '@replyfinch/shared';

// ---------------------------------------------------------------- preferences
export interface NotifyPrefs {
  sound: boolean;
  desktop: boolean;
}
const KEY = 'rf_notify';

function loadPrefs(): NotifyPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { sound: true, desktop: true, ...(JSON.parse(raw) as Partial<NotifyPrefs>) };
  } catch {
    /* ignore */
  }
  return { sound: true, desktop: true };
}

export const useNotifyPrefs = create<NotifyPrefs & { set: (p: Partial<NotifyPrefs>) => void }>((set, get) => ({
  ...loadPrefs(),
  set: (p) => {
    set(p);
    try {
      const { sound, desktop } = get();
      localStorage.setItem(KEY, JSON.stringify({ sound, desktop }));
    } catch {
      /* ignore */
    }
  },
}));

// ---------------------------------------------------------------- when to alert
export type AlertKind = 'new-chat' | 'message';

/** Pure decision: should this event make a sound / show a desktop notification? */
export function decideAlert(input: {
  kind: AlertKind;
  agentStatus: AgentStatus;
  tabVisible: boolean;
  viewingThisChat: boolean;
  prefs: NotifyPrefs;
}): { sound: boolean; desktop: boolean } {
  const none = { sound: false, desktop: false };
  if (input.agentStatus !== 'online') return none;
  if (input.kind === 'message' && input.viewingThisChat && input.tabVisible) return none;
  return {
    sound: input.prefs.sound,
    // A pop-up is only useful when Replyfinch isn't the tab in front.
    desktop: input.prefs.desktop && !input.tabVisible,
  };
}

// ---------------------------------------------------------------- sound
let ctx: AudioContext | null = null;
let lastChime = 0;

/** Browsers only allow sound after the user has interacted with the page once. */
export function unlockAudio() {
  const unlock = () => {
    try {
      ctx ??= new AudioContext();
      void ctx.resume();
    } catch {
      /* no audio */
    }
  };
  for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, unlock, { once: true, capture: true });
}

/** A short two-note chime, generated in the browser (no audio file to load). */
export function playChime(force = false) {
  const now = Date.now();
  if (!force && now - lastChime < 1500) return; // one chime for a burst of events
  lastChime = now;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    const t = ctx.currentTime;
    for (const [freq, start] of [
      [880, 0],
      [1318.5, 0.14],
    ] as const) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t + start);
      gain.gain.exponentialRampToValueAtTime(0.25, t + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + start + 0.45);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t + start);
      osc.stop(t + start + 0.5);
    }
  } catch {
    /* no audio */
  }
}

// ---------------------------------------------------------------- desktop
export const desktopSupported = () => typeof window !== 'undefined' && 'Notification' in window;
export const desktopPermission = (): NotificationPermission | 'unsupported' =>
  desktopSupported() ? Notification.permission : 'unsupported';

export async function requestDesktopPermission() {
  if (!desktopSupported()) return 'unsupported' as const;
  return Notification.requestPermission();
}

export function showDesktop(title: string, body: string, tag: string, onClick: () => void) {
  if (!desktopSupported() || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, { body, tag, icon: '/favicon.svg' });
    n.onclick = () => {
      window.focus();
      onClick();
      n.close();
    };
  } catch {
    /* some browsers only allow notifications from a service worker */
  }
}

/** Fire the right alerts for an event, according to the agent's preferences and status. */
export function alertAgent(opts: {
  kind: AlertKind;
  agentStatus: AgentStatus;
  viewingThisChat: boolean;
  title: string;
  body: string;
  tag: string;
  onClick: () => void;
}) {
  const tabVisible = document.visibilityState === 'visible' && document.hasFocus();
  const d = decideAlert({ ...opts, tabVisible, prefs: useNotifyPrefs.getState() });
  if (d.sound) playChime();
  if (d.desktop) showDesktop(opts.title, opts.body, opts.tag, opts.onClick);
}
