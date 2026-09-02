import { useNavigate } from '@solidjs/router';
import { Moon, Square } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import { stopSleep, stopTimer, timerStore } from '~/stores/timer';
import { toast } from '~/stores/ui';
import { formatClock } from '~/utils/format';
import styles from './TimerIndicator.module.css';

/**
 * Always-visible running timer in the top bar. Click the label to jump to the task;
 * the square stops it. Sleep tracking shows a moon instead.
 */
export function TimerIndicator(): JSX.Element {
  const navigate = useNavigate();

  const stop = async (event: MouseEvent) => {
    event.stopPropagation();
    try {
      await stopTimer();
      toast('Timer stopped');
    } catch {
      toast('Could not stop the timer.');
    }
  };

  const endSleep = async () => {
    try {
      await stopSleep();
      toast('Good morning');
    } catch {
      toast('Could not stop sleep tracking.');
    }
  };

  const label = () => {
    const entry = timerStore.running();
    if (!entry) return '';
    return entry.task?.title ?? entry.routine_item?.name ?? entry.project?.name ?? (entry.category === 'business' ? 'Business' : 'Personal');
  };

  return (
    <>
      <Show when={timerStore.sleep()}>
        <button type="button" class={[styles.indicator, styles.sleep].join(' ')} onClick={() => void endSleep()} title="Stop sleep tracking">
          <Moon size={13} />
          <span class={[styles.clock, 'mt-mono'].join(' ')}>{formatClock(timerStore.sleepElapsedSeconds())}</span>
        </button>
      </Show>
      <Show when={timerStore.running()}>
        {(entry) => (
          <div class={styles.indicator} role="status" aria-live="off">
            <span class={styles.pulse} aria-hidden="true" />
            <button
              type="button"
              class={styles.label}
              onClick={() => navigate(entry().project ? `/projects/${entry().project?.id}/tasks` : '/insights/time')}
              title={label()}
            >
              <span class={styles.name}>{label()}</span>
              <span class={[styles.clock, 'mt-mono'].join(' ')}>{formatClock(timerStore.elapsedSeconds())}</span>
            </button>
            <button type="button" class={styles.stop} onClick={stop} aria-label="Stop timer" disabled={timerStore.busy()}>
              <Square size={11} fill="currentColor" />
            </button>
          </div>
        )}
      </Show>
    </>
  );
}
