import type { JSX } from 'solid-js';
import { createSignal, Show } from 'solid-js';
import { Page } from '~/components/shared/Page';
import { Button } from '~/components/ui/Button';
import { Select } from '~/components/ui/Input';
import { PolishButton } from '~/features/ai/PolishButton';
import { ShareDialog } from '~/features/sharing/ShareDialog';
import { tasksApi, taskListKey, type TaskInput, type TaskListParams } from '~/features/tasks/api';
import { TaskComposer } from '~/features/tasks/TaskComposer';
import { TaskEditor } from '~/features/tasks/TaskEditor';
import { TaskList } from '~/features/tasks/TaskList';
import { TaskSelectionBar } from '~/features/tasks/TaskSelectionBar';
import { createQuery } from '~/hooks/createQuery';
import { t } from '~/i18n';
import type { Task } from '~/types';
import styles from './TaskListPage.module.css';

interface TaskListPageProps {
  title: string;
  subtitle?: string;
  queryName: string;
  params: () => TaskListParams;
  composerDefaults?: TaskInput;
  composerPlaceholder?: string;
  hideComposer?: boolean;
  /** Let the composer attach the new task to a project (Business list). */
  composerProjectPicker?: boolean;
  showProject?: boolean;
  /** Tag each row with its list (Personal / Business / Crypto) - for views that mix them. */
  showKind?: boolean;
  emptyTitle?: string;
  emptyHint?: string;
  tabs?: Array<{ label: string; href: string }>;
  defaultOrdering?: string;
  /** Extra block rendered between the composer and the list (e.g. Today's daily check-ins). */
  beforeList?: (ctx: { openTask: (task: Task) => void; shareTask: (task: Task) => void }) => JSX.Element;
}

const SORTS = [
  { value: 'manual', label: 'Manual' },
  { value: 'due', label: 'Deadline' },
  { value: 'priority', label: 'Priority' }, // priority_rank asc: critical first
  { value: '-created', label: 'Recently created' },
  { value: '-updated', label: 'Recently updated' },
  { value: 'title', label: 'Title' },
];

export function TaskListPage(props: TaskListPageProps): JSX.Element {
  // eslint-disable-next-line solid/reactivity -- initial value only
  const [ordering, setOrdering] = createSignal(props.defaultOrdering ?? 'manual');
  const [page, setPage] = createSignal(1);
  const [selected, setSelected] = createSignal<Set<number>>(new Set());
  const [activeTask, setActiveTask] = createSignal<Task | null>(null);
  const [shareTasks, setShareTasks] = createSignal<Task[] | null>(null);

  const params = (): TaskListParams => ({
    ...props.params(),
    ordering: ordering(),
    page: page(),
    page_size: 50,
  });

  const query = createQuery(
    () => taskListKey(props.queryName, params()),
    () => tasksApi.list(params()),
  );

  const toggleSelect = (task: Task) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(task.id)) next.delete(task.id);
      else next.add(task.id);
      return next;
    });
  };

  const selectedTasks = () => (query.data()?.results ?? []).filter((t) => selected().has(t.id));
  // Whole-page polish covers what is on screen (one page = up to 50 tasks, the server-side cap).
  const pageTaskIds = () =>
    (query.data()?.results ?? []).filter((task) => task.can_edit && task.status !== 'done').map((task) => task.id);

  return (
    <>
      <Page
        title={props.title}
        subtitle={props.subtitle}
        tabs={props.tabs}
        actions={
          <div class={styles.headActions}>
            <PolishButton taskIds={pageTaskIds} label={t('Polish all with AI')} onChanged={() => query.refetch()} />
            <Select
              sizeVariant="sm"
              value={ordering()}
              onChange={(e) => {
                setOrdering(e.currentTarget.value);
                setPage(1);
              }}
              aria-label={t('Sort tasks')}
            >
              {SORTS.map((sort) => (
                <option value={sort.value}>{t(sort.label)}</option>
              ))}
            </Select>
          </div>
        }
      >
        <div class={styles.wrap}>
          <Show when={!props.hideComposer}>
            <TaskComposer
              defaults={props.composerDefaults}
              placeholder={props.composerPlaceholder}
              projectPicker={props.composerProjectPicker}
              onCreated={() => query.refetch()}
            />
          </Show>

          <Show when={props.beforeList}>
            {(render) => render()({ openTask: setActiveTask, shareTask: (task) => setShareTasks([task]) })}
          </Show>

          <TaskSelectionBar
            tasks={selectedTasks}
            total={() => query.data()?.results.length ?? 0}
            onSelectAll={() => setSelected(new Set((query.data()?.results ?? []).map((task) => task.id)))}
            onChanged={() => query.refetch()}
            onClear={() => setSelected(new Set<number>())}
            onShare={setShareTasks}
          />

          <TaskList
            tasks={query.data()?.results}
            loading={query.loading()}
            error={query.error()}
            onRetry={query.refetch}
            onOpen={setActiveTask}
            onShare={(task) => setShareTasks([task])}
            onChanged={query.refetch}
            showProject={props.showProject}
            showKind={props.showKind}
            selectable
            selectedIds={selected()}
            onToggleSelect={toggleSelect}
            emptyTitle={props.emptyTitle}
            emptyHint={props.emptyHint}
          />

          <Show when={(query.data()?.count ?? 0) > 50}>
            <div class={styles.pager}>
              <Button variant="ghost" size="sm" disabled={page() === 1} onClick={() => setPage((p) => p - 1)}>
                {t('Previous')}
              </Button>
              <span class="mt-mono mt-dim">
                {page()} / {Math.ceil((query.data()?.count ?? 0) / 50)}
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={!query.data()?.next}
                onClick={() => setPage((p) => p + 1)}
              >
                {t('Next')}
              </Button>
            </div>
          </Show>
        </div>
      </Page>

      <TaskEditor
        task={activeTask()}
        open={activeTask() !== null}
        onClose={() => setActiveTask(null)}
        onChanged={() => {
          query.refetch();
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
    </>
  );
}
