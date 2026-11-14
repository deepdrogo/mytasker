// MyTasker — two dots on every task: yellow (High) and red (Critical). One tap colours the task, a second tap on
// the same dot brings it back to Normal.

import type { JSX } from 'solid-js';
import { createSignal, For } from 'solid-js';
import { priorityAfterTap, priorityTone, type PriorityTone } from '~/features/tasks/priority';
import { tasksApi } from '~/features/tasks/api';
import { t } from '~/i18n';
import { toast } from '~/stores/ui';
import type { Priority, Task } from '~/types';
import { cx } from '~/utils/cx';
import styles from './PriorityDots.module.css';

const TONES: PriorityTone[] = ['yellow', 'red'];
const SET_LABEL: Record<PriorityTone, string> = { yellow: 'Mark yellow - high priority', red: 'Mark red - critical' };
const DONE_LABEL: Record<PriorityTone, string> = { yellow: 'Marked yellow', red: 'Marked red' };

export function PriorityDots(props: { task: Task; onChanged?: () => void; size?: 'sm' }): JSX.Element {
  /** Shown until the refetched task arrives, so the colour flips on the tap itself. */
  const [optimistic, setOptimistic] = createSignal<Priority | null>(null);
  const [busy, setBusy] = createSignal(false);
  const current = () => optimistic() ?? props.task.priority;

  const tap = async (event: MouseEvent, tone: PriorityTone) => {
    event.stopPropagation();
    if (busy() || !props.task.can_edit) return;
    const next = priorityAfterTap(current(), tone);
    setBusy(true);
    setOptimistic(next);
    try {
      await tasksApi.update(props.task.id, { priority: next });
      const now = priorityTone(next);
      toast(now ? t(DONE_LABEL[now]) : t('Back to normal priority'));
      props.onChanged?.();
    } catch {
      toast(t('Could not update the task.'));
    } finally {
      setOptimistic(null);
      setBusy(false);
    }
  };

  return (
    <span class={cx(styles.dots, props.size === 'sm' && styles.sm)} role="group" aria-label={t('Priority colour')}>
      <For each={TONES}>
        {(tone) => {
          const on = () => priorityTone(current()) === tone;
          return (
            <button
              type="button"
              class={cx(styles.dot, styles[tone], on() && styles.on)}
              onClick={(event) => void tap(event, tone)}
              disabled={busy() || !props.task.can_edit}
              aria-pressed={on()}
              aria-label={on() ? t('Back to normal priority') : t(SET_LABEL[tone])}
              title={on() ? t('Back to normal priority') : t(SET_LABEL[tone])}
            />
          );
        }}
      </For>
    </span>
  );
}
