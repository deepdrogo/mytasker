import { Share2, X } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { createSignal, Show } from 'solid-js';
import { Page } from '~/components/shared/Page';
import { Button } from '~/components/ui/Button';
import { Select } from '~/components/ui/Input';
import { ShareDialog } from '~/features/sharing/ShareDialog';
import { tasksApi, taskListKey, type TaskInput, type TaskListParams } from '~/features/tasks/api';
import { TaskComposer } from '~/features/tasks/TaskComposer';
import { TaskEditor } from '~/features/tasks/TaskEditor';
import { TaskList } from '~/features/tasks/TaskList';
import { createQuery } from '~/hooks/createQuery';
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
  showProject?: boolean;
  emptyTitle?: string;
  emptyHint?: string;
  tabs?: Array<{ label: string; href: string }>;
  defaultOrdering?: string;
}

const SORTS = [
  { value: 'manual', label: 'Manual' },
  { value: 'due', label: 'Deadline' },
  { value: '-priority', label: 'Priority' },
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

  return (
    <>
      <Page
        title={props.title}
        subtitle={props.subtitle}
        tabs={props.tabs}
        actions={
          <Select
            sizeVariant="sm"
            value={ordering()}
            onChange={(e) => {
              setOrdering(e.currentTarget.value);
              setPage(1);
            }}
            aria-label="Sort tasks"
          >
            {SORTS.map((sort) => (
              <option value={sort.value}>{sort.label}</option>
            ))}
          </Select>
        }
      >
        <div class={styles.wrap}>
          <Show when={!props.hideComposer}>
            <TaskComposer
              defaults={props.composerDefaults}
              placeholder={props.composerPlaceholder}
              onCreated={() => query.refetch()}
            />
          </Show>

          <Show when={selected().size > 0}>
            <div class={styles.selectionBar}>
              <span class="mt-mono">{selected().size} selected</span>
              <div class={styles.selectionActions}>
                <Button variant="secondary" size="sm" onClick={() => setShareTasks(selectedTasks())}>
                  <Share2 size={13} />
                  Share
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())} aria-label="Clear selection">
                  <X size={13} />
                </Button>
              </div>
            </div>
          </Show>

          <TaskList
            tasks={query.data()?.results}
            loading={query.loading()}
            error={query.error()}
            onRetry={query.refetch}
            onOpen={setActiveTask}
            onShare={(task) => setShareTasks([task])}
            onChanged={query.refetch}
            showProject={props.showProject}
            selectable
            selectedIds={selected()}
            onToggleSelect={toggleSelect}
            emptyTitle={props.emptyTitle}
            emptyHint={props.emptyHint}
          />

          <Show when={(query.data()?.count ?? 0) > 50}>
            <div class={styles.pager}>
              <Button variant="ghost" size="sm" disabled={page() === 1} onClick={() => setPage((p) => p - 1)}>
                Previous
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
                Next
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
