// MyTasker — Clients: every job promised to a customer, grouped by project, pinned first everywhere.
// Built by drogoz · https://github.com/deepdrogo/mytasker

import { A } from '@solidjs/router';
import { FolderKanban, Handshake, Rocket } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { Page } from '~/components/shared/Page';
import { EmptyState, ErrorNote, Skeleton } from '~/components/ui/Feedback';
import { projectsApi } from '~/features/projects/api';
import { ShareDialog } from '~/features/sharing/ShareDialog';
import { tasksApi, taskListKey, type TaskListParams } from '~/features/tasks/api';
import { TaskComposer } from '~/features/tasks/TaskComposer';
import { TaskEditor } from '~/features/tasks/TaskEditor';
import { TaskList } from '~/features/tasks/TaskList';
import { TaskSelectionBar } from '~/features/tasks/TaskSelectionBar';
import { createQuery } from '~/hooks/createQuery';
import { t, tn } from '~/i18n';
import { authStore } from '~/stores/auth';
import { tx } from '~/stores/translations';
import type { Project, Task } from '~/types';
import { cx } from '~/utils/cx';
import { percent } from '~/utils/format';
import styles from './Clients.module.css';

type Filter = 'open' | 'done';

interface Group {
  key: string;
  title: string;
  href?: string;
  project?: Project;
  /** Loose client work with no project behind it. */
  loose: boolean;
  tasks: Task[];
}

