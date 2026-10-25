// MyTasker — "From <name>": the work one person handed to me. Exists only while they have given me something.
// Built by drogoz · https://github.com/deepdrogo/mytasker

import { Navigate, useParams } from '@solidjs/router';
import type { JSX } from 'solid-js';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { Page } from '~/components/shared/Page';
import { Skeleton } from '~/components/ui/Feedback';
import { peopleApi } from '~/features/people/api';
import { ShareDialog } from '~/features/sharing/ShareDialog';
import { tasksApi, taskListKey, type TaskListParams } from '~/features/tasks/api';
import { TaskEditor } from '~/features/tasks/TaskEditor';
import { TaskList } from '~/features/tasks/TaskList';
import { createQuery } from '~/hooks/createQuery';
import { t } from '~/i18n';
import type { Task } from '~/types';
import { cx } from '~/utils/cx';
import styles from './tasks/Clients.module.css';

type Filter = 'open' | 'done';

export default function From(): JSX.Element {
  const params = useParams<{ ownerId: string }>();
  const ownerId = () => Number(params.ownerId);
  const [filter, setFilter] = createSignal<Filter>('open');
  const [activeTask, setActiveTask] = createSignal<Task | null>(null);
  const [shareTasks, setShareTasks] = createSignal<Task[] | null>(null);

  const delegators = createQuery(() => 'people:delegators', () => peopleApi.delegators(), { staleMs: 10_000 });
  const giver = createMemo(() => delegators.data()?.find((row) => row.user.id === ownerId()) ?? null);

  const listParams = (): TaskListParams => ({
    delegated_by: ownerId(),
    top_level: true,
    completed: filter() === 'done',
    ordering: filter() === 'done' ? '-completed' : 'priority',
    include_subtasks: '1',
    page_size: 200,
  });
  const query = createQuery(
    () => taskListKey(`from-${ownerId()}`, listParams()),
    () => tasksApi.list(listParams()),
  );
  const refresh = () => query.refetch();

  return (
    <Show when={!delegators.data() || giver()} fallback={<Navigate href="/dashboard" />}>
      <Page
        title={giver()?.user.display_name ?? t('From')}
        subtitle={t('Tasks {name} handed to you. Complete, comment and edit them - only {name} can delete.', {
          name: giver()?.user.display_name ?? '…',
        })}
        actions={
          <div class={styles.filters} role="tablist" aria-label={t('Show')}>
            <For each={['open', 'done'] as const}>
              {(value) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={filter() === value}
                  class={cx(styles.chip, filter() === value && styles.chipActive)}
                  onClick={() => setFilter(value)}
                >
                  {value === 'open'
                    ? `${t('Open')} · ${giver()?.open_count ?? 0}`
                    : `${t('Completed')} · ${giver()?.done_count ?? 0}`}
                </button>
              )}
            </For>
          </div>
        }
      >
        <div class={styles.wrap}>
          <Show when={query.data() || query.error()} fallback={<Skeleton rows={5} height={44} />}>
            <TaskList
              tasks={query.data()?.results}
              loading={query.loading()}
              error={query.error()}
              onRetry={refresh}
              onOpen={setActiveTask}
              onShare={(task) => setShareTasks([task])}
              onChanged={refresh}
              showProject
              showKind
              showCreated
              emptyTitle={filter() === 'done' ? t('Nothing completed yet.') : t('Nothing open right now.')}
              emptyHint={filter() === 'done' ? undefined : t('New tasks from {name} land here the moment they are handed over.', { name: giver()?.user.display_name ?? '' })}
            />
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
        <ShareDialog tasks={shareTasks()} open={shareTasks() !== null} onClose={() => setShareTasks(null)} />
      </Page>
    </Show>
  );
}
