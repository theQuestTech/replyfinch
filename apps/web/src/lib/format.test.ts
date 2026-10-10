import { describe, expect, it } from 'vitest';
import { dateTime, timeAgo } from './format';

describe('dateTime', () => {
  const now = new Date(2026, 9, 10, 15, 0);
  it('says Today / Yesterday for recent dates', () => {
    expect(dateTime(new Date(2026, 9, 10, 9, 5).getTime(), now)).toMatch(/^Today, /);
    expect(dateTime(new Date(2026, 9, 9, 23, 59).getTime(), now)).toMatch(/^Yesterday, /);
  });
  it('adds the year only for other years', () => {
    expect(dateTime(new Date(2026, 2, 4, 12, 0).getTime(), now)).not.toMatch(/2026/);
    expect(dateTime(new Date(2025, 2, 4, 12, 0).getTime(), now)).toMatch(/2025/);
  });
});

describe('timeAgo', () => {
  const now = Date.UTC(2026, 9, 10, 12);
  it('is short and human', () => {
    expect(timeAgo(now - 20_000, now)).toBe('just now');
    expect(timeAgo(now - 5 * 60_000, now)).toBe('5m ago');
    expect(timeAgo(now - 3 * 3600_000, now)).toBe('3h ago');
    expect(timeAgo(now - 2 * 86_400_000, now)).toBe('2d ago');
  });
});
