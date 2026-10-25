// MyTasker — "For <name>": a linked assistant writes tasks into someone's lists and sees only what it wrote there.
// Built by drogoz · https://github.com/deepdrogo/mytasker

import { Navigate, useParams } from '@solidjs/router';
import type { JSX } from 'solid-js';
import { createMemo, createSignal, For as Each, Show } from 'solid-js';
import { Page } from '~/components/shared/Page';
import { Skeleton } from '~/components/ui/Feedback';
import { assistantsApi } from '~/features/settings/api';
import { tasksApi, taskListKey, type TaskListParams } from '~/features/tasks/api';
import { TaskComposer } from '~/features/tasks/TaskComposer';
import { TaskEditor } from '~/features/tasks/TaskEditor';
import { TaskList } from '~/features/tasks/TaskList';
import { createQuery } from '~/hooks/createQuery';
import { t } from '~/i18n';
import type { Task, TaskKind } from '~/types';
import { cx } from '~/utils/cx';
import styles from './tasks/Clients.module.css';

type Filter = 'open' | 'done';

export default function For(): JSX.Element {
  const params = useParams<{ principalId: string }>();
  const principalId = () => Number(params.principalId);
  const [filter, setFilter] = createSignal<Filter>('open');
  const [kind, setKind] = createSignal<TaskKind>('business');
  const [activeTask, setActiveTask] = createSignal<Task | null>(null);

  const helping = createQuery(() => 'assistants:helping', () => assistantsApi.helping(), { staleMs: 10_000 });
  const principal = createMemo(() => helping.data()?.find((row) => row.user.id === principalId()) ?? null);
  const name = () => principal()?.user.display_name ?? '…';

  const listParams = (): TaskListParams => ({
    added_for: principalId(),
    top_level: true,
    completed: filter() === 'done',
    ordering: filter() === 'done' ? '-completed' : '-created',
    include_subtasks: '1',
    page_size: 200,
  });
  const query = createQuery(
    () => taskListKey(`for-${principalId()}`, listParams()),
    () => tasksApi.list(listParams()),
  );
  const refresh = () => {
    query.refetch();
    helping.refetch();
  };

  return (
    <Show when={!helping.data() || principal()} fallback={<Navigate href="/dashboard" />}>
      <Page
        title={t('For {name}', { name: name() })}
        subtitle={t('Tasks you write here go straight into {name}’s lists, marked as added by you. You see only these.', {
          name: name(),
        })}
        actions={
          <div class={styles.filters} role="tablist" aria-label={t('Show')}>
            <Each each={['open', 'done'] as const}>
              {(value) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={filter() === value}
                  class={cx(styles.chip, filter() === value && styles.chipActive)}
                  onClick={() => setFilter(value)}
                >
                  {value === 'open'
                    ? `${t('Open')} · ${principal()?.open_count ?? 0}`
                    : `${t('Completed')} · ${principal()?.done_count ?? 0}`}
                </button>
              )}
            </Each>
          </div>
        }
      >
        <div class={styles.wrap}>
          <div class={styles.filters} role="radiogroup" aria-label={t('Which list')}>
            <Each each={['business', 'personal'] as const}>
              {(value) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={kind() === value}
                  class={cx(styles.chip, kind() === value && styles.chipActive)}
                  onClick={() => setKind(value)}
                >
                  {value === 'business' ? t('Business') : t('Personal')}
                </button>
              )}
            </Each>
          </div>
          <TaskComposer
            defaults={{ kind: kind(), for_user: principalId() }}
            placeholder={t('Write a task for {name}…', { name: name() })}
            onCreated={refresh}
            autofocus
          />

          <Show when={query.data() || query.error()} fallback={<Skeleton rows={5} height={44} />}>
            <TaskList
              tasks={query.data()?.results}
              loading={query.loading()}
              error={query.error()}
              onRetry={refresh}
              onOpen={setActiveTask}
              onChanged={refresh}
              showKind
              showCreated
              emptyTitle={filter() === 'done' ? t('Nothing completed yet.') : t('Nothing written yet.')}
              emptyHint={
                filter() === 'done' ? undefined : t('Type a task above. {name} sees it right away.', { name: name() })
              }
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
          onOpenTask={(task) => void tasksApi.get(task.id).then(setActiveTask).catch(() => setActiveTask(task))}
        />
      </Page>
    </Show>
  );
}
