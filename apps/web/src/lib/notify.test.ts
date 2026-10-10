import { describe, expect, it } from 'vitest';
import { decideAlert } from './notify';

const prefs = { sound: true, desktop: true };
const base = { agentStatus: 'online' as const, tabVisible: true, viewingThisChat: false, prefs };

describe('decideAlert', () => {
  it('chimes for a new chat; adds a pop-up only when the tab is in the background', () => {
    expect(decideAlert({ ...base, kind: 'new-chat' })).toEqual({ sound: true, desktop: false });
    expect(decideAlert({ ...base, kind: 'new-chat', tabVisible: false })).toEqual({ sound: true, desktop: true });
  });
  it('stays quiet for messages in the chat you are looking at', () => {
    expect(decideAlert({ ...base, kind: 'message', viewingThisChat: true })).toEqual({ sound: false, desktop: false });
    expect(decideAlert({ ...base, kind: 'message', viewingThisChat: true, tabVisible: false })).toEqual({ sound: true, desktop: true });
    expect(decideAlert({ ...base, kind: 'message' })).toEqual({ sound: true, desktop: false });
  });
  it('is silent while away and respects preferences', () => {
    expect(decideAlert({ ...base, kind: 'new-chat', agentStatus: 'away' })).toEqual({ sound: false, desktop: false });
    expect(decideAlert({ ...base, kind: 'new-chat', tabVisible: false, prefs: { sound: false, desktop: true } })).toEqual({
      sound: false,
      desktop: true,
    });
  });
});
