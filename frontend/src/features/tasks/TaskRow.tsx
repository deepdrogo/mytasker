// MyTasker — a single task row.
// Built by drogoz · https://github.com/deepdrogo/mytasker

import { A } from '@solidjs/router';
import {
  Briefcase,
  Check,
  ChevronRight,
  Clock,
  Copy,
  MessageSquare,
  MoreHorizontal,
  Play,
  Repeat,
  Share2,
  Sparkles,
  Square,
  Trash2,
} from 'lucide-solid';
import type { JSX } from 'solid-js';
import { createSignal, Show } from 'solid-js';
import { Dropdown, type MenuItem } from '~/components/ui/Dropdown';
import { Dot, Meta, OverdueMark, PriorityMark, VisibilityMark } from '~/components/shared/Indicators';
import { polishTasks } from '~/features/ai/polish';
import { tasksApi } from '~/features/tasks/api';
import { t } from '~/i18n';
import { authStore } from '~/stores/auth';
import { tx } from '~/stores/translations';
import { startTimer, stopTimer, timerStore } from '~/stores/timer';
import { toast } from '~/stores/ui';
import type { Task } from '~/types';
import { formatDueDate, formatDuration } from '~/utils/format';
import styles from './TaskRow.module.css';

interface TaskRowProps {
  task: Task;
  onOpen?: (task: Task) => void;
  onShare?: (task: Task) => void;
  onChanged?: () => void;
  showProject?: boolean;
  compact?: boolean;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: (task: Task) => void;
}

