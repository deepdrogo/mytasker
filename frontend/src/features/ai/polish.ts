import { ApiError } from '~/api/client';
import { aiApi, type PolishTasksResult } from '~/features/ai/api';
import { tasksApi } from '~/features/tasks/api';
import { t, tn } from '~/i18n';
import { toast } from '~/stores/ui';
import type { ID } from '~/types';

/**
 * Rewrite task titles with AI and apply them immediately. One toast summarises the result and offers
 * a single Undo that restores every changed title/description, so the fast path stays reversible.
 */
export async function polishTasks(taskIds: ID[], onChanged?: () => void): Promise<PolishTasksResult | null> {
  if (!taskIds.length) return null;
  try {
    const result = await aiApi.polishTasks(taskIds);
    onChanged?.();
    announce(result, onChanged);
    return result;
  } catch (err) {
    toast(err instanceof ApiError ? err.message : t('AI request failed.'));
    return null;
  }
}

function announce(result: PolishTasksResult, onChanged?: () => void): void {
  const changed = result.updated.length;
  if (changed === 0) {
    toast(
      result.skipped.length && !result.unchanged.length
        ? t('These tasks cannot be edited.')
        : t('Already clear - nothing to rewrite.'),
    );
    return;
  }
  const message =
    changed === 1 && result.updated[0]
      ? t('Rewritten: “{title}”', { title: result.updated[0].title })
      : t('{count} rewritten', { count: tn(changed, 'task') });
  toast(message, {
    action: {
      label: t('Undo'),
      run: () => {
        void Promise.all(
          result.updated.map((row) =>
            tasksApi.update(row.id, { title: row.previous_title, description: row.previous_description }),
          ),
        )
          .then(() => {
            onChanged?.();
            toast(t('Restored'));
          })
          .catch(() => toast(t('Could not restore the previous titles.')));
      },
    },
  });
}
