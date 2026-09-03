import { AlertTriangle, Check, ChevronDown, ChevronRight, X } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { For, Show, createSignal } from 'solid-js';
import { Button } from '~/components/ui/Button';
import { t, tn } from '~/i18n';
import type { AIPending, AIToolCall } from '~/types';
import styles from './AIActionPreview.module.css';
import { cx } from '~/utils/cx';

const TOOL_LABEL: Record<string, string> = {
  list_tasks: 'Looked up tasks',
  today_overview: 'Checked today',
  search: 'Searched',
  list_projects: 'Listed projects',
  create_task: 'Created task',
  create_subtasks: 'Added subtasks',
  update_task: 'Updated task',
  complete_task: 'Completed task',
  complete_tasks: 'Completed tasks',
  reopen_task: 'Reopened task',
  delete_task: 'Deleted task',
  start_timer: 'Started timer',
  stop_timer: 'Stopped timer',
  create_project: 'Created project',
  create_idea: 'Saved idea',
  add_comment: 'Added comment',
};

/** Human label for a tool call; falls back to the raw tool name for tools we do not know. */
function toolLabel(call: AIToolCall): string {
  const label = TOOL_LABEL[call.name];
  return label ? t(label) : call.name;
}

function summarise(call: AIToolCall): string {
  const input = call.input ?? {};
  const title = typeof input.title === 'string' ? input.title : '';
  const when = typeof input.when === 'string' ? ` · ${input.when}` : '';
  if (title) return `“${title}”${when}`;
  if (typeof input.task_id === 'number') return `#${input.task_id}${when}`;
  if (Array.isArray(input.task_ids)) return tn(input.task_ids.length, 'task');
  if (typeof input.query === 'string') return `“${input.query}”`;
  if (typeof input.name === 'string') return `“${input.name}”`;
  return '';
}

/** Compact, honest trace of what the model actually did. */
export function ToolTrace(props: { calls: AIToolCall[] }): JSX.Element {
  const [open, setOpen] = createSignal(false);
  return (
    <Show when={props.calls.length > 0}>
      <div class={styles.trace}>
        <button type="button" class={styles.traceToggle} onClick={() => setOpen((v) => !v)} aria-expanded={open()}>
          <Show when={open()} fallback={<ChevronRight size={12} />}>
            <ChevronDown size={12} />
          </Show>
          {tn(props.calls.length, 'action')}
        </button>
        <Show when={open()}>
          <ul class={styles.traceList}>
            <For each={props.calls}>
              {(call) => (
                <li class={cx(styles.traceItem, call.status === 'error' && styles.traceError)}>
                  <span class={styles.traceName}>{toolLabel(call)}</span>
                  <span class={styles.traceArgs}>{summarise(call)}</span>
                  <Show when={call.status === 'error'}>
                    <span class={styles.traceErrorText}>{call.error}</span>
                  </Show>
                  <Show when={call.status === 'proposed'}>
                    <span class={styles.traceProposed}>{t('needs confirmation')}</span>
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>
    </Show>
  );
}

export function AIActionPreview(props: {
  pending: AIPending;
  busy?: boolean;
  onConfirm: () => void;
  onReject: () => void;
}): JSX.Element {
  return (
    <div class={styles.preview} role="group" aria-label={t('Confirm AI action')}>
      <div class={styles.previewHead}>
        <AlertTriangle size={14} />
        <span>{props.pending.preview.summary}</span>
      </div>
      <Show when={props.pending.preview.items.length > 0}>
        <ul class={styles.previewItems}>
          <For each={props.pending.preview.items.slice(0, 8)}>{(item) => <li>{item}</li>}</For>
          <Show when={props.pending.preview.items.length > 8}>
            <li class={styles.previewMore}>{t('+{count} more', { count: props.pending.preview.items.length - 8 })}</li>
          </Show>
        </ul>
      </Show>
      <div class={styles.previewActions}>
        <Button variant="primary" size="sm" loading={props.busy} onClick={props.onConfirm}>
          <Check size={14} /> {t('Confirm')}
        </Button>
        <Button variant="ghost" size="sm" disabled={props.busy} onClick={props.onReject}>
          <X size={14} /> {t('Cancel')}
        </Button>
      </div>
    </div>
  );
}
