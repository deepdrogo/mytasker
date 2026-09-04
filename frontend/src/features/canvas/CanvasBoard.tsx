// MyTasker — Canvas: every column expanded on one page (projects, or personal/business/projects).
// Built by drogoz · https://github.com/deepdrogo/mytasker

import { A } from '@solidjs/router';
import { Check, ChevronDown, ChevronRight, Circle, Trash2 } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { For, Show, createMemo, createSignal } from 'solid-js';
import { ErrorNote, Skeleton } from '~/components/ui/Feedback';
import { PolishButton } from '~/features/ai/PolishButton';
import { ShareDialog } from '~/features/sharing/ShareDialog';
import { tasksApi, type TaskInput } from '~/features/tasks/api';
import { TaskComposer } from '~/features/tasks/TaskComposer';
import { TaskEditor } from '~/features/tasks/TaskEditor';
import { TaskRow } from '~/features/tasks/TaskRow';
import { TaskSelectionBar } from '~/features/tasks/TaskSelectionBar';
import { t } from '~/i18n';
import { tx } from '~/stores/translations';
import { toast } from '~/stores/ui';
import type { Task } from '~/types';
import { cx } from '~/utils/cx';
import { percent } from '~/utils/format';
import styles from './CanvasBoard.module.css';

export interface CanvasColumn {
  key: string;
  title: string;
  /** Small mono text next to the title (e.g. "3 open · 1h 20m"). */
  meta?: string;
  href?: string;
  icon?: JSX.Element;
  tasks: Task[];
  /** Progress 0..100 shown as a thin bar under the header; omit to hide. */
  progress?: number;
  composerDefaults?: TaskInput;
  composerPlaceholder?: string;
  /** Show the task's project chip inside this column (for mixed columns). */
  showProject?: boolean;
}

interface CanvasBoardProps {
  columns: () => CanvasColumn[];
  loading: () => boolean;
  error: () => unknown;
  onRefresh: () => void;
  emptyTitle: string;
  emptyHint?: string;
}

/**
 * Column board where every task and its subtasks are visible at once.
 * Selection spans columns so bulk complete/delete/polish work across the whole board.
 */
