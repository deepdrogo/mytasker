import { describe, expect, it } from 'vitest';
import { cx } from './cx';
import { formatClock, formatDuration, formatMinutes, formatRelative, percent } from './format';

describe('format helpers', () => {
  it('formats durations and clocks', () => {
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(3661)).toMatch(/1:01:01|01:01:01/);
    expect(formatDuration(90)).toMatch(/1m/);
    expect(formatMinutes(600)).toMatch(/10h/);
  });

  it('formats relative time in both directions', () => {
    const now = Date.now();
    expect(formatRelative(new Date(now - 10_000).toISOString())).toBe('just now');
    expect(formatRelative(new Date(now - 5 * 60_000).toISOString())).toBe('5m ago');
    expect(formatRelative(new Date(now + 2 * 3_600_000).toISOString())).toBe('in 2h');
    expect(formatRelative(new Date(now + 3 * 86_400_000).toISOString())).toBe('in 3d');
    expect(formatRelative(null)).toBe('');
  });

  it('clamps percentages and joins classes', () => {
    expect(percent(5, 10)).toBe(50);
    expect(percent(5, 0)).toBe(0);
    expect(cx('a', false, undefined, 'b', null)).toBe('a b');
  });
});
