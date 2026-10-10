import { describe, expect, it } from 'vitest';
import { ticks } from './Reports';

describe('ticks', () => {
  it('gives round, evenly spaced axis values covering the max', () => {
    expect(ticks(0)).toEqual([0, 1]);
    expect(ticks(3)).toEqual([0, 1, 2, 3]);
    expect(ticks(7)).toEqual([0, 5, 10]);
    expect(ticks(23)).toEqual([0, 10, 20, 30]);
    expect(ticks(1200)).toEqual([0, 500, 1000, 1500]);
  });
});