export default function Clients(): JSX.Element {
  const [filter, setFilter] = createSignal<Filter>('open');
  const [selected, setSelected] = createSignal<Set<number>>(new Set());
  const [activeTask, setActiveTask] = createSignal<Task | null>(null);
  const [shareTasks, setShareTasks] = createSignal<Task[] | null>(null);

  const params = (): TaskListParams => ({
    is_client: true,
    top_level: true,
    completed: filter() === 'done',
    include_subtasks: '1',
    ordering: filter() === 'done' ? '-completed' : 'priority',
    page_size: 200,
  });
  const query = createQuery(
    () => taskListKey('clients', params()),
    () => tasksApi.list(params()),
  );
  const projects = createQuery(
    () => 'projects:clients',
    () => projectsApi.list({ view: 'open', ordering: 'manual', page_size: 100 }),
    { staleMs: 30_000 },
  );

  const tasks = () => query.data()?.results ?? [];

  const groups = createMemo<Group[]>(() => {
    const byProject = new Map<number, Task[]>();
    const loose: Task[] = [];
    for (const task of tasks()) {
      if (task.project) byProject.set(task.project.id, [...(byProject.get(task.project.id) ?? []), task]);
      else loose.push(task);
    }
    const known = new Map((projects.data()?.results ?? []).map((project) => [project.id, project] as const));
    // Projects in the user's own order first, then any project the list references but the project list did not return.
    const ids = [
      ...(projects.data()?.results ?? []).filter((project) => byProject.has(project.id)).map((project) => project.id),
      ...[...byProject.keys()].filter((id) => !known.has(id)),
    ];
    const out: Group[] = ids.map((id) => {
      const project = known.get(id);
      const grouped = byProject.get(id) ?? [];
      return {
        key: `p${id}`,
        title: tx('project', id, 'name', project?.name ?? grouped[0]?.project?.name ?? ''),
        href: authStore.isAssistant() ? undefined : `/projects/${id}/tasks`,
        project,
        loose: false,
        tasks: grouped,
      };
    });
    if (loose.length > 0) out.push({ key: 'loose', title: t('Without a project'), loose: true, tasks: loose });
    return out;
  });

  const toggleSelect = (task: Task) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(task.id)) next.delete(task.id);
      else next.add(task.id);
      return next;
    });
  const selectedTasks = () => tasks().filter((task) => selected().has(task.id));
  const refresh = () => query.refetch();

  return (
    <Page
      title={t('Clients')}
      subtitle={t('Work promised to clients, grouped by project. It comes first in every list and on the Dashboard.')}
      actions={
        <div class={styles.filters} role="tablist" aria-label={t('Show')}>
          <For each={['open', 'done'] as const}>
            {(value) => (
              <button
                type="button"
                role="tab"
                aria-selected={filter() === value}
                class={cx(styles.chip, filter() === value && styles.chipActive)}
                onClick={() => {
                  setFilter(value);
                  setSelected(new Set<number>());
                }}
              >
                {value === 'open' ? t('Open') : t('Completed')}
              </button>
            )}
          </For>
        </div>
      }
    >
      <div class={styles.wrap}>
        <TaskComposer
          defaults={{ kind: 'business', is_client: true }}
          placeholder={t('Add a client task… pick the project it belongs to')}
          projectPicker
          personPicker
          onCreated={refresh}
        />

        <TaskSelectionBar
          tasks={selectedTasks}
          total={() => tasks().length}
          onSelectAll={() => setSelected(new Set(tasks().map((task) => task.id)))}
          onChanged={refresh}
          onClear={() => setSelected(new Set<number>())}
          onShare={setShareTasks}
        />

        <Show when={!query.error()} fallback={<ErrorNote message={t('Could not load tasks.')} onRetry={refresh} />}>
          <Show when={query.data()} fallback={<Skeleton rows={6} height={44} />}>
            <Show
              when={groups().length > 0}
              fallback={
                <EmptyState
                  icon={<Handshake size={20} />}
                  title={filter() === 'done' ? t('No completed client work yet.') : t('No client work pending.')}
                  hint={
                    filter() === 'done'
                      ? undefined
                      : t('Add one above, or tick “Client task” on any existing task and it lands here.')
                  }
                />
              }
            >
              <div class={styles.groups}>
                <For each={groups()}>
                  {(group) => (
                    <section class={cx(styles.group, group.loose && styles.groupLoose)} aria-label={group.title}>
                      <header class={styles.groupHead}>
                        <Show
                          when={group.href}
                          fallback={
                            <span class={styles.groupTitle}>
                              <Handshake size={13} />
                              {group.title}
                            </span>
                          }
                        >
                          <A href={group.href!} class={styles.groupTitle}>
                            <Show when={group.project?.category === 'startup'} fallback={<FolderKanban size={13} />}>
                              <Rocket size={13} />
                            </Show>
                            {group.title}
                          </A>
                        </Show>
                        <span class={styles.groupCount}>{tn(group.tasks.length, 'task')}</span>
                        <Show when={group.project && (group.project.task_total ?? 0) > 0}>
                          <span class={styles.groupProgress} title={t('Project progress')}>
                            {percent(group.project!.task_done, group.project!.task_total)}%
                          </span>
                        </Show>
                      </header>
                      <TaskList
                        tasks={group.tasks}
                        showProject={false}
                        showKind={group.loose}
                        selectable
                        selectedIds={selected()}
                        onToggleSelect={toggleSelect}
                        onOpen={setActiveTask}
                        onShare={(task) => setShareTasks([task])}
                        onChanged={refresh}
                      />
                    </section>
                  )}
                </For>
              </div>
            </Show>
          </Show>
        </Show>
      </div>

      <TaskEditor
        task={activeTask()}
        open={activeTask() !== null}
        onClose={() => setActiveTask(null)}
        onChanged={() => {
          refresh();
          const current = activeTask();
          if (current) void tasksApi.get(current.id).then(setActiveTask).catch(() => setActiveTask(null));
        }}
        onShare={(task) => setShareTasks([task])}
        onOpenTask={(task) => void tasksApi.get(task.id).then(setActiveTask).catch(() => setActiveTask(task))}
      />
      <ShareDialog
        tasks={shareTasks()}
        open={shareTasks() !== null}
        onClose={() => {
          setShareTasks(null);
          setSelected(new Set<number>());
        }}
      />
    </Page>
  );
}
