// MyTasker — Day page picker: any future day in one tap. A strip of the next two weeks for the usual case,
// and a month grid (with how much is due on each day) for anything further out.

import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { For, Show, createMemo, createSignal } from 'solid-js';
import { tasksApi, taskListKey, type TaskListParams } from '~/features/tasks/api';
import { addDays, dayFromIso, inclusiveDays, isoDay, localDay } from '~/features/tasks/span';
import { createQuery } from '~/hooks/createQuery';
import { intlLocale, t } from '~/i18n';
import { authStore } from '~/stores/auth';
import { cx } from '~/utils/cx';
import styles from './DayPicker.module.css';

const STRIP_DAYS = 14;
const OPEN_KEY = 'mt:day-picker-open';

function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) !== '0';
  } catch {
    return true;
  }
}

function weekStartsOn(): number {
  return authStore.user()?.preferences.first_day_of_week ?? 1;
}

function monthGrid(anchor: Date, firstDay: number): string[] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  const start = new Date(first);
  start.setDate(first.getDate() - ((first.getDay() - firstDay + 7) % 7));
  const end = new Date(last);
  end.setDate(last.getDate() + ((firstDay + 6 - last.getDay() + 7) % 7));
  const days: string[] = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) days.push(isoDay(cursor));
  return days;
}

/** "ორშაბათი, 23 ნოემბერი" */
export function longDayLabel(iso: string): string {
  return dayFromIso(iso).toLocaleDateString(intlLocale(), { weekday: 'long', day: 'numeric', month: 'long' });
}

/** "today", "tomorrow", "in 5 days", "3 days ago" */
export function relativeDayLabel(iso: string): string {
  const diff = inclusiveDays(isoDay(new Date()), iso) - 1;
  if (diff === 0) return t('today');
  if (diff === 1) return t('tomorrow');
  if (diff > 1) return t('in {n} days', { n: diff });
  return t('{n} days ago', { n: -diff });
}

export function DayPicker(props: { selected: string; onPick: (iso: string) => void }): JSX.Element {
  const today = isoDay(new Date());
  const [open, setOpen] = createSignal(readOpen());
  const [anchor, setAnchor] = createSignal(dayFromIso(props.selected));

  const toggle = () => {
    const next = !open();
    setOpen(next);
    try {
      localStorage.setItem(OPEN_KEY, next ? '1' : '0');
    } catch {
      /* private mode */
    }
    if (next) setAnchor(dayFromIso(props.selected));
  };

  const strip = createMemo(() => Array.from({ length: STRIP_DAYS }, (_, index) => addDays(today, index + 2)));
  const grid = createMemo(() => monthGrid(anchor(), weekStartsOn()));
  const weekdays = createMemo(() => grid().slice(0, 7).map((iso) => dayFromIso(iso).toLocaleDateString(intlLocale(), { weekday: 'short' })));
  const monthTitle = () => anchor().toLocaleDateString(intlLocale(), { month: 'long', year: 'numeric' });
  const anchorMonth = () => anchor().getMonth();
  const canGoBack = () => new Date(anchor().getFullYear(), anchor().getMonth(), 1) > new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  // How much is due on each day: the strip and the open month share one request covering both.
  const countRange = createMemo(() => {
    const days = open() ? [...grid(), ...strip()] : strip();
    const sorted = [...days].sort();
    return { from: sorted[0] ?? today, to: sorted[sorted.length - 1] ?? today };
  });
  const countParams = (): TaskListParams => ({
    due_after: dayFromIso(countRange().from).toISOString(),
    due_before: dayFromIso(addDays(countRange().to, 1)).toISOString(),
    completed: false,
    top_level: true,
    exclude_kind: 'crypto',
    is_ongoing: false,
    ordering: 'due',
    page_size: 200,
  });
  const countsQuery = createQuery(
    () => taskListKey('day-picker', countParams()),
    () => tasksApi.list(countParams()),
  );
  const counts = createMemo(() => {
    const map = new Map<string, number>();
    for (const task of countsQuery.data()?.results ?? []) {
      const day = localDay(task.due_at);
      if (day) map.set(day, (map.get(day) ?? 0) + 1);
    }
    return map;
  });

  const pick = (iso: string) => {
    if (iso < today) return;
    props.onPick(iso);
  };

  const shiftMonth = (delta: number) => setAnchor((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1));

  return (
    <section class={styles.picker} aria-label={t('Pick a day')}>
      <button type="button" class={styles.current} onClick={toggle} aria-expanded={open()}>
        <CalendarDays size={16} />
        <span class={styles.currentLabel}>{longDayLabel(props.selected)}</span>
        <span class={styles.currentRel}>{relativeDayLabel(props.selected)}</span>
        <ChevronDown size={15} class={cx(styles.chevron, open() && styles.chevronOpen)} />
      </button>

      <div class={styles.strip} role="listbox" aria-label={t('Next two weeks')}>
        <For each={strip()}>
          {(iso) => {
            const date = dayFromIso(iso);
            return (
              <button
                type="button"
                role="option"
                aria-selected={iso === props.selected}
                class={cx(styles.chip, iso === props.selected && styles.chipOn, (date.getDay() === 0 || date.getDay() === 6) && styles.weekend)}
                onClick={() => pick(iso)}
              >
                <span class={styles.chipDow}>{date.toLocaleDateString(intlLocale(), { weekday: 'short' })}</span>
                <span class={styles.chipNum}>{date.getDate()}</span>
                <span class={styles.chipCount}>{counts().get(iso) ?? ''}</span>
              </button>
            );
          }}
        </For>
      </div>

      <Show when={open()}>
        <div class={styles.month}>
          <header class={styles.monthHead}>
            <button type="button" class={styles.nav} onClick={() => shiftMonth(-1)} disabled={!canGoBack()} aria-label={t('Previous month')}>
              <ChevronLeft size={15} />
            </button>
            <span class={styles.monthTitle}>{monthTitle()}</span>
            <button type="button" class={styles.nav} onClick={() => shiftMonth(1)} aria-label={t('Next month')}>
              <ChevronRight size={15} />
            </button>
          </header>
          <div class={styles.weekdays}>
            <For each={weekdays()}>{(name) => <span>{name}</span>}</For>
          </div>
          <div class={styles.grid}>
            <For each={grid()}>
              {(iso) => {
                const date = dayFromIso(iso);
                const past = () => iso < today;
                return (
                  <button
                    type="button"
                    class={cx(
                      styles.cell,
                      date.getMonth() !== anchorMonth() && styles.outside,
                      iso === today && styles.isToday,
                      iso === props.selected && styles.cellOn,
                      past() && styles.past,
                    )}
                    disabled={past()}
                    onClick={() => {
                      pick(iso);
                      // Fold the month away so the day's list is right there; the strip stays for quick hops.
                      setOpen(false);
                    }}
                    aria-label={longDayLabel(iso)}
                    aria-pressed={iso === props.selected}
                  >
                    <span class={styles.cellNum}>{date.getDate()}</span>
                    <Show when={counts().get(iso)}>{(n) => <span class={styles.cellCount}>{n()}</span>}</Show>
                  </button>
                );
              }}
            </For>
          </div>
        </div>
      </Show>
    </section>
  );
}
