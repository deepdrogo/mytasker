// MyTasker — a single task row.
// Built by drogoz · https://github.com/deepdrogo/mytasker

import { A } from '@solidjs/router';
import {
  Briefcase,
  Check,
  ChevronRight,
  Clock,
  Copy,
  Flame,
  Infinity as InfinityIcon,
  MessageSquare,
  MoreHorizontal,
  Play,
  Repeat,
  Share2,
  Sparkles,
  Square,
  Trash2,
  UserPlus,
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
import { cx } from '~/utils/cx';
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
  /** Narrow columns (canvas): full title on up to two lines, no badges, only the menu button. */
  dense?: boolean;
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

  const ongoing = () => props.task.is_ongoing && props.task.status !== 'done';

  /** Long-term tasks: the round box is today's check-in, not completion. */
  const toggleCheckin = async (event: MouseEvent) => {
    event.stopPropagation();
    if (busy() || !props.task.can_edit) return;
    setBusy(true);
    try {
      await tasksApi.checkin(props.task.id, !props.task.today_checked);
      if (!props.task.today_checked) toast(t('Checked in for today'));
      props.onChanged?.();
    } catch {
      toast(t('Could not update the task.'));
    } finally {
      setBusy(false);
    }
  };

  const finishForGood = async () => {
    if (busy() || !props.task.can_edit) return;
    setBusy(true);
    try {
      await tasksApi.complete(props.task.id);
      toast(t('Completed “{title}”', { title: title() }), {
        action: { label: t('Undo'), run: () => void tasksApi.reopen(props.task.id).then(() => props.onChanged?.()) },
      });
      props.onChanged?.();
    } catch {
      toast(t('Could not update the task.'));
    } finally {
      setBusy(false);
    }
  };

  const toggleComplete = async (event: MouseEvent) => {
    if (ongoing()) return toggleCheckin(event);
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
        // Any project task is business work; the server applies the same rule when category is omitted.
        await startTimer({
          task_id: props.task.id,
          category: props.task.kind === 'business' || props.task.project ? 'business' : 'personal',
        });
      }
    } catch {
      toast(t('Could not change the timer.'));
    }
  };

  const menuItems = (): MenuItem[] => [
    { label: t('Open'), icon: <ChevronRight size={14} />, onSelect: () => props.onOpen?.(props.task) },
    ...(ongoing()
      ? [
          {
            label: t('Finish for good'),
            icon: <Check size={14} />,
            disabled: !props.task.can_edit,
            onSelect: () => void finishForGood(),
          } satisfies MenuItem,
        ]
      : []),
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
      label: t('Today'),
      icon: <Clock size={14} />,
      separatorBefore: true,
      onSelect: async () => {
        // Due by the end of today, no specific hour - shows up in "Due today" without a clock.
        const target = new Date();
        target.setHours(23, 59, 0, 0);
        await tasksApi.update(props.task.id, { due_at: target.toISOString(), due_has_time: false });
        props.onChanged?.();
        toast(t('Due today'));
      },
    },
    {
      label: t('Tomorrow'),
      icon: <Clock size={14} />,
      onSelect: async () => {
        const target = new Date();
        target.setDate(target.getDate() + 1);
        target.setHours(9, 0, 0, 0);
        await tasksApi.update(props.task.id, { due_at: target.toISOString(), due_has_time: true });
        props.onChanged?.();
        toast(t('Due tomorrow'));
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
        props.dense ? styles.dense : '',
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
        class={cx(styles.checkbox, ongoing() && styles.checkinBox, ongoing() && props.task.today_checked && styles.checkedToday)}
        onClick={toggleComplete}
        disabled={busy() || !props.task.can_edit}
        aria-label={
          ongoing()
            ? props.task.today_checked
              ? t('Undo today’s check-in')
              : t('Check in for today')
            : done()
              ? t('Reopen {title}', { title: title() })
              : t('Complete {title}', { title: title() })
        }
        aria-pressed={ongoing() ? props.task.today_checked : done()}
        title={ongoing() ? (props.task.today_checked ? t('Checked in today') : t('Check in for today')) : undefined}
      >
        <Show when={done() || (ongoing() && props.task.today_checked)}>
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
          <Show when={props.task.is_ongoing}>
            <span class={styles.ongoingMark} title={t('Long-term work - ticked daily')}>
              <InfinityIcon size={12} />
              <Show when={props.task.checkin_streak > 1}>
                <Flame size={10} /> {props.task.checkin_streak}
              </Show>
            </span>
          </Show>
          <Show when={!props.dense}>
            <VisibilityMark visibility={props.task.visibility} />
          </Show>
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

            <Show when={addedBy(props.task)}>
              {(who) => (
                <>
                  <Dot />
                  <span class={styles.addedBy} title={t('Added by {name}', { name: who().display_name })}>
                    <UserPlus size={11} /> {who().display_name}
                  </span>
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
        <Show when={canPolish() && !props.dense}>
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
        <Show when={!props.dense}>
          <button
            class={styles.iconAction}
            onClick={toggleTimer}
            aria-label={isRunning() ? t('Stop timer') : t('Start timer for this task')}
            title={isRunning() ? t('Stop timer') : t('Start timer')}
          >
            <Play size={13} />
          </button>
        </Show>
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

/** Show who added the task when it was not the owner (assistant or team member), never for the viewer's own additions. */
function addedBy(task: Task): Task['created_by'] {
  const me = authStore.user()?.id;
  if (!task.created_by || task.created_by.id === task.owner.id || task.created_by.id === me) return null;
  return task.created_by;
}

function hasMeta(task: Task, showProject?: boolean): boolean {
  return Boolean(
    task.due_at ||
      (showProject !== false && task.project) ||
      task.subtask_total > 0 ||
      task.tracked_seconds > 0 ||
      task.estimated_minutes ||
      task.comment_count > 0 ||
      task.assignee ||
      addedBy(task),
  );
}
