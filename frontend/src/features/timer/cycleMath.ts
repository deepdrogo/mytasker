// MyTasker — geometry and live figures for the 24-hour cycle ring.
// The ring is a 24-hour clock face: midnight at the top, clockwise. The window is the last 24 hours, so every
// clock position appears exactly once and "now" is the seam between the newest and the oldest minute.

import type { CycleData, CycleKind } from '~/types';

const DAY_MS = 24 * 3600 * 1000;

/** Degrees on the 24h face for a moment in local time: 00:00 → 0°, 06:00 → 90°, 12:00 → 180°. */
export function clockAngle(date: Date): number {
  const midnight = new Date(date);
  midnight.setHours(0, 0, 0, 0);
  return ((date.getTime() - midnight.getTime()) / DAY_MS) * 360;
}

export function pointAt(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180;
  return [cx + r * Math.sin(rad), cy - r * Math.cos(rad)];
}

/** An SVG arc from `startDeg`, `sweepDeg` clockwise. A full turn is drawn as two halves (one arc cannot close). */
export function arcPath(cx: number, cy: number, r: number, startDeg: number, sweepDeg: number): string {
  const sweep = Math.max(0, Math.min(360, sweepDeg));
  if (sweep >= 359.999) {
    const [x0, y0] = pointAt(cx, cy, r, startDeg);
    const [x1, y1] = pointAt(cx, cy, r, startDeg + 180);
    return `M ${x0} ${y0} A ${r} ${r} 0 1 1 ${x1} ${y1} A ${r} ${r} 0 1 1 ${x0} ${y0}`;
  }
  const [x0, y0] = pointAt(cx, cy, r, startDeg);
  const [x1, y1] = pointAt(cx, cy, r, startDeg + sweep);
  return `M ${x0} ${y0} A ${r} ${r} 0 ${sweep > 180 ? 1 : 0} 1 ${x1} ${y1}`;
}

/** Start angle and sweep of a [start, end) span on the face. */
export function spanAngles(start: Date, end: Date): { start: number; sweep: number } {
  return { start: clockAngle(start), sweep: (Math.max(0, end.getTime() - start.getTime()) / DAY_MS) * 360 };
}

/**
 * Seconds per kind right now. The server counted the running activity up to `fetchedAt`; add only what has
 * run since, and take it out of the free time.
 */
export function liveSeconds(data: CycleData, fetchedAt: number, now: number): { seconds: Record<CycleKind, number>; free: number } {
  const extra = data.running ? Math.max(0, Math.floor((now - fetchedAt) / 1000)) : 0;
  const seconds = { ...data.seconds };
  if (data.running && extra > 0) seconds[data.running.kind] = (seconds[data.running.kind] ?? 0) + extra;
  return { seconds, free: Math.max(0, data.free_seconds - extra) };
}

/** 0..1 of a target; no target counts as done once anything is logged. */
export function share(seconds: number, targetMinutes: number): number {
  if (targetMinutes <= 0) return seconds > 0 ? 1 : 0;
  return Math.min(1, seconds / (targetMinutes * 60));
}
