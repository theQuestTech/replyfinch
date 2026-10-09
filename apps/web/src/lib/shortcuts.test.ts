import { describe, expect, it } from 'vitest';
import type { Shortcut } from '@replyfinch/shared';
import { fillShortcut, inlineSuggestion, searchShortcuts, slashQuery } from './shortcuts';

const sc = (name: string, message: string, tags: string[] = []): Shortcut => ({ id: name, name, message, tags, updatedAt: 0 });
const list = [
  sc('hi', 'Hi {{visitor.name}}, how can I help?', ['greeting', 'hello']),
  sc('refund', 'I’ve started a refund for you.', ['money', 'return']),
  sc('shipping', 'Orders ship in 1–2 business days.', ['delivery', 'tracking']),
  sc('order-status', 'Your order is on its way!', ['tracking']),
];
const names = (r: Shortcut[]) => r.map((s) => s.name);

describe('searchShortcuts', () => {
  it('lists everything for an empty query', () => {
    expect(names(searchShortcuts(list, ''))).toEqual(['hi', 'order-status', 'refund', 'shipping']);
  });
  it('matches name prefixes first', () => {
    expect(names(searchShortcuts(list, 'ref'))[0]).toBe('refund');
    expect(names(searchShortcuts(list, 'stat'))[0]).toBe('order-status');
  });
  it('matches tags and message words (similar words)', () => {
    expect(names(searchShortcuts(list, 'money'))).toEqual(['refund']);
    expect(names(searchShortcuts(list, 'delivery'))).toEqual(['shipping']);
    expect(names(searchShortcuts(list, 'tracking'))).toEqual(expect.arrayContaining(['shipping', 'order-status']));
    expect(names(searchShortcuts(list, 'business'))).toEqual(['shipping']);
  });
  it('tolerates typos', () => {
    expect(names(searchShortcuts(list, 'refnd'))[0]).toBe('refund');
    expect(names(searchShortcuts(list, 'shiping'))[0]).toBe('shipping');
    expect(names(searchShortcuts(list, 'delivry'))).toContain('shipping');
  });
  it('excludes non-matches', () => {
    expect(searchShortcuts(list, 'xyzzy')).toEqual([]);
  });
});

describe('slashQuery', () => {
  it('detects "/query" at the caret', () => {
    expect(slashQuery('/ref', 4)).toEqual({ start: 0, query: 'ref' });
    expect(slashQuery('Sure! /ship', 11)).toEqual({ start: 6, query: 'ship' });
    expect(slashQuery('/', 1)).toEqual({ start: 0, query: '' });
  });
  it('ignores slashes inside words or URLs', () => {
    expect(slashQuery('and/or', 6)).toBeNull();
    expect(slashQuery('see acme.com/help', 17)).toBeNull();
    expect(slashQuery('/ref done', 9)).toBeNull();
  });
});

describe('inlineSuggestion', () => {
  it('suggests a shortcut when the last word is its name or tag', () => {
    expect(inlineSuggestion(list, 'I can do a refund', 17)?.shortcut.name).toBe('refund');
    expect(inlineSuggestion(list, 'about delivery', 14)?.shortcut.name).toBe('shipping');
    expect(inlineSuggestion(list, 'hello', 5)?.shortcut.name).toBe('hi');
  });
  it('stays quiet for ordinary words and while using "/"', () => {
    expect(inlineSuggestion(list, 'thanks for waiting', 18)).toBeNull();
    expect(inlineSuggestion(list, '/refund', 7)).toBeNull();
  });
});

describe('fillShortcut', () => {
  it('fills placeholders with first names', () => {
    expect(fillShortcut('Hi {{visitor.name}}, I’m {{ agent.name }}.', { visitorName: 'Sofia Martínez', agentName: 'Maya Chen' })).toBe(
      'Hi Sofia, I’m Maya.',
    );
    expect(fillShortcut('Hi {{visitor.name}}!', { visitorName: null, agentName: 'Maya' })).toBe('Hi there!');
  });
});
