// MyTasker — Tasks › Archive: reversible home for tasks you've put away. Restore one or all; nothing is deleted.
// Built by drogoz · https://github.com/deepdrogo/mytasker

import { Archive as ArchiveIcon, RotateCcw } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { createSignal, For, Show } from 'solid-js';
import { ApiError } from '~/api/client';
import { Page } from '~/components/shared/Page';
import { Button } from '~/components/ui/Button';
import { ConfirmDialog, EmptyState, ErrorNote, Skeleton } from '~/components/ui/Feedback';
import { tasksApi } from '~/features/tasks/api';
import { createQuery } from '~/hooks/createQuery';
import { t } from '~/i18n';
import { tx } from '~/stores/translations';
import { toast } from '~/stores/ui';
import type { Task } from '~/types';
import { formatDate } from '~/utils/format';
import styles from './Archive.module.css';

export default function Archive(): JSX.Element {
  const [confirmArchiveAll, setConfirmArchiveAll] = createSignal(false);
  const [busy, setBusy] = createSignal(false);

  const query = createQuery(
    () => 'tasks:archive',
    () => tasksApi.list({ archived: '1', top_level: true, ordering: '-updated', page_size: 300 }),
  );

  const items = () => query.data()?.results ?? [];

  const subtitleFor = (task: Task): string => {
    if (task.project) return tx('project', task.project.id, 'name', task.project.name);
    if (task.kind === 'business') return t('Business');
    if (task.kind === 'crypto') return t('Crypto world');
    return t('Personal');
  };

  const restore = async (task: Task) => {
    try {
      await tasksApi.unarchive(task.id);
      query.refetch();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('Could not restore the task.'));
    }
  };

  const restoreAll = async () => {
    if (busy()) return;
    setBusy(true);
    try {
      const { restored } = await tasksApi.unarchiveAll();
      toast(t('Restored {count} tasks', { count: restored }));
      query.refetch();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('Could not restore your tasks.'));
    } finally {
      setBusy(false);
    }
  };

  const archiveAll = async () => {
    if (busy()) return;
    setBusy(true);
    try {
      const { archived } = await tasksApi.archiveAll(true);
      toast(t('Archived {count} tasks', { count: archived }));
      query.refetch();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('Could not archive your tasks.'));
    } finally {
      setBusy(false);
      setConfirmArchiveAll(false);
    }
  };

  return (
    <Page
      title={t('Archive')}
      subtitle={t('Tasks you have put away. Nothing is deleted — restore anything, anytime.')}
      actions={
        <div class={styles.headerActions}>
          <Button size="sm" variant="secondary" onClick={() => setConfirmArchiveAll(true)} loading={busy()}>
            <ArchiveIcon size={14} />
            {t('Archive all tasks')}
          </Button>
          <Show when={items().length > 0}>
            <Button size="sm" variant="ghost" onClick={() => void restoreAll()} loading={busy()}>
              <RotateCcw size={14} />
              {t('Restore all')}
            </Button>
          </Show>
        </div>
      }
    >
      <Show when={!query.error()} fallback={<ErrorNote message={t('Could not load the archive.')} onRetry={query.refetch} />}>
        <Show when={query.data()} fallback={<Skeleton rows={5} height={52} />}>
          <Show
            when={items().length > 0}
            fallback={
              <EmptyState
                icon={<ArchiveIcon size={22} />}
                title={t('Archive is empty')}
                hint={t('Archived tasks will appear here, ready to restore.')}
              />
            }
          >
            <ul class={styles.list}>
              <For each={items()}>
                {(task) => (
                  <li class={styles.row}>
                    <div class={styles.main}>
                      <span class={styles.title}>{tx('task', task.id, 'title', task.title)}</span>
                      <span class={styles.meta}>
                        <span>{subtitleFor(task)}</span>
                        <Show when={task.status === 'done'}>
                          <span class={styles.done}>{t('Done')}</span>
                        </Show>
                        <Show when={task.archived_at}>
                          <span class={styles.metaDim}>{t('Archived {date}', { date: formatDate(task.archived_at) })}</span>
                        </Show>
                      </span>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => void restore(task)} aria-label={t('Restore {name}', { name: task.title })}>
                      <RotateCcw size={14} />
                      {t('Restore')}
                    </Button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </Show>
      </Show>

      <ConfirmDialog
        open={confirmArchiveAll()}
        title={t('Archive all tasks?')}
        message={t('Every task on your lists moves to the Archive. Your lists become empty, but nothing is deleted — you can restore everything from here.')}
        confirmLabel={t('Archive all')}
        onConfirm={() => void archiveAll()}
        onCancel={() => setConfirmArchiveAll(false)}
      />
    </Page>
  );
}
