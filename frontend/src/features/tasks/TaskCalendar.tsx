// MyTasker — task calendar. A start date through a due date is a thin bar across those days.
// Projects drawn on the project timeline sit above their tasks, so a dated project shows even with no tasks.

import { A } from '@solidjs/router';
import { Briefcase, ChevronLeft, ChevronRight } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { For, Show, createMemo, createSignal } from 'solid-js';
import { Button } from '~/components/ui/Button';
import { ErrorNote, Skeleton } from '~/components/ui/Feedback';
import { projectsApi } from '~/features/projects/api';
import { tasksApi } from '~/features/tasks/api';
import { addDays, inclusiveDays, isoDay, projectSpan, taskSpan, type DaySpan } from '~/features/tasks/span';
import { createQuery } from '~/hooks/createQuery';
import { intlLocale, t, tn } from '~/i18n';
import type { Project, Task } from '~/types';
import { cx } from '~/utils/cx';
import styles from './TaskCalendar.module.css';

const MAX_LANES = 3;
const MAX_PROJECT_LANES = 2;

interface Segment<T> {
  item: T;
  span: DaySpan;
  colStart: number;
  colEnd: number;
  lane: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
}

function mondayOf(date: Date): Date {
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const offset = (copy.getDay() + 6) % 7;
  copy.setDate(copy.getDate() - offset);
  return copy;
}

function weeksOf(anchor: Date): Date[][] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  const cursor = mondayOf(first);
  const end = mondayOf(last);
  const weeks: Date[][] = [];
  while (cursor <= end) {
    weeks.push(Array.from({ length: 7 }, (_, index) => new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + index)));
    cursor.setDate(cursor.getDate() + 7);
  }
  return weeks;
}

function segmentsForWeek<T>(items: T[], spanOf: (item: T) => DaySpan | null, weekStart: string): Segment<T>[] {
  const weekEnd = addDays(weekStart, 6);
  const rows: Omit<Segment<T>, 'lane'>[] = [];
  for (const item of items) {
    const span = spanOf(item);
    if (!span || span.end < weekStart || span.start > weekEnd) continue;
    const start = span.start < weekStart ? weekStart : span.start;
    const end = span.end > weekEnd ? weekEnd : span.end;
    rows.push({
      item,
      span,
      colStart: inclusiveDays(weekStart, start) - 1,
      colEnd: inclusiveDays(weekStart, end) - 1,
      continuesBefore: span.start < weekStart,
      continuesAfter: span.end > weekEnd,
    });
  }
  rows.sort((a, b) => a.colStart - b.colStart || b.colEnd - a.colEnd);
  const laneEnds: number[] = [];
  return rows.map((row) => {
    let lane = laneEnds.findIndex((end) => end < row.colStart);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(row.colEnd);
    } else {
      laneEnds[lane] = row.colEnd;
    }
    return { ...row, lane };
  });
}

