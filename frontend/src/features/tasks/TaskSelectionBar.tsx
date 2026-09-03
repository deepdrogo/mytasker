import { Share2, X } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import { Button } from '~/components/ui/Button';
import { PolishButton } from '~/features/ai/PolishButton';
import { BulkDueDate } from '~/features/tasks/BulkDueDate';
import { t } from '~/i18n';
import type { Task } from '~/types';
import styles from './TaskSelectionBar.module.css';

interface TaskSelectionBarProps {
  /** The currently selected tasks (already resolved against the visible list). */
  tasks: () => Task[];
  onChanged: () => void;
  onClear: () => void;
  onShare?: (tasks: Task[]) => void;
}

/** Floating actions for a checkbox selection: AI polish, one deadline for all, share, clear. */
export function TaskSelectionBar(props: TaskSelectionBarProps): JSX.Element {
  const editableIds = () =>
    props
      .tasks()
      .filter((task) => task.can_edit && task.status !== 'done')
      .map((task) => task.id);

  const changed = () => {
    props.onChanged();
    props.onClear();
  };

  return (
    <Show when={props.tasks().length > 0}>
      <div class={styles.bar} role="toolbar" aria-label={t('Selected tasks')}>
        <span class="mt-mono">{t('{count} selected', { count: props.tasks().length })}</span>
        <div class={styles.actions}>
          <PolishButton taskIds={editableIds} label={t('Polish selected')} onChanged={changed} />
          <BulkDueDate tasks={props.tasks} onChanged={changed} />
          <Show when={props.onShare}>
            <Button variant="secondary" size="sm" onClick={() => props.onShare?.(props.tasks())}>
              <Share2 size={13} />
              {t('Share')}
            </Button>
          </Show>
          <Button variant="ghost" size="sm" onClick={() => props.onClear()} aria-label={t('Clear selection')}>
            <X size={13} />
          </Button>
        </div>
      </div>
    </Show>
  );
}
