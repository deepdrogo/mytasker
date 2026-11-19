// MyTasker — the Dashboard's task strip (at the very top): Today, Tomorrow and Later stacked in tight blocks, each cut by project,
// each row tagged Client, Personal or Business. Tick to complete, yellow / red dots for priority, folder to file it.

import { A } from '@solidjs/router';
import { Briefcase, Check, FolderKanban, Handshake, Megaphone, User } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { tasksApi, taskListKey, type TaskListParams } from '~/features/tasks/api';
import { priorityTone } from '~/features/tasks/priority';
import { PriorityDots } from '~/features/tasks/PriorityDots';
import { groupByProject, LOOSE_LABEL, type TaskGroup } from '~/features/tasks/projectGroups';
import { QuickProjectPicker } from '~/features/tasks/QuickProjectPicker';
import { TaskEditor } from '~/features/tasks/TaskEditor';
import { createQuery } from '~/hooks/createQuery';
import { t } from '~/i18n';
import { authStore } from '~/stores/auth';
import { tx } from '~/stores/translations';
import { toast } from '~/stores/ui';
import type { ID, Task } from '~/types';
import { formatDate, formatDueDate } from '~/utils/format';
import styles from './TaskAgenda.module.css';

const BASE: TaskListParams = { top_level: true, exclude_kind: 'crypto', is_ongoing: false, page_size: 100 };
const TODAY: TaskListParams = { ...BASE, view: 'today' };
const TOMORROW: TaskListParams = { ...BASE, view: 'tomorrow' };
const UPCOMING: TaskListParams = { ...BASE, view: 'upcoming', ordering: 'due' };

type Tag = { label: string; tone: 'client' | 'ad' | 'personal' | 'business' };

function tagFor(task: Task): Tag {
  if (task.is_client) return { label: 'Client', tone: 'client' };
  if (task.is_ad) return { label: 'Ad', tone: 'ad' };
  if (task.kind === 'personal') return { label: 'Personal', tone: 'personal' };
  return { label: 'Business', tone: 'business' };
}

export function TaskAgenda(): JSX.Element {
  const today = createQuery(() => taskListKey('dash-today', TODAY), () => tasksApi.list(TODAY));
  const tomorrow = createQuery(() => taskListKey('dash-tomorrow', TOMORROW), () => tasksApi.list(TOMORROW));
  const upcoming = createQuery(() => taskListKey('dash-upcoming', UPCOMING), () => tasksApi.list(UPCOMING));

  /** Ticked rows vanish at once; the refetch after `complete` confirms it. */
  const [hidden, setHidden] = createSignal<Set<ID>>(new Set());
  const [active, setActive] = createSignal<Task | null>(null);

  const visible = (tasks: Task[] | undefined) => (tasks ?? []).filter((task) => !hidden().has(task.id));
  const todayTasks = createMemo(() => visible(today.data()?.results));
  const tomorrowTasks = createMemo(() => visible(tomorrow.data()?.results));
  /** "Upcoming" starts tomorrow, so Later is upcoming minus what Tomorrow already holds. */
  const laterTasks = createMemo(() => {
    const taken = new Set(tomorrowTasks().map((task) => task.id));
    return visible(upcoming.data()?.results).filter((task) => !taken.has(task.id));
  });

  const hide = (id: ID, on: boolean) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const complete = async (task: Task) => {
    hide(task.id, true);
    try {
      await tasksApi.complete(task.id);
      toast(t('Done'), {
        action: {
          label: t('Undo'),
          run: () => void tasksApi.reopen(task.id).then(() => hide(task.id, false)),
        },
      });
    } catch {
      hide(task.id, false);
      toast(t('Could not update the task.'));
    }
  };

  const loaded = () => today.data() && tomorrow.data() && upcoming.data();
  const refreshAll = () => {
    today.refetch();
    tomorrow.refetch();
    upcoming.refetch();
  };

  return (
    <section class={styles.agenda} aria-label={t('Tasks')}>
      <div class={styles.head}>
        <span>{t('Tasks')}</span>
        <Show when={loaded()}>
          <span class={styles.total}>{todayTasks().length + tomorrowTasks().length + laterTasks().length}</span>
        </Show>
        <A href="/tasks/all" class={styles.headLink}>
          {t('All')} →
        </A>
      </div>
      <div class={styles.columns}>
        <Column title={t('Today')} href="/today" tasks={todayTasks()} loading={!today.data()} when="today" onDone={complete} onOpen={setActive} onChanged={refreshAll} />
        <Column title={t('Tomorrow')} href="/tomorrow" tasks={tomorrowTasks()} loading={!tomorrow.data()} when="tomorrow" onDone={complete} onOpen={setActive} onChanged={refreshAll} />
        <Column title={t('Later')} href="/tasks/upcoming" tasks={laterTasks()} loading={!upcoming.data()} when="later" onDone={complete} onOpen={setActive} onChanged={refreshAll} />
      </div>
      <TaskEditor
        task={active()}
        open={active() !== null}
        onClose={() => setActive(null)}
        onOpenTask={(task) => void tasksApi.get(task.id).then(setActive).catch(() => setActive(task))}
      />
    </section>
  );
}

