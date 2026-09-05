// MyTasker — Today / Tomorrow: one day's work and nothing else.
// Built by drogoz · https://github.com/deepdrogo/mytasker

import { Infinity as InfinityIcon, SkipForward } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import { tasksApi, taskListKey, type TaskListParams } from '~/features/tasks/api';
import { TaskList } from '~/features/tasks/TaskList';
import { TaskListPage } from '~/features/tasks/TaskListPage';
import { createQuery } from '~/hooks/createQuery';
import { intlLocale, t } from '~/i18n';
import type { Task } from '~/types';
import { cx } from '~/utils/cx';
import styles from './DayTaskListPage.module.css';

export type DayView = 'today' | 'tomorrow';

/** 23:59 local time, `offset` days from now - the default deadline for a task added on that day's page. */
export function endOfDay(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  d.setHours(23, 59, 0, 0);
  return d.toISOString();
}

function dayLabel(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toLocaleDateString(intlLocale(), { weekday: 'long', day: 'numeric', month: 'long' });
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
};

const TABS = [
  { label: 'Today', href: '/today' },
  { label: 'Tomorrow', href: '/tomorrow' },
];

/** Long-term work ticked once a day - it belongs on every day's page, not only where its (optional) deadline falls. */
const ONGOING_PARAMS: TaskListParams = {
  is_ongoing: true,
  completed: false,
  top_level: true,
  exclude_kind: 'crypto',
  ordering: 'priority',
  page_size: 50,
};

export function DayTaskListPage(props: { day: DayView }): JSX.Element {
  const copy = () => COPY[props.day];
  return (
    <TaskListPage
      title={t(copy().title)}
      subtitle={`${dayLabel(copy().offset)} · ${t(copy().subtitle)}`}
      queryName={props.day}
      // Ongoing work has its own block above the list, so the dated list stays about deadlines.
      params={() => ({ view: props.day, top_level: true, exclude_kind: 'crypto', is_ongoing: false })}
      composerDefaults={{ due_at: endOfDay(copy().offset) }}
      composerPlaceholder={t(copy().placeholder)}
      showProject
      showKind
      defaultOrdering="priority"
      tabs={TABS.map((tab) => ({ ...tab, label: t(tab.label) }))}
      emptyTitle={t(copy().emptyTitle)}
      emptyHint={t(copy().emptyHint)}
      beforeList={(ctx) => <DailyCheckins onOpen={ctx.openTask} onShare={ctx.shareTask} />}
    />
  );
}

/** Daily check-ins: the long tasks, with today's tick. Hidden when there are none. */
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
      <section class={styles.checkins} aria-label={t('Daily check-ins')}>
        <header class={styles.checkinsHead}>
          <InfinityIcon size={13} />
          <span>{t('Daily check-ins')}</span>
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
