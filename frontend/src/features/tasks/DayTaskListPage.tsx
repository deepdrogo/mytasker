// MyTasker — Today / Tomorrow: one day's work and nothing else.
// Built by drogoz · https://github.com/deepdrogo/mytasker

import type { JSX } from 'solid-js';
import { TaskListPage } from '~/features/tasks/TaskListPage';
import { intlLocale, t } from '~/i18n';

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

export function DayTaskListPage(props: { day: DayView }): JSX.Element {
  const copy = () => COPY[props.day];
  return (
    <TaskListPage
      title={t(copy().title)}
      subtitle={`${dayLabel(copy().offset)} · ${t(copy().subtitle)}`}
      queryName={props.day}
      params={() => ({ view: props.day, top_level: true, exclude_kind: 'crypto' })}
      composerDefaults={{ due_at: endOfDay(copy().offset) }}
      composerPlaceholder={t(copy().placeholder)}
      showProject
      defaultOrdering="priority"
      tabs={TABS.map((tab) => ({ ...tab, label: t(tab.label) }))}
      emptyTitle={t(copy().emptyTitle)}
      emptyHint={t(copy().emptyHint)}
    />
  );
}
