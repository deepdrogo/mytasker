import { ListTodo } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { For, Show } from 'solid-js';
import { EmptyState, ErrorNote, Skeleton } from '~/components/ui/Feedback';
import { TaskRow } from '~/features/tasks/TaskRow';
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
  compact?: boolean;
  selectable?: boolean;
  selectedIds?: Set<number>;
  onToggleSelect?: (task: Task) => void;
}

export function TaskList(props: TaskListProps): JSX.Element {
  return (
    <Show
      when={!props.error}
      fallback={<ErrorNote message="Could not load tasks." onRetry={props.onRetry} />}
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
                title={props.emptyTitle ?? 'No tasks here.'}
                hint={props.emptyHint}
                action={props.emptyAction}
                compact
              />
            }
          >
            <div class={styles.list} role="list">
              <For each={tasks()}>
                {(task) => (
                  <TaskRow
                    task={task}
                    onOpen={props.onOpen}
                    onShare={props.onShare}
                    onChanged={props.onChanged}
                    showProject={props.showProject}
                    compact={props.compact}
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
