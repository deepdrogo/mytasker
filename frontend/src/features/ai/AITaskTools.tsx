import { ListTree, Sparkles } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { For, Show, createSignal } from 'solid-js';
import { ApiError } from '~/api/client';
import { Button } from '~/components/ui/Button';
import { Checkbox } from '~/components/ui/Input';
import { aiApi, type BreakdownResult, type ImproveTaskResult } from '~/features/ai/api';
import { t, tn } from '~/i18n';
import { authStore } from '~/stores/auth';
import { toast } from '~/stores/ui';
import type { Task } from '~/types';
import styles from './AITaskTools.module.css';

interface AITaskToolsProps {
  task: Task;
  currentTitle: string;
  onApplyTitle: (title: string) => void;
  onApplyDescription?: (description: string) => void;
  onSubtasksAdded: () => void;
}

/**
 * Inline "Improve" / "Break down" affordances inside the task editor. Suggestions are previewed
 * and applied explicitly - the AI never mutates a task behind the user's back.
 */
export function AITaskTools(props: AITaskToolsProps): JSX.Element {
  const [busy, setBusy] = createSignal<'improve' | 'breakdown' | 'apply' | null>(null);
  const [improved, setImproved] = createSignal<ImproveTaskResult | null>(null);
  const [breakdown, setBreakdown] = createSignal<BreakdownResult | null>(null);
  const [picked, setPicked] = createSignal<Set<number>>(new Set());
  const enabled = () => authStore.aiEnabled();

  const fail = (err: unknown) => toast(err instanceof ApiError ? err.message : t('AI request failed.'));

  const improve = async () => {
    setBusy('improve');
    try {
      setImproved(await aiApi.improveTask(props.task.id));
      setBreakdown(null);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  const breakDown = async () => {
    setBusy('breakdown');
    try {
      const result = await aiApi.breakDown(props.task.id);
      setBreakdown(result);
      setPicked(new Set(result.subtasks.map((_, i) => i)));
      setImproved(null);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  const applyBreakdown = async () => {
    const result = breakdown();
    if (!result) return;
    const chosen = result.subtasks.filter((_, i) => picked().has(i));
    if (!chosen.length) return;
    setBusy('apply');
    try {
      await aiApi.applyBreakdown(props.task.id, chosen);
      toast(t('{count} added', { count: tn(chosen.length, 'subtask') }));
      setBreakdown(null);
      props.onSubtasksAdded();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  const togglePick = (i: number) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  return (
    <Show when={enabled() && props.task.can_edit && !props.task.parent}>
      <div class={styles.tools}>
        <div class={styles.buttons}>
          <Button variant="ghost" size="sm" loading={busy() === 'improve'} disabled={busy() !== null} onClick={() => void improve()}>
            <Sparkles size={13} /> {t('Improve')}
          </Button>
          <Button variant="ghost" size="sm" loading={busy() === 'breakdown'} disabled={busy() !== null} onClick={() => void breakDown()}>
            <ListTree size={13} /> {t('Break down')}
          </Button>
        </div>

        <Show when={improved()}>
          {(r) => (
            <div class={styles.card}>
              <div class={styles.cardTitle}>{t('Suggested')}</div>
              <Show when={r().title && r().title !== props.currentTitle}>
                <div class={styles.suggestion}>
                  <span class={styles.label}>{t('Title')}</span>
                  <p>{r().title}</p>
                  <Button variant="secondary" size="sm" onClick={() => props.onApplyTitle(r().title)}>
                    {t('Use')}
                  </Button>
                </div>
              </Show>
              <Show when={r().description}>
                <div class={styles.suggestion}>
                  <span class={styles.label}>{t('Description')}</span>
                  <p class={styles.pre}>{r().description}</p>
                  <Show when={props.onApplyDescription}>
                    <Button variant="secondary" size="sm" onClick={() => props.onApplyDescription?.(r().description)}>
                      {t('Use')}
                    </Button>
                  </Show>
                </div>
              </Show>
              <Show when={r().suggested_subtasks?.length}>
                <div class={styles.suggestion}>
                  <span class={styles.label}>{t('Possible subtasks')}</span>
                  <ul class={styles.plain}>
                    <For each={r().suggested_subtasks}>{(s) => <li>{s}</li>}</For>
                  </ul>
                </div>
              </Show>
              <div class={styles.cardActions}>
                <Button variant="ghost" size="sm" onClick={() => setImproved(null)}>
                  {t('Dismiss')}
                </Button>
              </div>
            </div>
          )}
        </Show>

        <Show when={breakdown()}>
          {(r) => (
            <div class={styles.card}>
              <div class={styles.cardTitle}>{t('Proposed subtasks')}</div>
              <Show when={r().note}>
                <p class={styles.note}>{r().note}</p>
              </Show>
              <ul class={styles.plain}>
                <For each={r().subtasks}>
                  {(s, i) => (
                    <li>
                      <Checkbox
                        checked={picked().has(i())}
                        onChange={() => togglePick(i())}
                        label={s.estimated_minutes ? `${s.title} · ${t('{minutes}m', { minutes: s.estimated_minutes })}` : s.title}
                      />
                    </li>
                  )}
                </For>
              </ul>
              <div class={styles.cardActions}>
                <Button variant="ghost" size="sm" onClick={() => setBreakdown(null)}>
                  {t('Dismiss')}
                </Button>
                <Button variant="primary" size="sm" loading={busy() === 'apply'} disabled={picked().size === 0} onClick={() => void applyBreakdown()}>
                  {t('Add {count}', { count: tn(picked().size, 'subtask') })}
                </Button>
              </div>
            </div>
          )}
        </Show>
      </div>
    </Show>
  );
}
