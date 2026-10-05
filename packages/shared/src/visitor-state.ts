import type { ConversationStatus, VisitorState } from './types';

/** A visitor with no page view or interaction for this long is shown as idle. */
export const IDLE_AFTER_MS = 5 * 60 * 1000;
/** A visitor whose widget has not sent a heartbeat for this long is considered gone. */
export const OFFLINE_AFTER_MS = 60 * 1000;
export const HEARTBEAT_INTERVAL_MS = 20 * 1000;

export function deriveVisitorState(
  v: { lastActivityAt: number },
  conversationStatus: ConversationStatus | null,
  now = Date.now(),
): VisitorState {
  if (conversationStatus === 'waiting' || conversationStatus === 'active') return 'chatting';
  return now - v.lastActivityAt >= IDLE_AFTER_MS ? 'idle' : 'browsing';
}
