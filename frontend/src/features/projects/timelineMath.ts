// MyTasker — pure date maths behind the project timeline (no DOM, fully testable).
// Built by drogoz · https://github.com/deepdrogo/mytasker

const DAY_MS = 86_400_000;

/** A scheduled span. `end` stays null for work that simply runs on with no finish date. */
export interface DateRange {
  start: string | null;
  end: string | null;
}

export type DragMode = 'create' | 'move' | 'start' | 'end';

export function parseDate(value: string): Date {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  return new Date(year!, month! - 1, day!);
}

export function iso(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function addDays(value: string, amount: number): string {
  const date = parseDate(value);
  date.setDate(date.getDate() + amount);
  return iso(date);
}

export function diffDays(from: string, to: string): number {
  return Math.round((parseDate(to).getTime() - parseDate(from).getTime()) / DAY_MS);
}

/**
 * The range a project should show while it is being dragged.
 * `from`/`to` are the days under the pointer when the gesture started and where it is now.
 *
 * Moving shifts the whole range by the distance travelled; stretching snaps the dragged edge to
 * the day under the cursor, which is what the eye expects. An edge never passes the other one:
 * push it too far and the range collapses to a single day instead of inverting.
 */
export function previewRange(base: DateRange, mode: DragMode, from: string, to: string): DateRange {
  if (mode === 'create') {
    return from <= to ? { start: from, end: to } : { start: to, end: from };
  }
  if (!base.start) return base;

  if (mode === 'move') {
    const shift = diffDays(from, to);
    return { start: addDays(base.start, shift), end: base.end ? addDays(base.end, shift) : null };
  }
  if (mode === 'start') {
    return { start: base.end && to > base.end ? base.end : to, end: base.end };
  }
  return { start: base.start, end: to < base.start ? base.start : to };
}

/** Does this range touch the window the board currently shows? Open-ended work runs to the right edge. */
export function overlapsWindow(range: DateRange, windowStart: string, windowEnd: string): boolean {
  if (!range.start) return false;
  return range.start <= windowEnd && (!range.end || range.end >= windowStart);
}

/** Range clipped to the visible window, expressed as a day offset and a length in days. */
export function windowColumns(
  range: DateRange,
  windowStart: string,
  windowEnd: string,
): { offset: number; span: number } {
  const start = range.start! < windowStart ? windowStart : range.start!;
  const end = !range.end || range.end > windowEnd ? windowEnd : range.end;
  return { offset: diffDays(windowStart, start), span: Math.max(1, diffDays(start, end) + 1) };
}

export function sameRange(a: DateRange, b: DateRange): boolean {
  return a.start === b.start && a.end === b.end;
}

/**
 * Payload we persist for a timeline edit. A missing start means the project is off the calendar:
 * both ends are cleared so a leftover deadline cannot keep a ghost bar.
 */
export function rangeForSave(range: DateRange): DateRange {
  return range.start ? { start: range.start, end: range.end } : { start: null, end: null };
}
