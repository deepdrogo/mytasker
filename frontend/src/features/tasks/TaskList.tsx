import { GripVertical, ListTodo } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { createComputed, For, Show } from 'solid-js';
import { createStore, reconcile, unwrap } from 'solid-js/store';
import { EmptyState, ErrorNote, Skeleton } from '~/components/ui/Feedback';
import { TaskRow } from '~/features/tasks/TaskRow';
import { createSortable } from '~/hooks/createSortable';
import { t } from '~/i18n';
import { tx } from '~/stores/translations';
import { toast } from '~/stores/ui';
import type { Task } from '~/types';
import { cx } from '~/utils/cx';
import styles from './TaskList.module.css';

interface TaskListProps {
  tasks: Task[] | undefined;
  loading?: boolean;
  error?: unknown;
  emptyTitle?: string;
  emptyHint?: string;
  emptyAction?: JSX.Element;
  onRetry?: () => void;
  onOpen?: (task: Task) => void;
  onShare?: (task: Task) => void;
  onChanged?: () => void;
  showProject?: boolean;
  showKind?: boolean;
  compact?: boolean;
  /** Narrow-column mode: titles wrap to two lines, badges hidden (see TaskRow). */
  dense?: boolean;
  selectable?: boolean;
  selectedIds?: Set<number>;
  onToggleSelect?: (task: Task) => void;
  /** Show the date each task was added (hand-over lists). */
  showCreated?: boolean;
  /** Drag-to-reorder: called with the whole list in its new order (manual-order lists only). */
  onReorder?: (tasks: Task[]) => Promise<unknown>;
}

/**
 * Rows are keyed by task id through a reconciled store: when a refetch lands, unchanged rows keep their
 * DOM (and hover / menu state), changed rows update the fields that changed, and only genuinely new or
 * removed tasks are mounted or unmounted. Without this every refetch rebuilt the whole list.
 */
export function TaskList(props: TaskListProps): JSX.Element {
  const [store, setStore] = createStore<{ items: Task[] }>({ items: [] });
  createComputed(() => {
    const list = props.tasks;
    if (list) setStore('items', reconcile(list, { key: 'id' }));
  });
  /** Hand callers a plain snapshot, not the live store proxy, so editors are not reset by background refetches. */
  const snapshot = (task: Task): Task => ({ ...unwrap(task) });

  return (
    <Show
      when={!props.error}
      fallback={<ErrorNote message={t('Could not load tasks.')} onRetry={props.onRetry} />}
    >
      <Show
        when={props.tasks}
        fallback={<Show when={props.loading}><Skeleton rows={5} height={38} /></Show>}
      >
        {(tasks) => (
          <Show
            when={tasks().length > 0}
            fallback={
              <EmptyState
                icon={<ListTodo size={20} />}
                title={props.emptyTitle ?? t('No tasks here.')}
                hint={props.emptyHint}
                action={props.emptyAction}
                compact
              />
            }
          >
            <Show when={props.onReorder && tasks().length > 1} fallback={
            <div class={styles.list} role="list">
              <For each={store.items}>
                {(task) => (
                  <TaskRow
                    task={task}
                    onOpen={props.onOpen ? (item) => props.onOpen?.(snapshot(item)) : undefined}
                    onShare={props.onShare ? (item) => props.onShare?.(snapshot(item)) : undefined}
                    onChanged={props.onChanged}
                    showProject={props.showProject}
                    showKind={props.showKind}
                    compact={props.compact}
                    dense={props.dense}
                    showCreated={props.showCreated}
                    selectable={props.selectable}
                    selected={props.selectedIds?.has(task.id)}
                    onToggleSelect={props.onToggleSelect}
                  />
                )}
              </For>
            </div>
            }>
              <SortableRows {...props} tasks={tasks()} snapshot={snapshot} />
            </Show>
          </Show>
        )}
      </Show>
    </Show>
  );
}

/** The same rows with a grip on each: drag (or arrow keys on the grip) to put them in order. */
function SortableRows(props: TaskListProps & { tasks: Task[]; snapshot: (task: Task) => Task }): JSX.Element {
  const sortable = createSortable<Task>({
    items: () => props.tasks,
    key: (task) => task.id,
    onReorder: async (items) => {
      try {
        await props.onReorder?.(items);
      } catch {
        toast(t('Could not save the order.'));
        props.onChanged?.();
      }
    },
  });
  return (
    <div class={styles.list} role="list" ref={sortable.setContainer}>
      <For each={sortable.items()}>
        {(task, index) => (
          <div
            class={cx(styles.sortRow, sortable.isDragging(task) && styles.sortRowDragging)}
            {...sortable.itemProps(task)}
            style={sortable.itemStyle(task)}
          >
            <button
              type="button"
              class={styles.grip}
              {...sortable.handleProps(task)}
              aria-label={t('Reorder {name} ({position} of {total})', {
                name: tx('task', task.id, 'title', task.title),
                position: index() + 1,
                total: sortable.items().length,
              })}
              title={t('Drag to reorder · arrow keys to move')}
            >
              <GripVertical size={14} />
            </button>
            <TaskRow
              task={task}
              onOpen={props.onOpen ? (item) => props.onOpen?.(props.snapshot(item)) : undefined}
              onShare={props.onShare ? (item) => props.onShare?.(props.snapshot(item)) : undefined}
              onChanged={props.onChanged}
              showProject={props.showProject}
              showKind={props.showKind}
              compact={props.compact}
              dense={props.dense}
              showCreated={props.showCreated}
              selectable={props.selectable}
              selected={props.selectedIds?.has(task.id)}
              onToggleSelect={props.onToggleSelect}
            />
          </div>
        )}
      </For>
    </div>
  );
}
