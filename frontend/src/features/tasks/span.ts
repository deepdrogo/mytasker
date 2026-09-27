/** Inclusive calendar span for a task. The due date stays the end; a start date only widens it. */

export function isoDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function dayFromIso(iso: string): Date {
  const [year = 1970, month = 1, day = 1] = iso.slice(0, 10).split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function localDay(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return isoDay(date);
}

export function addDays(iso: string, days: number): string {
  const date = dayFromIso(iso);
  date.setDate(date.getDate() + days);
  return isoDay(date);
}

export function inclusiveDays(start: string, end: string): number {
  const ms = dayFromIso(end).getTime() - dayFromIso(start).getTime();
  return Math.round(ms / 86_400_000) + 1;
}

export interface DaySpan {
  start: string;
  end: string;
}

/** Local start through local due, inclusive. Either date alone is a one-day mark. */
export function taskSpan(task: { start_at: string | null; due_at: string | null }): DaySpan | null {
  const start = localDay(task.start_at);
  const due = localDay(task.due_at);
  if (!start && !due) return null;
  const first = start ?? due!;
  const last = due ?? start!;
  return first <= last ? { start: first, end: last } : { start: last, end: first };
}

/**
 * A project's calendar days (plain dates, no timezone shift). Unscheduled projects have no span; an
 * open-ended one runs through `openEnd`, the last day the caller shows.
 */
export function projectSpan(project: { start_date: string | null; deadline: string | null }, openEnd: string): DaySpan | null {
  if (!project.start_date) return null;
  const end = project.deadline ?? (openEnd > project.start_date ? openEnd : project.start_date);
  return end >= project.start_date ? { start: project.start_date, end } : { start: end, end: project.start_date };
}