export function TaskRow(props: TaskRowProps): JSX.Element {
  const [busy, setBusy] = createSignal(false);
  const [polishing, setPolishing] = createSignal(false);
  const use12h = () => authStore.user()?.preferences.time_format === '12h';
  const isRunning = () => timerStore.running()?.task?.id === props.task.id;
  const title = () => tx('task', props.task.id, 'title', props.task.title);
  const canPolish = () => authStore.aiEnabled() && props.task.can_edit && props.task.status !== 'done';

  const polish = async (event?: MouseEvent) => {
    event?.stopPropagation();
    if (polishing() || !canPolish()) return;
    setPolishing(true);
    try {
      await polishTasks([props.task.id], props.onChanged);
    } finally {
      setPolishing(false);
    }
  };

  const toggleComplete = async (event: MouseEvent) => {
    event.stopPropagation();
    if (busy() || !props.task.can_edit) return;
    setBusy(true);
    const wasDone = props.task.status === 'done';
    try {
      if (wasDone) {
        await tasksApi.reopen(props.task.id);
      } else {
        await tasksApi.complete(props.task.id);
        toast(t('Completed “{title}”', { title: title() }), {
          action: {
            label: t('Undo'),
            run: () => {
              void tasksApi.reopen(props.task.id).then(() => props.onChanged?.());
            },
          },
        });
      }
      props.onChanged?.();
    } catch {
      toast(t('Could not update the task.'));
    } finally {
      setBusy(false);
    }
  };

  const toggleTimer = async (event: MouseEvent) => {
    event.stopPropagation();
    try {
      if (isRunning()) {
        await stopTimer();
      } else {
        await startTimer({
          task_id: props.task.id,
          category: props.task.kind === 'business' ? 'business' : 'personal',
        });
      }
    } catch {
      toast(t('Could not change the timer.'));
    }
  };

  const menuItems = (): MenuItem[] => [
    { label: t('Open'), icon: <ChevronRight size={14} />, onSelect: () => props.onOpen?.(props.task) },
    {
      label: isRunning() ? t('Stop timer') : t('Start timer'),
      icon: <Play size={14} />,
      onSelect: () => void toggleTimer(new MouseEvent('click')),
    },
    { label: t('Share'), icon: <Share2 size={14} />, onSelect: () => props.onShare?.(props.task) },
    {
      label: t('Polish with AI'),
      icon: <Sparkles size={14} />,
      disabled: !canPolish(),
      onSelect: () => void polish(),
    },
    {
      label: t('Duplicate'),
      icon: <Copy size={14} />,
      onSelect: async () => {
        await tasksApi.duplicate(props.task.id);
        props.onChanged?.();
        toast(t('Task duplicated'));
      },
    },
    {
      label: t('Tomorrow'),
      icon: <Clock size={14} />,
      separatorBefore: true,
      onSelect: async () => {
        const target = new Date();
        target.setDate(target.getDate() + 1);
        target.setHours(9, 0, 0, 0);
        await tasksApi.update(props.task.id, { due_at: target.toISOString(), due_has_time: true });
        props.onChanged?.();
      },
    },
    {
      label: t('Delete'),
      icon: <Trash2 size={14} />,
      danger: true,
      separatorBefore: true,
      disabled: !props.task.can_delete,
      onSelect: async () => {
        await tasksApi.remove(props.task.id);
        props.onChanged?.();
        toast(t('Task deleted'));
      },
    },
  ];

  const done = () => props.task.status === 'done';

  return (
    <div
      class={[
        styles.row,
        done() ? styles.done : '',
        props.compact ? styles.compact : '',
        props.selected ? styles.selected : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={() => props.onOpen?.(props.task)}
      role="listitem"
    >
      <Show when={props.selectable}>
        <button
          class={styles.selectBox}
          onClick={(e) => {
            e.stopPropagation();
            props.onToggleSelect?.(props.task);
          }}
          aria-label={props.selected ? t('Deselect task') : t('Select task')}
          aria-pressed={props.selected}
        >
          <Show when={props.selected} fallback={<Square size={13} />}>
            <Check size={13} />
          </Show>
        </button>
      </Show>

      <button
        class={styles.checkbox}
        onClick={toggleComplete}
        disabled={busy() || !props.task.can_edit}
        aria-label={done() ? t('Reopen {title}', { title: title() }) : t('Complete {title}', { title: title() })}
        aria-pressed={done()}
      >
        <Show when={done()}>
          <Check size={12} />
        </Show>
      </button>

      <div class={styles.main}>
        <div class={styles.titleLine}>
          <PriorityMark priority={props.task.priority} />
          <span class={styles.title}>{title()}</span>
          <Show when={props.task.recurrence}>
            <Repeat size={11} class={styles.inlineIcon} aria-label={t('Recurring')} />
          </Show>
          <VisibilityMark visibility={props.task.visibility} />
        </div>

        <Show when={hasMeta(props.task, props.showProject)}>
          <Meta>
            <Show when={props.task.due_at}>
              <span class={props.task.is_overdue ? styles.overdueText : undefined}>
                <Show when={props.task.is_overdue} fallback={formatDueDate(props.task.due_at, props.task.due_has_time, use12h())}>
                  <OverdueMark />
                  <span class={styles.overdueLabel}>
                    {formatDueDate(props.task.due_at, props.task.due_has_time, use12h())}
                  </span>
                </Show>
              </span>
            </Show>

            <Show when={props.showProject !== false && props.task.project}>
              {(project) => (
                <>
                  <Show when={props.task.due_at}>
                    <Dot />
                  </Show>
                  <A href={`/projects/${project().id}/tasks`} class={styles.projectLink} onClick={(e) => e.stopPropagation()}>
                    <Briefcase size={11} />
                    {tx('project', project().id, 'name', project().name)}
                  </A>
                </>
              )}
            </Show>

            <Show when={props.task.subtask_total > 0}>
              <Dot />
              <span class="mt-mono">
                {props.task.subtask_done}/{props.task.subtask_total}
              </span>
            </Show>

            <Show when={props.task.tracked_seconds > 0}>
              <Dot />
              <span class="mt-mono">{formatDuration(props.task.tracked_seconds)}</span>
            </Show>

            <Show when={props.task.estimated_minutes && props.task.tracked_seconds === 0}>
              <Dot />
              <span class="mt-mono">~{formatDuration((props.task.estimated_minutes ?? 0) * 60)}</span>
            </Show>

            <Show when={props.task.comment_count > 0}>
              <Dot />
              <span class={styles.commentCount}>
                <MessageSquare size={11} /> {props.task.comment_count}
              </span>
            </Show>

            <Show when={props.task.assignee}>
              {(assignee) => (
                <>
                  <Dot />
                  <span>{assignee().display_name}</span>
                </>
              )}
            </Show>
          </Meta>
        </Show>
      </div>

      <div class={styles.actions}>
        <Show when={isRunning()}>
          <span class={[styles.runningPill, 'mt-mono'].join(' ')} aria-label={t('Timer running')}>
            ● rec
          </span>
        </Show>
        <Show when={canPolish()}>
          <button
            class={[styles.iconAction, polishing() ? styles.iconActionBusy : ''].filter(Boolean).join(' ')}
            onClick={(e) => void polish(e)}
            disabled={polishing()}
            aria-label={t('Polish {title} with AI', { title: title() })}
            title={t('Polish with AI')}
          >
            <Sparkles size={13} />
          </button>
        </Show>
        <button
          class={styles.iconAction}
          onClick={toggleTimer}
          aria-label={isRunning() ? t('Stop timer') : t('Start timer for this task')}
          title={isRunning() ? t('Stop timer') : t('Start timer')}
        >
          <Play size={13} />
        </button>
        <Dropdown
          items={menuItems()}
          label={t('Actions for {title}', { title: title() })}
          trigger={({ toggle }) => (
            <button class={styles.iconAction} onClick={toggle} aria-label={t('Task actions')}>
              <MoreHorizontal size={14} />
            </button>
          )}
        />
      </div>
    </div>
  );
}

function hasMeta(task: Task, showProject?: boolean): boolean {
  return Boolean(
    task.due_at ||
      (showProject !== false && task.project) ||
      task.subtask_total > 0 ||
      task.tracked_seconds > 0 ||
      task.estimated_minutes ||
      task.comment_count > 0 ||
      task.assignee,
  );
}
