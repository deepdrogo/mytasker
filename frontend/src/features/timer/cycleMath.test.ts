import { describe, expect, it } from 'vitest';
import type { CycleData } from '~/types';
import { arcPath, clockAngle, liveSeconds, share, spanAngles } from './cycleMath';

const at = (h: number, m = 0) => {
  const d = new Date(2026, 10, 3, h, m, 0, 0);
  return d;
};

describe('cycle ring geometry', () => {
  it('maps the clock to the 24h face, midnight on top', () => {
    expect(clockAngle(at(0))).toBe(0);
    expect(clockAngle(at(6))).toBe(90);
    expect(clockAngle(at(18))).toBe(270);
  });

  it('measures spans across midnight', () => {
    const start = at(23);
    const end = new Date(start.getTime() + 8 * 3600 * 1000);
    expect(spanAngles(start, end)).toEqual({ start: 345, sweep: 120 });
  });

  it('draws large arcs with the large-arc flag and a full turn as two halves', () => {
    expect(arcPath(100, 100, 50, 0, 270)).toContain(' 0 1 1 ');
    expect(arcPath(100, 100, 50, 0, 90)).toContain(' 0 0 1 ');
    expect(arcPath(100, 100, 50, 0, 360).match(/A /g)).toHaveLength(2);
  });
});

describe('live figures', () => {
  const data: CycleData = {
    window_start: '',
    window_end: '',
    seconds: { sleep: 3600, business: 0, fun: 600, exercise: 0, personal: 0 },
    target_minutes: { sleep: 480, business: 480, fun: 240, exercise: 120 },
    tracked_seconds: 4200,
    free_seconds: 82200,
    running: { kind: 'fun', started_at: '' },
    segments: [],
  };

  it('adds only the time since the fetch to the running activity', () => {
    const { seconds, free } = liveSeconds(data, 1_000, 61_000);
    expect(seconds.fun).toBe(660);
    expect(seconds.sleep).toBe(3600);
    expect(free).toBe(82140);
  });

  it('caps progress at the target', () => {
    expect(share(30 * 3600, 480)).toBe(1);
    expect(share(2 * 3600, 480)).toBe(0.25);
    expect(share(0, 0)).toBe(0);
  });
});