const GROUP_ICON: Record<TaskGroup['kind'], () => JSX.Element> = {
  project: () => <FolderKanban size={11} />,
  client: () => <Handshake size={11} />,
  ad: () => <Megaphone size={11} />,
  business: () => <Briefcase size={11} />,
  personal: () => <User size={11} />,
};

function Column(props: {
  title: string;
  href: string;
  tasks: Task[];
  loading: boolean;
  when: 'today' | 'tomorrow' | 'later';
  onDone: (task: Task) => void;
  onOpen: (task: Task) => void;
  onChanged: () => void;
}): JSX.Element {
  const groups = createMemo(() => groupByProject(props.tasks));
  const groupLabel = (group: TaskGroup) =>
    group.projectId !== null
      ? tx('project', group.projectId, 'name', group.name)
      : t(LOOSE_LABEL[group.kind as Exclude<TaskGroup['kind'], 'project'>]);
  return (
    <div class={styles.column}>
      <A href={props.href} class={styles.columnHead}>
        <span>{props.title}</span>
        <span class={styles.count}>{props.loading ? '·' : props.tasks.length}</span>
      </A>
      <Show when={!props.loading && props.tasks.length === 0}>
        <p class={styles.empty}>{t('Nothing due.')}</p>
      </Show>
      {/* Every task is here; a long day scrolls inside its own block, not the page. */}
      <div class={styles.scroll}>
      <For each={groups()}>
        {(group) => (
          <div class={styles.group}>
            <Show
              when={group.projectId}
              fallback={
                <span class={styles.groupHead}>
                  {GROUP_ICON[group.kind]()}
                  <span class={styles.groupName}>{groupLabel(group)}</span>
                </span>
              }
            >
              {(id) => (
                <A href={`/projects/${id()}/tasks`} class={styles.groupHead}>
                  {GROUP_ICON[group.kind]()}
                  <span class={styles.groupName}>{groupLabel(group)}</span>
                </A>
              )}
            </Show>
            <ul class={styles.list}>
              <For each={group.tasks}>
                {(task) => (
                  <Row task={task} when={props.when} onDone={props.onDone} onOpen={props.onOpen} onChanged={props.onChanged} />
                )}
              </For>
            </ul>
          </div>
        )}
      </For>
      </div>
    </div>
  );
}

function Row(props: {
  task: Task;
  when: 'today' | 'tomorrow' | 'later';
  onDone: (task: Task) => void;
  onOpen: (task: Task) => void;
  onChanged: () => void;
}): JSX.Element {
  const tag = () => tagFor(props.task);
  const use12h = () => authStore.user()?.preferences.time_format === '12h';
  const title = () => tx('task', props.task.id, 'title', props.task.title);
  const meta = () => {
    const task = props.task;
    if (!task.due_at) return '';
    if (props.when === 'later') return formatDate(task.due_at);
    if (task.is_overdue) return formatDate(task.due_at);
    return task.due_has_time ? (formatDueDate(task.due_at, true, use12h()).split(' ').pop() ?? '') : '';
  };
  return (
    <li
      class={[
        styles.row,
        props.task.is_overdue ? styles.overdue : '',
        priorityTone(props.task.priority) === 'red' ? styles.urgent : '',
        priorityTone(props.task.priority) === 'yellow' ? styles.warn : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <button type="button" class={styles.check} onClick={() => props.onDone(props.task)} aria-label={t('Mark done')} title={t('Mark done')}>
        <Check size={11} />
      </button>
      <button type="button" class={styles.title} onClick={() => props.onOpen(props.task)} title={title()}>
        {title()}
      </button>
      <span class={[styles.tag, styles[tag().tone]].join(' ')}>{t(tag().label)}</span>
      <Show when={meta()}>
        <span class={styles.meta} title={props.task.is_overdue ? t('Overdue') : undefined}>
          {meta()}
        </span>
      </Show>
      <span class={styles.quick}>
        <PriorityDots task={props.task} size="sm" onChanged={props.onChanged} />
        <Show when={props.task.can_edit && props.task.parent === null}>
          <QuickProjectPicker task={props.task} size="sm" onChanged={props.onChanged} />
        </Show>
      </span>
    </li>
  );
}
