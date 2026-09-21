import { ListTodo } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { createComputed, For, Show } from 'solid-js';
import { createStore, reconcile, unwrap } from 'solid-js/store';
import { EmptyState, ErrorNote, Skeleton } from '~/components/ui/Feedback';
import { TaskRow } from '~/features/tasks/TaskRow';
import { t } from '~/i18n';
import type { Task } from '~/types';
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
          </Show>
        )}
      </Show>
    </Show>
  );
}
