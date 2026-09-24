import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const get = vi.fn();
vi.mock('~/api/client', () => ({ api: { get: (...args: unknown[]) => get(...args), post: vi.fn() } }));

const { loadTimerState, timerStore } = await import('./timer');

const MINUTE = 60_000;

function entry(id: number, startedMinutesAgo: number, category: 'business' | 'personal' = 'business') {
  return { id, category, started_at: new Date(Date.now() - startedMinutesAgo * MINUTE).toISOString(), duration_seconds: 0 };
}

describe('business time today', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-01T12:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('counts a running timer once: the server total already includes it up to the read', async () => {
    // One business timer running for 50 minutes; the server total already holds those 50 minutes.
    get.mockResolvedValueOnce({ running: entry(1, 50), sleep: null, today: { business: 3000, personal: 0, total: 3000 } });
    await loadTimerState();
    expect(timerStore.businessSecondsToday()).toBe(3000);

    vi.advanceTimersByTime(MINUTE);
    expect(timerStore.businessSecondsToday()).toBe(3060);
  });

  it('adds earlier finished work to the running timer', async () => {
    // 30 minutes finished earlier today + 20 minutes running now.
    get.mockResolvedValueOnce({ running: entry(2, 20), sleep: null, today: { business: 3000, personal: 0, total: 3000 } });
    await loadTimerState();
    expect(timerStore.businessSecondsToday()).toBe(3000);
  });

  it('leaves a personal timer out of business time', async () => {
    get.mockResolvedValueOnce({ running: entry(3, 10, 'personal'), sleep: null, today: { business: 1200, personal: 600, total: 1800 } });
    await loadTimerState();
    vi.advanceTimersByTime(5 * MINUTE);
    expect(timerStore.businessSecondsToday()).toBe(1200);
  });
});
