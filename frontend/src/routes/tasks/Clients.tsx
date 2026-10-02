// MyTasker — Clients: every job promised to a customer. Mine grouped by project, then who has what on People.
// Built by drogoz · https://github.com/deepdrogo/mytasker

import { A } from '@solidjs/router';
import { FolderKanban, Handshake, Rocket, UserRound, Users } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { Page } from '~/components/shared/Page';
import { EmptyState, ErrorNote, Skeleton } from '~/components/ui/Feedback';
import { projectsApi } from '~/features/projects/api';
import { ShareDialog } from '~/features/sharing/ShareDialog';
import { tasksApi, taskListKey, type TaskListParams } from '~/features/tasks/api';
import { splitByPerson, type PersonGroup } from '~/features/tasks/clientGroups';
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
/** Whose work is on screen: everyone, only mine, or one person's (by user id). */
type Focus = 'all' | 'mine' | number;

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
  const [focus, setFocus] = createSignal<Focus>('all');
  const [selected, setSelected] = createSignal<Set<number>>(new Set());
  const [activeTask, setActiveTask] = createSignal<Task | null>(null);
  const [shareTasks, setShareTasks] = createSignal<Task[] | null>(null);

  const params = (): TaskListParams => ({
    is_client: true,
    handed_out: true,
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
  const split = createMemo(() => splitByPerson(tasks()));

  const groups = createMemo<Group[]>(() => {
    const byProject = new Map<number, Task[]>();
    const loose: Task[] = [];
    for (const task of split().mine) {
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

  /** A person picked on the strip who no longer has anything here falls back to everyone. */
  const current = createMemo<Focus>(() => {
    const value = focus();
    if (typeof value === 'number' && !split().people.some((group) => group.person.id === value)) return 'all';
    return value;
  });
  const showMine = () => current() === 'all' || current() === 'mine';
  const shownPeople = createMemo<PersonGroup[]>(() => {
    const value = current();
    if (value === 'mine') return [];
    if (value === 'all') return split().people;
    return split().people.filter((group) => group.person.id === value);
  });
  /** Tasks on screen, once each, for "select all". */
  const visibleTasks = createMemo<Task[]>(() => {
    const seen = new Set<number>();
    const out: Task[] = [];
    for (const task of [...(showMine() ? split().mine : []), ...shownPeople().flatMap((group) => group.tasks)]) {
      if (seen.has(task.id)) continue;
      seen.add(task.id);
      out.push(task);
    }
    return out;
  });

  const pick = (value: Focus) => {
    setFocus(value);
    setSelected(new Set<number>());
  };
  const toggleSelect = (task: Task) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(task.id)) next.delete(task.id);
      else next.add(task.id);
      return next;
    });
  const selectedTasks = () => tasks().filter((task) => selected().has(task.id));
  const refresh = () => query.refetch();

  const list = (rows: Task[], options: { showProject: boolean; showKind: boolean }) => (
    <TaskList
      tasks={rows}
      showProject={options.showProject}
      showKind={options.showKind}
      selectable
      selectedIds={selected()}
      onToggleSelect={toggleSelect}
      onOpen={setActiveTask}
      onShare={(task) => setShareTasks([task])}
      onChanged={refresh}
    />
  );

  return (
    <Page
      title={t('Clients')}
      subtitle={t('Work promised to clients: yours by project, then who has what on People. It comes first in every list.')}
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
          total={() => visibleTasks().length}
          onSelectAll={() => setSelected(new Set(visibleTasks().map((task) => task.id)))}
          onChanged={refresh}
          onClear={() => setSelected(new Set<number>())}
          onShare={setShareTasks}
        />

        <Show when={!query.error()} fallback={<ErrorNote message={t('Could not load tasks.')} onRetry={refresh} />}>
          <Show when={query.data()} fallback={<Skeleton rows={6} height={44} />}>
            <Show
              when={tasks().length > 0}
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
              <Show when={split().people.length > 0}>
                <div class={styles.strip} role="tablist" aria-label={t('Whose work')}>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={current() === 'all'}
                    class={cx(styles.who, current() === 'all' && styles.whoActive)}
                    onClick={() => pick('all')}
                  >
                    <span class={cx(styles.avatar, styles.avatarIcon)} aria-hidden="true">
                      <Users size={13} />
                    </span>
                    <span class={styles.whoName}>{t('Everyone')}</span>
                    <span class={styles.whoCount}>{tasks().length}</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={current() === 'mine'}
                    class={cx(styles.who, current() === 'mine' && styles.whoActive)}
                    onClick={() => pick('mine')}
                  >
                    <span class={cx(styles.avatar, styles.avatarIcon)} aria-hidden="true">
                      <UserRound size={13} />
                    </span>
                    <span class={styles.whoName}>{t('Mine')}</span>
                    <span class={styles.whoCount}>{split().mine.length}</span>
                  </button>
                  <For each={split().people}>
                    {(group) => (
                      <button
                        type="button"
                        role="tab"
                        aria-selected={current() === group.person.id}
                        class={cx(styles.who, current() === group.person.id && styles.whoActive)}
                        onClick={() => pick(group.person.id)}
                        title={
                          group.overdue > 0 ? t('{count} overdue', { count: String(group.overdue) }) : undefined
                        }
                      >
                        <span class={styles.avatar} aria-hidden="true">
                          {group.person.display_name.charAt(0).toUpperCase()}
                        </span>
                        <span class={styles.whoName}>{group.person.display_name}</span>
                        <span class={styles.whoCount}>{group.tasks.length}</span>
                        <Show when={group.overdue > 0 && filter() === 'open'}>
                          <span class={styles.whoOverdue} aria-hidden="true" />
                        </Show>
                      </button>
                    )}
                  </For>
                </div>
              </Show>

              <div class={styles.sections}>
                <Show when={showMine()}>
                  <section class={styles.section} aria-label={t('My client work')}>
                    <Show when={split().people.length > 0}>
                      <h2 class={styles.sectionHead}>
                        <UserRound size={14} />
                        {t('My client work')}
                        <span class={styles.groupCount}>{tn(split().mine.length, 'task')}</span>
                      </h2>
                    </Show>
                    <Show
                      when={groups().length > 0}
                      fallback={<p class={styles.sectionEmpty}>{t('Everything here is handed to People.')}</p>}
                    >
                      <div class={styles.groups}>
                        <For each={groups()}>
                          {(group) => (
                            <section
                              class={cx(styles.group, group.loose && styles.groupLoose)}
                              aria-label={group.title}
                            >
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
                                    <Show
                                      when={group.project?.category === 'startup'}
                                      fallback={<FolderKanban size={13} />}
                                    >
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
                              {list(group.tasks, { showProject: false, showKind: group.loose })}
                            </section>
                          )}
                        </For>
                      </div>
                    </Show>
                  </section>
                </Show>

                <Show when={shownPeople().length > 0}>
                  <section class={styles.section} aria-label={t('Handed to People')}>
                    <h2 class={styles.sectionHead}>
                      <Users size={14} />
                      {t('Handed to People')}
                      <span class={styles.groupCount}>{tn(shownPeople().length, 'person', 'people')}</span>
                    </h2>
                    <div class={styles.groups}>
                      <For each={shownPeople()}>
                        {(group) => (
                          <section class={cx(styles.group, styles.personGroup)} aria-label={group.person.display_name}>
                            <header class={styles.personHead}>
                              <span class={cx(styles.avatar, styles.avatarLg)} aria-hidden="true">
                                {group.person.display_name.charAt(0).toUpperCase()}
                              </span>
                              <span class={styles.personText}>
                                <Show
                                  when={authStore.isAdmin()}
                                  fallback={<span class={styles.personName}>{group.person.display_name}</span>}
                                >
                                  <A href="/people" class={styles.personName} title={t('Open People')}>
                                    {group.person.display_name}
                                  </A>
                                </Show>
                                <span class={styles.personMeta}>
                                  {filter() === 'done'
                                    ? t('{count} completed', { count: String(group.tasks.length) })
                                    : t('{count} open', { count: String(group.tasks.length) })}
                                  <Show when={group.overdue > 0 && filter() === 'open'}>
                                    <span class={styles.personOverdue}>
                                      {t('{count} overdue', { count: String(group.overdue) })}
                                    </span>
                                  </Show>
                                </span>
                              </span>
                            </header>
                            {list(group.tasks, { showProject: true, showKind: true })}
                          </section>
                        )}
                      </For>
                    </div>
                  </section>
                </Show>
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