export function CanvasBoard(props: CanvasBoardProps): JSX.Element {
  const [selected, setSelected] = createSignal<Set<number>>(new Set());
  const [activeTask, setActiveTask] = createSignal<Task | null>(null);
  const [shareTasks, setShareTasks] = createSignal<Task[] | null>(null);
  const [collapsed, setCollapsed] = createSignal<Set<number>>(new Set());

  const allTasks = createMemo(() => props.columns().flatMap((c) => c.tasks));
  const selectedTasks = () => allTasks().filter((task) => selected().has(task.id));
  const polishIds = () => allTasks().filter((task) => task.can_edit && task.status !== 'done').map((task) => task.id);

  const toggleSelect = (task: Task) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(task.id)) next.delete(task.id);
      else next.add(task.id);
      return next;
    });
  };

  const toggleCollapsed = (id: number) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openTask = (task: Task) => {
    void tasksApi.get(task.id).then(setActiveTask).catch(() => setActiveTask(task));
  };

  return (
    <>
      <div class={styles.toolbar}>
        <TaskSelectionBar
          tasks={selectedTasks}
          total={() => allTasks().length}
          onSelectAll={() => setSelected(new Set(allTasks().map((task) => task.id)))}
          onChanged={props.onRefresh}
          onClear={() => setSelected(new Set<number>())}
          onShare={setShareTasks}
        />
        <div class={styles.toolbarRight}>
          <PolishButton taskIds={polishIds} label={t('Polish all with AI')} onChanged={props.onRefresh} />
        </div>
      </div>

      <Show when={!props.error()} fallback={<ErrorNote message={t('Could not load tasks.')} onRetry={props.onRefresh} />}>
        <Show when={!props.loading() || props.columns().length > 0} fallback={<Skeleton rows={6} height={48} />}>
          <Show
            when={props.columns().length > 0}
            fallback={
              <div class={styles.empty}>
                <p class={styles.emptyTitle}>{props.emptyTitle}</p>
                <Show when={props.emptyHint}>
                  <p class={styles.emptyHint}>{props.emptyHint}</p>
                </Show>
              </div>
            }
          >
            <div class={styles.board}>
              <For each={props.columns()}>
                {(col) => (
                  <section class={styles.column} aria-label={col.title}>
                    <header class={styles.colHead}>
                      <Show when={col.href} fallback={<span class={styles.colTitle}>{col.icon}{col.title}</span>}>
                        <A href={col.href!} class={styles.colTitle}>
                          {col.icon}
                          {col.title}
                        </A>
                      </Show>
                      <span class={styles.colMeta}>{col.meta ?? t('{count} open', { count: col.tasks.length })}</span>
                    </header>
                    <Show when={col.progress !== undefined}>
                      <div class={styles.progress}>
                        <div class={styles.progressFill} style={{ width: `${Math.min(100, col.progress ?? 0)}%` }} />
                      </div>
                    </Show>

                    <Show when={col.composerDefaults}>
                      <div class={styles.composer}>
                        <TaskComposer defaults={col.composerDefaults} placeholder={col.composerPlaceholder ?? t('Add a task…')} onCreated={props.onRefresh} />
                      </div>
                    </Show>

                    <Show when={col.tasks.length > 0} fallback={<p class={styles.colEmpty}>{t('No open tasks.')}</p>}>
                      <div class={styles.tasks} role="list">
                        <For each={col.tasks}>
                          {(task) => (
                            <div class={styles.taskGroup}>
                              <TaskRow
                                task={task}
                                compact
                                dense
                                showProject={col.showProject ?? false}
                                selectable
                                selected={selected().has(task.id)}
                                onToggleSelect={toggleSelect}
                                onOpen={openTask}
                                onShare={(item) => setShareTasks([item])}
                                onChanged={props.onRefresh}
                              />
                              <Show when={(task.subtasks?.length ?? 0) > 0}>
                                <div class={styles.subtasks}>
                                  <button
                                    type="button"
                                    class={styles.subtaskToggle}
                                    onClick={() => toggleCollapsed(task.id)}
                                    aria-expanded={!collapsed().has(task.id)}
                                  >
                                    <Show when={collapsed().has(task.id)} fallback={<ChevronDown size={12} />}>
                                      <ChevronRight size={12} />
                                    </Show>
                                    {t('{done}/{total} subtasks', { done: task.subtask_done, total: task.subtask_total })}
                                  </button>
                                  <Show when={!collapsed().has(task.id)}>
                                    <ul class={styles.subtaskList}>
                                      <For each={task.subtasks}>
                                        {(sub) => <SubtaskRow task={sub} selected={selected().has(sub.id)} onToggleSelect={toggleSelect} onOpen={openTask} onChanged={props.onRefresh} />}
                                      </For>
                                    </ul>
                                  </Show>
                                </div>
                              </Show>
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>
                  </section>
                )}
              </For>
            </div>
          </Show>
        </Show>
      </Show>

      <TaskEditor
        task={activeTask()}
        open={activeTask() !== null}
        onClose={() => setActiveTask(null)}
        onChanged={() => {
          props.onRefresh();
          const current = activeTask();
          if (current) void tasksApi.get(current.id).then(setActiveTask).catch(() => setActiveTask(null));
        }}
        onShare={(task) => setShareTasks([task])}
      />
      <ShareDialog
        tasks={shareTasks()}
        open={shareTasks() !== null}
        onClose={() => {
          setShareTasks(null);
          setSelected(new Set<number>());
        }}
      />
    </>
  );
}

function SubtaskRow(props: {
  task: Task;
  selected: boolean;
  onToggleSelect: (task: Task) => void;
  onOpen: (task: Task) => void;
  onChanged: () => void;
}): JSX.Element {
  const [busy, setBusy] = createSignal(false);
  const done = () => props.task.status === 'done';

  const toggleDone = async () => {
    if (busy() || !props.task.can_edit) return;
    setBusy(true);
    try {
      if (done()) await tasksApi.reopen(props.task.id);
      else await tasksApi.complete(props.task.id);
      props.onChanged();
    } catch {
      toast(t('Could not update task.'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy()) return;
    setBusy(true);
    try {
      await tasksApi.remove(props.task.id);
      props.onChanged();
      toast(t('Subtask deleted'));
    } catch {
      toast(t('Could not delete.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li class={cx(styles.subtask, done() && styles.subtaskDone, props.selected && styles.subtaskSelected)}>
      <input
        type="checkbox"
        class={styles.subtaskSelect}
        checked={props.selected}
        onChange={() => props.onToggleSelect(props.task)}
        aria-label={t('Select task')}
      />
      <button type="button" class={styles.subtaskCheck} disabled={busy() || !props.task.can_edit} onClick={() => void toggleDone()} aria-label={done() ? t('Reopen') : t('Complete')}>
        <Show when={done()} fallback={<Circle size={13} />}>
          <Check size={13} />
        </Show>
      </button>
      <button type="button" class={styles.subtaskTitle} onClick={() => props.onOpen(props.task)}>
        {tx('task', props.task.id, 'title', props.task.title)}
      </button>
      <Show when={props.task.can_delete}>
        <button type="button" class={styles.subtaskDelete} disabled={busy()} onClick={() => void remove()} aria-label={t('Delete subtask')} title={t('Delete subtask')}>
          <Trash2 size={12} />
        </button>
      </Show>
    </li>
  );
}

/** Helper for pages: progress from done/total counts, guarded against zero. */
export function progressOf(done: number | null | undefined, total: number | null | undefined): number | undefined {
  if (!total) return undefined;
  return percent(done ?? 0, total);
}
