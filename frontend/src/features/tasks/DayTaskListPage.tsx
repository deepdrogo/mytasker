// MyTasker — Today / Tomorrow / Day (any picked date): one day's work and nothing else.
// Built by drogoz · https://github.com/deepdrogo/mytasker

import { Infinity as InfinityIcon, SkipForward } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import { tasksApi, taskListKey, type TaskListParams } from '~/features/tasks/api';
import { DayPicker, longDayLabel, relativeDayLabel } from '~/features/tasks/DayPicker';
import { dayFromIso } from '~/features/tasks/span';
import { TaskList } from '~/features/tasks/TaskList';
import { TaskListPage } from '~/features/tasks/TaskListPage';
import { createQuery } from '~/hooks/createQuery';
import { intlLocale, t } from '~/i18n';
import type { Task } from '~/types';
import { cx } from '~/utils/cx';
import { endOfDay } from '~/utils/format';
import styles from './DayTaskListPage.module.css';

export type DayView = 'today' | 'tomorrow' | 'date';

function dayLabel(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toLocaleDateString(intlLocale(), { weekday: 'long', day: 'numeric', month: 'long' });
}

/** 23:59 local on a `YYYY-MM-DD` day - the same "due that day, no time" a new task gets on Today / Tomorrow. */
function endOfIsoDay(iso: string): string {
  const d = dayFromIso(iso);
  d.setHours(23, 59, 0, 0);
  return d.toISOString();
}

const COPY: Record<
  DayView,
  { title: string; subtitle: string; placeholder: string; emptyTitle: string; emptyHint: string; offset: number }
> = {
  today: {
    title: 'Today',
    subtitle: 'Due today, plus anything overdue. Crypto world stays out.',
    placeholder: 'Add a task for today…',
    emptyTitle: 'Nothing due today.',
    emptyHint: 'Add a task above, or plan ahead on Tomorrow.',
    offset: 0,
  },
  tomorrow: {
    title: 'Tomorrow',
    subtitle: 'Only what is due tomorrow.',
    placeholder: 'Add a task for tomorrow…',
    emptyTitle: 'Nothing due tomorrow.',
    emptyHint: 'Add a task above and it lands on tomorrow’s list.',
    offset: 1,
  },
  date: {
    title: 'Day',
    subtitle: 'Only what is due on this day.',
    placeholder: 'Add a task for this day…',
    emptyTitle: 'Nothing due on this day.',
    emptyHint: 'Add a task above and it lands on this day’s list.',
    offset: 0,
  },
};

function tabs(date?: string) {
  return [
    { label: 'Today', href: '/today' },
    { label: 'Tomorrow', href: '/tomorrow' },
    // The chosen day stays in the tab, so it is the active one and coming back keeps the day.
    { label: 'Day', href: date ? `/day/${date}` : '/day' },
  ];
}

/** Long-term work ticked once a day - it belongs on every day's page, not only where its (optional) deadline falls. */
const ONGOING_PARAMS: TaskListParams = {
  is_ongoing: true,
  completed: false,
  top_level: true,
  exclude_kind: 'crypto',
  ordering: 'priority',
  page_size: 50,
};

export function DayTaskListPage(props: {
  day: DayView;
  /** `YYYY-MM-DD`, for `day="date"`. */
  date?: string;
  onPickDay?: (iso: string) => void;
}): JSX.Element {
  const copy = () => COPY[props.day];
  const chosen = () => (props.day === 'date' ? props.date : undefined);
  const heading = () => {
    const date = chosen();
    return date ? `${longDayLabel(date)} · ${relativeDayLabel(date)}` : dayLabel(copy().offset);
  };
  // Ongoing work has its own block above the list, so the dated list stays about deadlines.
  const params = (): TaskListParams => {
    const date = chosen();
    const base: TaskListParams = { top_level: true, exclude_kind: 'crypto', is_ongoing: false };
    return date ? { ...base, due_on: date } : { ...base, view: props.day as 'today' | 'tomorrow' };
  };
  return (
    <TaskListPage
      title={t(copy().title)}
      subtitle={`${heading()} · ${t(copy().subtitle)}`}
      queryName={props.day}
      params={params}
      composerDefaults={{
        due_at: chosen() ? endOfIsoDay(chosen() as string) : endOfDay(copy().offset),
        due_has_time: false,
      }}
      composerPlaceholder={t(copy().placeholder)}
      showProject
      showKind
      groupByProject
      defaultOrdering="priority"
      tabs={tabs(chosen()).map((tab) => ({ ...tab, label: t(tab.label) }))}
      emptyTitle={t(copy().emptyTitle)}
      emptyHint={t(copy().emptyHint)}
      beforeList={(ctx) => (
        <>
          <Show when={chosen()}>
            {(date) => <DayPicker selected={date()} onPick={(iso) => props.onPickDay?.(iso)} />}
          </Show>
          <DailyCheckins onOpen={ctx.openTask} onShare={ctx.shareTask} />
        </>
      )}
    />
  );
}

/** Task check-ins: the long-term tasks, with today's tick. Hidden when there are none. */
function DailyCheckins(props: { onOpen: (task: Task) => void; onShare: (task: Task) => void }): JSX.Element {
  const query = createQuery(
    () => taskListKey('ongoing', ONGOING_PARAMS),
    () => tasksApi.list(ONGOING_PARAMS),
  );
  const tasks = () => query.data()?.results ?? [];
  const checked = () => tasks().filter((task) => task.today_checked).length;
  const skipped = () => tasks().filter((task) => task.today_skipped).length;

  return (
    <Show when={tasks().length > 0}>
      <section class={styles.checkins} aria-label={t('Task check-ins')}>
        <header class={styles.checkinsHead}>
          <InfinityIcon size={13} />
          <span>{t('Task check-ins')}</span>
          <span class={styles.checkinsCount}>
            {checked()}/{tasks().length}
          </span>
          <Show when={skipped() > 0}>
            <span class={cx(styles.checkinsCount, styles.checkinsSkipped)} title={t('Skipped today')}>
              <SkipForward size={9} /> {skipped()}
            </span>
          </Show>
          <span class={styles.checkinsHint}>{t('Long-term work - ticked daily')}</span>
        </header>
        <TaskList
          tasks={tasks()}
          compact
          showProject
          showKind
          onOpen={props.onOpen}
          onShare={props.onShare}
          onChanged={() => query.refetch()}
        />
      </section>
    </Show>
  );
}
