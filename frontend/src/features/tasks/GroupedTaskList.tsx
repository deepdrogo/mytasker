// MyTasker — a task list cut into themes: one block per project, then loose Clients / Business / Personal.
// Built by drogoz · https://github.com/deepdrogo/mytasker

import { A } from '@solidjs/router';
import { Briefcase, FolderKanban, Handshake, User } from 'lucide-solid';
import type { ComponentProps, JSX } from 'solid-js';
import { createMemo, For, Show, splitProps } from 'solid-js';
import { priorityTone, type PriorityTone } from '~/features/tasks/priority';
import { groupByProject, LOOSE_LABEL, type TaskGroup } from '~/features/tasks/projectGroups';
import { TaskList } from '~/features/tasks/TaskList';
import { t } from '~/i18n';
import { tx } from '~/stores/translations';
import { cx } from '~/utils/cx';
import styles from './GroupedTaskList.module.css';

type TaskListProps = ComponentProps<typeof TaskList>;

const ICON: Record<TaskGroup['kind'], () => JSX.Element> = {
  project: () => <FolderKanban size={13} />,
  client: () => <Handshake size={13} />,
  business: () => <Briefcase size={13} />,
  personal: () => <User size={13} />,
};

export function GroupedTaskList(props: TaskListProps): JSX.Element {
  const [local, rest] = splitProps(props, ['tasks', 'loading', 'error']);
  const groups = createMemo(() => groupByProject(local.tasks ?? []));
  const byKey = createMemo(() => new Map(groups().map((group) => [group.key, group])));

  return (
    <Show
      when={!local.error && local.tasks && local.tasks.length > 0}
      // Loading, error and empty states stay exactly as the plain list draws them.
      fallback={<TaskList {...rest} tasks={local.tasks} loading={local.loading} error={local.error} />}
    >
      <div class={styles.groups}>
        {/* Keyed by group, so a refetch updates a block in place instead of remounting it. */}
        <For each={groups().map((group) => group.key)}>
          {(key) => {
            const group = () => byKey().get(key);
            return (
              <Show when={group()}>
                {(current) => <GroupBlock group={current()} list={rest} />}
              </Show>
            );
          }}
        </For>
      </div>
    </Show>
  );
}

function GroupBlock(props: { group: TaskGroup; list: Omit<TaskListProps, 'tasks' | 'loading' | 'error'> }): JSX.Element {
  const tally = (tone: PriorityTone) =>
    props.group.tasks.filter((task) => task.status !== 'done' && priorityTone(task.priority) === tone).length;
  const label = () =>
    props.group.kind === 'project' && props.group.projectId !== null
      ? tx('project', props.group.projectId, 'name', props.group.name)
      : t(LOOSE_LABEL[props.group.kind as Exclude<TaskGroup['kind'], 'project'>]);

  return (
    <section class={styles.group} aria-label={label()}>
      <header class={styles.head}>
        <span class={styles.icon}>{ICON[props.group.kind]()}</span>
        <Show when={props.group.projectId} fallback={<span class={styles.name}>{label()}</span>}>
          {(id) => (
            <A href={`/projects/${id()}/tasks`} class={styles.name}>
              {label()}
            </A>
          )}
        </Show>
        <span class={styles.count}>{props.group.tasks.length}</span>
        <Show when={tally('red') > 0}>
          <span class={cx(styles.tone, styles.red)} title={t('Critical')}>
            <i /> {tally('red')}
          </span>
        </Show>
        <Show when={tally('yellow') > 0}>
          <span class={cx(styles.tone, styles.yellow)} title={t('High')}>
            <i /> {tally('yellow')}
          </span>
        </Show>
      </header>
      {/* Every row in a project block already sits under its name. */}
      <TaskList {...props.list} tasks={props.group.tasks} showProject={props.group.kind === 'project' ? false : props.list.showProject} />
    </section>
  );
}
