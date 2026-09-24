import { describe, expect, it } from 'vitest';
import { cx } from './cx';
import { dayOffset, endOfDay, formatClock, formatDueDate, formatDuration, formatMinutes, formatRelative, percent } from './format';

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

  it('puts date-only deadlines at the end of the local day and labels them without a clock', () => {
    const today = new Date(endOfDay(0));
    const tomorrow = new Date(endOfDay(1));
    expect([today.getHours(), today.getMinutes()]).toEqual([23, 59]);
    expect([tomorrow.getHours(), tomorrow.getMinutes()]).toEqual([23, 59]);
    expect(dayOffset(endOfDay(0))).toBe(0);
    expect(dayOffset(endOfDay(1))).toBe(1);
    expect(formatDueDate(endOfDay(1), false)).toBe('Tomorrow');
    expect(formatDueDate(endOfDay(0), false)).toBe('Today');
  });

  it('clamps percentages and joins classes', () => {
    expect(percent(5, 10)).toBe(50);
    expect(percent(5, 0)).toBe(0);
    expect(cx('a', false, undefined, 'b', null)).toBe('a b');
  });
});