export function TaskCalendar(props: { onOpen: (task: Task) => void }): JSX.Element {
  const today = isoDay(new Date());
  const [anchor, setAnchor] = createSignal(new Date(new Date().getFullYear(), new Date().getMonth(), 1));

  const weeks = createMemo(() => weeksOf(anchor()));
  const range = createMemo(() => {
    const rows = weeks();
    const first = rows[0]?.[0] ?? anchor();
    const last = rows[rows.length - 1]?.[6] ?? first;
    return { from: isoDay(first), to: isoDay(last) };
  });

  const query = createQuery(
    () => `tasks:calendar:${range().from}:${range().to}`,
    () =>
      tasksApi.list({
        span_from: range().from,
        span_to: range().to,
        top_level: true,
        completed: false,
        ordering: 'due',
        page_size: 200,
      }),
  );

  const projectQuery = createQuery(
    () => 'projects:calendar',
    () => projectsApi.list({ view: 'open', page_size: 200 }),
  );

  const tasks = () => query.data()?.results ?? [];
  /** Open-ended projects run to the last day on screen. */
  const spanOfProject = (project: Project) => projectSpan(project, range().to);
  const projects = createMemo(() =>
    (projectQuery.data()?.results ?? [])
      .filter((project) => {
        const span = spanOfProject(project);
        return span && span.end >= range().from && span.start <= range().to;
      })
      .sort((a, b) => (a.start_date! < b.start_date! ? -1 : a.start_date! > b.start_date! ? 1 : a.name.localeCompare(b.name))),
  );
  const projectHue = (project: Project) => ({ '--project-hue': String((project.id * 47 + 185) % 360) }) as JSX.CSSProperties;
  const weekdayLabels = createMemo(() => {
    const monday = new Date(2026, 8, 7);
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(monday);
      date.setDate(monday.getDate() + index);
      return date.toLocaleDateString(intlLocale(), { weekday: 'short' });
    });
  });
  const title = () => anchor().toLocaleDateString(intlLocale(), { month: 'long', year: 'numeric' });

  const shiftMonth = (by: number) => {
    const current = anchor();
    setAnchor(new Date(current.getFullYear(), current.getMonth() + by, 1));
  };

  return (
    <div class={styles.board}>
      <div class={styles.toolbar}>
        <Button variant="ghost" size="icon" aria-label={t('Previous')} onClick={() => shiftMonth(-1)}>
          <ChevronLeft size={16} />
        </Button>
        <h2 class={styles.month}>{title()}</h2>
        <Button variant="ghost" size="icon" aria-label={t('Next')} onClick={() => shiftMonth(1)}>
          <ChevronRight size={16} />
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setAnchor(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>
          {t('Today')}
        </Button>
      </div>

      <Show when={!query.error()} fallback={<ErrorNote message={t('Could not load tasks.')} onRetry={query.refetch} />}>
        <Show when={query.data()} fallback={<Skeleton rows={6} height={72} />}>
          <div class={styles.weekdays}>
            <For each={weekdayLabels()}>{(label) => <span>{label}</span>}</For>
          </div>
          <For each={weeks()}>
            {(week) => {
              const weekStart = () => isoDay(week[0] ?? anchor());
              const segments = () => segmentsForWeek(tasks(), taskSpan, weekStart());
              const projectSegments = () => segmentsForWeek(projects(), spanOfProject, weekStart());
              const hidden = () =>
                segments().filter((segment) => segment.lane >= MAX_LANES).length +
                projectSegments().filter((segment) => segment.lane >= MAX_PROJECT_LANES).length;
              return (
                <section class={styles.week}>
                  <div class={styles.days}>
                    <For each={week}>
                      {(date) => {
                        const key = isoDay(date);
                        const outside = date.getMonth() !== anchor().getMonth();
                        return (
                          <div class={cx(styles.day, key === today && styles.today, outside && styles.outside)}>
                            <span class={styles.dayNum}>{date.getDate()}</span>
                          </div>
                        );
                      }}
                    </For>
                  </div>
                  <Show when={projectSegments().length > 0}>
                    <div class={styles.lanes}>
                      <For each={projectSegments().filter((segment) => segment.lane < MAX_PROJECT_LANES)}>
                        {(segment) => (
                          <A
                            href={`/projects/${segment.item.id}/tasks`}
                            class={cx(
                              styles.bar,
                              styles.projectBar,
                              segment.continuesBefore && styles.continuesBefore,
                              segment.continuesAfter && styles.continuesAfter,
                            )}
                            style={{
                              ...projectHue(segment.item),
                              'grid-column': `${segment.colStart + 1} / ${segment.colEnd + 2}`,
                              'grid-row': String(segment.lane + 1),
                            }}
                            title={`${segment.item.name} · ${segment.item.start_date} → ${segment.item.deadline ?? t('ongoing')}`}
                          >
                            <Briefcase size={10} class={styles.projectIcon} />
                            <span class={styles.barLabel}>{segment.item.name}</span>
                          </A>
                        )}
                      </For>
                    </div>
                  </Show>
                  <div class={styles.lanes}>
                    <For each={segments().filter((segment) => segment.lane < MAX_LANES)}>
                      {(segment) => {
                        const days = inclusiveDays(segment.span.start, segment.span.end);
                        return (
                          <button
                            type="button"
                            class={cx(
                              styles.bar,
                              segment.continuesBefore && styles.continuesBefore,
                              segment.continuesAfter && styles.continuesAfter,
                              days === 1 && styles.single,
                            )}
                            style={{
                              'grid-column': `${segment.colStart + 1} / ${segment.colEnd + 2}`,
                              'grid-row': String(segment.lane + 1),
                            }}
                            title={days > 1 ? `${segment.item.title} · ${tn(days, 'day')}` : segment.item.title}
                            onClick={() => props.onOpen(segment.item)}
                          >
                            <span class={styles.barLabel}>{segment.item.title}</span>
                          </button>
                        );
                      }}
                    </For>
                  </div>
                  <Show when={hidden() > 0}>
                    <p class={styles.more}>{t('+{n} more', { n: hidden() })}</p>
                  </Show>
                </section>
              );
            }}
          </For>
          <Show when={tasks().length === 0 && projects().length === 0}>
            <p class={styles.empty}>{t('Nothing scheduled this month.')}</p>
          </Show>
        </Show>
      </Show>
    </div>
  );
}
