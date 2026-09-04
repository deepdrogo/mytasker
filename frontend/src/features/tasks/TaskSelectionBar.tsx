import { CheckCheck, Share2, Trash2, X } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { Show, createSignal } from 'solid-js';
import { ApiError } from '~/api/client';
import { Button } from '~/components/ui/Button';
import { ConfirmDialog } from '~/components/ui/Feedback';
import { PolishButton } from '~/features/ai/PolishButton';
import { BulkDueDate } from '~/features/tasks/BulkDueDate';
import { tasksApi } from '~/features/tasks/api';
import { t, tn } from '~/i18n';
import { toast } from '~/stores/ui';
import type { Task } from '~/types';
import styles from './TaskSelectionBar.module.css';

interface TaskSelectionBarProps {
  /** The currently selected tasks (already resolved against the visible list). */
  tasks: () => Task[];
  onChanged: () => void;
  onClear: () => void;
  onShare?: (tasks: Task[]) => void;
  /** Total number of selectable tasks on screen; enables "Select all" when larger than the selection. */
  total?: () => number;
  onSelectAll?: () => void;
}

/** Floating actions for a checkbox selection: AI polish, one deadline for all, complete, delete, share, clear. */
export function TaskSelectionBar(props: TaskSelectionBarProps): JSX.Element {
  const [confirmDelete, setConfirmDelete] = createSignal(false);
  const [busy, setBusy] = createSignal<'complete' | 'delete' | null>(null);

  const editableIds = () =>
    props
      .tasks()
      .filter((task) => task.can_edit && task.status !== 'done')
      .map((task) => task.id);
  const openIds = () => props.tasks().filter((task) => task.status !== 'done' && task.status !== 'cancelled').map((task) => task.id);
  const deletableIds = () => props.tasks().filter((task) => task.can_delete).map((task) => task.id);

  const changed = () => {
    props.onChanged();
    props.onClear();
  };

  const completeAll = async () => {
    const ids = openIds();
    if (ids.length === 0) return;
    setBusy('complete');
    try {
      const result = await tasksApi.bulkComplete(ids);
      toast(
        result.skipped.length > 0
          ? t('{count} completed, {skipped} skipped', { count: result.updated.length, skipped: result.skipped.length })
          : t('{count} completed', { count: result.updated.length }),
      );
      changed();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('Action failed.'));
    } finally {
      setBusy(null);
    }
  };

  const deleteAll = async () => {
    const ids = deletableIds();
    if (ids.length === 0) return;
    setBusy('delete');
    try {
      const result = await tasksApi.bulkDelete(ids);
      toast(
        result.skipped.length > 0
          ? t('{count} deleted, {skipped} skipped', { count: result.deleted.length, skipped: result.skipped.length })
          : t('{count} deleted', { count: result.deleted.length }),
      );
      changed();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('Action failed.'));
    } finally {
      setBusy(null);
      setConfirmDelete(false);
    }
  };

  return (
    <Show when={props.tasks().length > 0}>
      <div class={styles.bar} role="toolbar" aria-label={t('Selected tasks')}>
        <span class={styles.count}>
          <span class="mt-mono">{t('{count} selected', { count: props.tasks().length })}</span>
          <Show when={props.onSelectAll && (props.total?.() ?? 0) > props.tasks().length}>
            <Button variant="link" size="sm" onClick={() => props.onSelectAll?.()}>
              {t('Select all {count}', { count: props.total?.() ?? 0 })}
            </Button>
          </Show>
        </span>
        <div class={styles.actions}>
          <PolishButton taskIds={editableIds} label={t('Polish selected')} onChanged={changed} />
          <BulkDueDate tasks={props.tasks} onChanged={changed} />
          <Show when={openIds().length > 0}>
            <Button variant="secondary" size="sm" onClick={() => void completeAll()} loading={busy() === 'complete'} title={t('Complete selected')}>
              <CheckCheck size={13} />
              <span class={styles.actionLabel}>{t('Complete')}</span>
            </Button>
          </Show>
          <Show when={props.onShare}>
            <Button variant="secondary" size="sm" onClick={() => props.onShare?.(props.tasks())}>
              <Share2 size={13} />
              <span class={styles.actionLabel}>{t('Share')}</span>
            </Button>
          </Show>
          <Show when={deletableIds().length > 0}>
            <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)} title={t('Delete selected')}>
              <Trash2 size={13} />
              <span class={styles.actionLabel}>{t('Delete')}</span>
            </Button>
          </Show>
          <Button variant="ghost" size="sm" onClick={() => props.onClear()} aria-label={t('Clear selection')}>
            <X size={13} />
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete()}
        title={t('Delete {count}?', { count: tn(deletableIds().length, 'task') })}
        message={t('Subtasks are deleted together with their parent. This cannot be undone.')}
        confirmLabel={t('Delete')}
        destructive
        busy={busy() === 'delete'}
        onConfirm={() => void deleteAll()}
        onCancel={() => setConfirmDelete(false)}
      />
    </Show>
  );
}
