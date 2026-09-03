import { intlLocale, locale, t, tn } from '~/i18n';
import type { ISODate, ISODateTime } from '~/types';

/** Duration unit suffixes: 2h 30m / 2სთ 30წთ */
function units(): { h: string; m: string; s: string; d: string } {
  return locale() === 'ka' ? { h: 'სთ', m: 'წთ', s: 'წმ', d: 'დ' } : { h: 'h', m: 'm', s: 's', d: 'd' };
}

export function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** 9042 -> "2h 30m", 150 -> "2m", 45 -> "45s" */
export function formatDuration(seconds: number, opts: { withSeconds?: boolean } = {}): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const u = units();
  if (h > 0) return m > 0 ? `${h}${u.h} ${m}${u.m}` : `${h}${u.h}`;
  if (m > 0) return opts.withSeconds && s > 0 ? `${m}${u.m} ${s}${u.s}` : `${m}${u.m}`;
  return `${s}${u.s}`;
}

/** Timer display: 02:41 or 1:02:41 */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`;
}

export function formatMinutes(minutes: number): string {
  return formatDuration(minutes * 60);
}

export function parseDate(value: ISODateTime | ISODate | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatTime(value: ISODateTime | null | undefined, use12h = false): string {
  const date = parseDate(value);
  if (!date) return '';
  return use12h
    ? date.toLocaleTimeString(intlLocale(), { hour: 'numeric', minute: '2-digit', hour12: true })
    : `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function formatDate(value: ISODateTime | ISODate | null | undefined): string {
  const date = parseDate(value);
  if (!date) return '';
  return date.toLocaleDateString(intlLocale(), { day: 'numeric', month: 'short' });
}

export function formatDateFull(value: ISODateTime | ISODate | null | undefined): string {
  const date = parseDate(value);
  if (!date) return '';
  return date.toLocaleDateString(intlLocale(), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function dayOffset(value: ISODateTime | ISODate | null | undefined): number | null {
  const date = parseDate(value);
  if (!date) return null;
  const diff = startOfDay(date).getTime() - startOfDay(new Date()).getTime();
  return Math.round(diff / 86_400_000);
}

/** "Today 17:00", "Tomorrow", "Fri", "12 Mar" */
export function formatDueDate(value: ISODateTime | null | undefined, hasTime = false, use12h = false): string {
  const date = parseDate(value);
  if (!date) return '';
  const offset = dayOffset(value) ?? 0;
  const time = hasTime ? ` ${formatTime(value, use12h)}` : '';
  if (offset === 0) return `${t('Today')}${time}`;
  if (offset === 1) return `${t('Tomorrow')}${time}`;
  if (offset === -1) return `${t('Yesterday')}${time}`;
  if (offset > 1 && offset < 7) return `${date.toLocaleDateString(intlLocale(), { weekday: 'short' })}${time}`;
  const sameYear = date.getFullYear() === new Date().getFullYear();
  const label = date.toLocaleDateString(intlLocale(), {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
  return `${label}${time}`;
}

export function formatRelative(value: ISODateTime | null | undefined): string {
  const date = parseDate(value);
  if (!date) return '';
  const diff = Math.round((Date.now() - date.getTime()) / 1000);
  const future = diff < 0;
  const seconds = Math.abs(diff);
  const u = units();
  const wrap = (s: string) => (future ? t('in {time}', { time: s }) : t('{time} ago', { time: s }));
  if (seconds < 45) return future ? t('in a moment') : t('just now');
  if (seconds < 3600) return wrap(`${Math.round(seconds / 60)}${u.m}`);
  if (seconds < 86_400) return wrap(`${Math.round(seconds / 3600)}${u.h}`);
  const days = Math.round(seconds / 86_400);
  if (days < 7) return wrap(`${days}${u.d}`);
  return formatDate(value);
}

export function toLocalInputValue(value: ISODateTime | null | undefined): string {
  const date = parseDate(value);
  if (!date) return '';
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(
    date.getMinutes(),
  )}`;
}

export function toDateInputValue(value: ISODateTime | ISODate | null | undefined): string {
  const date = parseDate(value);
  if (!date) return '';
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function fromLocalInputValue(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function pluralize(count: number, singular: string, plural?: string): string {
  return tn(count, singular, plural);
}

export function percent(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return Math.min(100, Math.round((numerator / denominator) * 100));
}

/** "-1h 18m" / "+22m" */
export function formatDelta(actualSeconds: number, targetSeconds: number): string {
  const diff = actualSeconds - targetSeconds;
  if (Math.abs(diff) < 60) return `0${units().m}`;
  return `${diff < 0 ? '−' : '+'}${formatDuration(Math.abs(diff))}`;
}

export function truncate(text: string, length: number): string {
  return text.length <= length ? text : `${text.slice(0, length)}…`;
}
