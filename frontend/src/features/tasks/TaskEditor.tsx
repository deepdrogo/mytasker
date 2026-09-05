import {
  ChevronLeft,
  ChevronRight,
  GripVertical,
  Infinity as InfinityIcon,
  Pencil,
  Play,
  Repeat,
  Share2,
  Sparkles,
  Square,
  Trash2,
} from 'lucide-solid';
import type { JSX } from 'solid-js';
import { batch, createEffect, createSignal, For, Show } from 'solid-js';
import { ApiError } from '~/api/client';
import { Button } from '~/components/ui/Button';
import { DateTimeInput } from '~/components/ui/DateTimeInput';
import { Drawer } from '~/components/ui/Drawer';
import { ConfirmDialog, ErrorNote } from '~/components/ui/Feedback';
import { Checkbox, Field, Input, Select, Textarea } from '~/components/ui/Input';
import { AITaskTools } from '~/features/ai/AITaskTools';
import { PolishButton } from '~/features/ai/PolishButton';
import { polishTasks } from '~/features/ai/polish';
import { Comments } from '~/features/collab/Comments';
import { ProjectSelector } from '~/features/projects/ProjectSelector';
import { tasksApi, type TaskInput } from '~/features/tasks/api';
import { TaskComposer } from '~/features/tasks/TaskComposer';
import { createSortable, type Sortable } from '~/hooks/createSortable';
import { intlLocale, t } from '~/i18n';
import { isTranslated, markStale, tx } from '~/stores/translations';
import { startTimer, stopTimer, timerStore } from '~/stores/timer';
import { authStore } from '~/stores/auth';
import { toast } from '~/stores/ui';
import type { Priority, Task } from '~/types';
import { formatDuration, fromLocalInputValue, toLocalInputValue } from '~/utils/format';
import styles from './TaskEditor.module.css';

interface TaskEditorProps {
  task: Task | null;
  open: boolean;
  onClose: () => void;
  onChanged?: () => void;
  onShare?: (task: Task) => void;
  /** Open another task in this same drawer (a subtask, or the parent when backing out). */
  onOpenTask?: (task: Task) => void;
}

const PRIORITIES: Priority[] = ['critical', 'high', 'normal', 'low'];
const PRIORITY_LABEL: Record<Priority, string> = { critical: 'Critical', high: 'High', normal: 'Normal', low: 'Low' };
const RECURRENCE_OPTIONS = [
  { value: '', label: 'Does not repeat' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekdays', label: 'Weekdays' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];

export function TaskEditor(props: TaskEditorProps): JSX.Element {
  const [title, setTitle] = createSignal('');
  const [description, setDescription] = createSignal('');
  const [notes, setNotes] = createSignal('');
  const [priority, setPriority] = createSignal<Priority>('normal');
  const [dueAt, setDueAt] = createSignal('');
  const [hasTime, setHasTime] = createSignal(false);
  const [reminderAt, setReminderAt] = createSignal('');
  const [estimate, setEstimate] = createSignal('');
  const [ongoing, setOngoing] = createSignal(false);
  const [projectId, setProjectId] = createSignal<number | null>(null);
  const [visibility, setVisibility] = createSignal<'private' | 'group'>('group');
  const [recurrence, setRecurrence] = createSignal('');
  const [subtasks, setSubtasks] = createSignal<Task[]>([]);
  const [dirty, setDirty] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal('');
  const [confirmDelete, setConfirmDelete] = createSignal(false);

  createEffect(() => {
    const task = props.task;
    if (!task || !props.open) return;
    batch(() => {
      setTitle(task.title);
      setDescription(task.description);
      setNotes(task.notes);
      setPriority(task.priority);
      setDueAt(toLocalInputValue(task.due_at));
      setHasTime(task.due_has_time);
      setReminderAt(toLocalInputValue(task.reminder_at));
      setEstimate(task.estimated_minutes ? String(task.estimated_minutes) : '');
      setOngoing(task.is_ongoing);
      setProjectId(task.project?.id ?? null);
      setVisibility(task.visibility);
      setRecurrence(task.recurrence?.freq ?? '');
      setDirty(false);
      setError('');
    });
    void tasksApi.subtasks(task.id).then(setSubtasks).catch(() => setSubtasks([]));
  });

  const sortable = createSortable<Task>({
    items: () => subtasks(),
    key: (item) => item.id,
    enabled: () => (props.task?.can_edit ?? false) && subtasks().length > 1,
    onReorder: async (items) => {
      const parentId = props.task?.id;
      if (!parentId) return;
      setSubtasks(items);
      try {
        await tasksApi.reorderSubtasks(
          parentId,
          items.map((item) => item.id),
        );
      } catch {
        try {
          setSubtasks(await tasksApi.subtasks(parentId));
        } catch {
          /* keep the local order rather than emptying the list */
        }
        toast(t('Could not save the order.'));
      }
    },
  });

  const mark = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value);
    setDirty(true);
  };

  const isRunning = () => timerStore.running()?.task?.id === props.task?.id;

  const save = async () => {
    const task = props.task;
    if (!task || saving()) return;
    setSaving(true);
    setError('');
    const payload: TaskInput = {
      title: title().trim(),
      description: description(),
      notes: notes(),
      priority: priority(),
      due_at: fromLocalInputValue(dueAt()),
      due_has_time: hasTime(),
      reminder_at: fromLocalInputValue(reminderAt()),
      estimated_minutes: estimate() ? Number(estimate()) : null,
      is_ongoing: ongoing(),
      project_id: projectId(),
      visibility: visibility(),
      recurrence: recurrence()
        ? { freq: recurrence() as 'daily', interval: 1, byweekday: [], bymonthday: null, until: null }
        : null,
      version: task.version,
    };
    try {
      await tasksApi.update(task.id, payload);
      setDirty(false);
      props.onChanged?.();
      toast(t('Saved'));
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.isConflict ? t('This task changed elsewhere. Close and reopen to get the latest.') : err.message);
      } else {
        setError(t('Could not save the task.'));
      }
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    const task = props.task;
    if (!task) return;
    await tasksApi.remove(task.id);
    setConfirmDelete(false);
    props.onChanged?.();
    props.onClose();
    toast(t('Task deleted'));
  };

  const toggleComplete = async () => {
    const task = props.task;
    if (!task) return;
    if (task.status === 'done') await tasksApi.reopen(task.id);
    else await tasksApi.complete(task.id);
    props.onChanged?.();
  };

  return (
    <>
      <Drawer
        open={props.open}
        onClose={props.onClose}
        title={t('Task')}
        footer={
          <>
            <Show when={props.task?.can_delete}>
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)} aria-label={t('Delete task')}>
                <Trash2 size={14} />
              </Button>
            </Show>
            <div class={styles.footerSpacer} />
            <Button variant="ghost" onClick={props.onClose}>
              {t('Close')}
            </Button>
            <Button variant="primary" onClick={save} loading={saving()} disabled={!dirty() || !props.task?.can_edit}>
              {t('Save')}
            </Button>
          </>
        }
      >
        <Show when={props.task}>
          {(task) => (
            <div class={styles.body}>
              <Show when={error()}>
                <ErrorNote message={error()} />
              </Show>

              <div class={styles.quickBar}>
                <Show when={task().parent && props.onOpenTask}>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      const parentId = task().parent;
                      if (parentId) void tasksApi.get(parentId).then((parent) => props.onOpenTask?.(parent));
                    }}
                  >
                    <ChevronLeft size={14} />
                    {t('Back')}
                  </Button>
                </Show>
                <Button variant={task().status === 'done' ? 'secondary' : 'primary'} size="sm" onClick={toggleComplete}>
                  {task().status === 'done' ? t('Reopen') : t('Complete')}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={async () => {
                    if (isRunning()) await stopTimer();
                    else
                      await startTimer({
                        task_id: task().id,
                        category: task().kind === 'business' ? 'business' : 'personal',
                      });
                  }}
                >
                  <Show when={isRunning()} fallback={<Play size={14} />}>
                    <Square size={14} />
                  </Show>
                  {isRunning() ? t('Stop') : t('Timer')}
                </Button>
                <Button variant="secondary" size="sm" onClick={() => props.onShare?.(task())}>
                  <Share2 size={14} />
                  {t('Share')}
                </Button>
                <PolishButton
                  taskIds={() => (task().can_edit && task().status !== 'done' ? [task().id] : [])}
                  variant="secondary"
                  onChanged={props.onChanged}
                />
              </div>

              <Show when={task().tracked_seconds > 0}>
                <p class={styles.tracked}>
                  {task().estimated_minutes
                    ? t('Tracked {tracked} of {estimate} estimated', {
                        tracked: formatDuration(task().tracked_seconds),
                        estimate: formatDuration((task().estimated_minutes ?? 0) * 60),
                      })
                    : t('Tracked {tracked}', { tracked: formatDuration(task().tracked_seconds) })}
                </p>
              </Show>

              <Field label={t('Title')}>
                <Input
                  value={title()}
                  onInput={(e) => mark(setTitle)(e.currentTarget.value)}
                  disabled={!task().can_edit}
                  maxLength={300}
                />
                <Show when={isTranslated('task', task().id, 'title')}>
                  <p class={styles.hint}>{tx('task', task().id, 'title', task().title)}</p>
                </Show>
              </Field>

              <Field label={t('Description')}>
                <Textarea
                  value={description()}
                  onInput={(e) => mark(setDescription)(e.currentTarget.value)}
                  disabled={!task().can_edit}
                  rows={3}
                />
              </Field>

              <AITaskTools
                task={task()}
                currentTitle={title()}
                onApplyTitle={(value) => mark(setTitle)(value)}
                onSubtasksAdded={() => {
                  void tasksApi.subtasks(task().id).then(setSubtasks);
                  props.onChanged?.();
                }}
              />

              <div class={styles.grid}>
                <Field label={t('Priority')}>
                  <Select
                    value={priority()}
                    onChange={(e) => mark(setPriority)(e.currentTarget.value as Priority)}
                    disabled={!task().can_edit}
                  >
                    <For each={PRIORITIES}>{(value) => <option value={value}>{t(PRIORITY_LABEL[value])}</option>}</For>
                  </Select>
                </Field>

                <Field label={t('Estimate (min)')}>
                  <Input
                    type="number"
                    min="1"
                    value={estimate()}
                    onInput={(e) => mark(setEstimate)(e.currentTarget.value)}
                    disabled={!task().can_edit}
                  />
                </Field>

                <Field label={t('Due')}>
                  <DateTimeInput
                    value={dueAt()}
                    dateOnly={!hasTime()}
                    defaultTime={hasTime() ? '09:00' : '23:59'}
                    onChange={(value) => mark(setDueAt)(value)}
                    disabled={!task().can_edit}
                  />
                </Field>

                <Field label={t('Reminder')}>
                  <DateTimeInput value={reminderAt()} onChange={(value) => mark(setReminderAt)(value)} disabled={!task().can_edit} />
                </Field>
              </div>

              <div class={styles.flags}>
                <Checkbox
                  label={t('Due at a specific time')}
                  checked={hasTime()}
                  onChange={(e) => mark(setHasTime)(e.currentTarget.checked)}
                  disabled={!task().can_edit}
                />
                <Checkbox
                  label={t('Long-term work - tick it daily, complete when finished')}
                  checked={ongoing()}
                  onChange={(e) => mark(setOngoing)(e.currentTarget.checked)}
                  disabled={!task().can_edit || task().parent !== null}
                />
                {/* Check-in history: how the habit actually went, not just today's box. */}
                <Show when={task().is_ongoing && task().checkin_done_count + task().checkin_skipped_count > 0}>
                  <p class={styles.hint}>
                    <InfinityIcon size={13} />
                    <span>
                      {t('{done} days done · {skipped} skipped', {
                        done: task().checkin_done_count,
                        skipped: task().checkin_skipped_count,
                      })}
                      <Show when={task().checkin_streak > 1}> · {t('{n}-day streak', { n: task().checkin_streak })}</Show>
                    </span>
                  </p>
                </Show>
              </div>

              <Field label={t('Project')}>
                <ProjectSelector
                  value={projectId()}
                  onChange={(value) => mark(setProjectId)(value)}
                  disabled={!task().can_edit || task().parent !== null}
                />
              </Field>

              <Show when={projectId() !== null}>
                <Field label={t('Visibility')} hint={t('Private tasks in a Group Plus project stay invisible to members.')}>
                  <Select
                    value={visibility()}
                    onChange={(e) => mark(setVisibility)(e.currentTarget.value as 'private' | 'group')}
                    disabled={!task().can_edit}
                  >
                    <option value="group">{t('Visible to project members')}</option>
                    <option value="private">{t('Private to me')}</option>
                  </Select>
                </Field>
              </Show>

              <Field label={t('Repeat')}>
                <Select
                  value={recurrence()}
                  onChange={(e) => mark(setRecurrence)(e.currentTarget.value)}
                  disabled={!task().can_edit || task().parent !== null}
                >
                  <For each={RECURRENCE_OPTIONS}>{(opt) => <option value={opt.value}>{t(opt.label)}</option>}</For>
                </Select>
              </Field>

              <Show when={recurrence()}>
                <p class={styles.hint}>
                  <Repeat size={12} /> {t('The next occurrence is created when you complete this task.')}
                </p>
              </Show>

              <Field label={t('Notes')}>
                <Textarea
                  value={notes()}
                  onInput={(e) => mark(setNotes)(e.currentTarget.value)}
                  disabled={!task().can_edit}
                  rows={3}
                />
              </Field>

              <Show when={task().parent === null}>
                <section class={styles.section}>
                  <h3 class={styles.sectionTitle}>
                    {t('Subtasks')}
                    <Show when={subtasks().length > 0}>
                      <span class="mt-mono">
                        {subtasks().filter((s) => s.status === 'done').length}/{subtasks().length}
                      </span>
                    </Show>
                    <span class={styles.sectionTools}>
                      <PolishButton
                        taskIds={() => subtasks().filter((s) => s.can_edit && s.status !== 'done').map((s) => s.id)}
                        label={t('Polish subtasks')}
                        variant="ghost"
                        onChanged={async () => {
                          setSubtasks(await tasksApi.subtasks(task().id));
                          props.onChanged?.();
                        }}
                      />
                    </span>
                  </h3>
                  <div class={styles.subtasks} ref={sortable.setContainer}>
                    <For each={sortable.items()}>
                      {(subtask, index) => (
                        <SubtaskItem
                          task={subtask}
                          sortable={sortable}
                          position={index() + 1}
                          total={sortable.items().length}
                          canDrag={(props.task?.can_edit ?? false) && sortable.items().length > 1}
                          onOpen={props.onOpenTask}
                          onChanged={async () => {
                            setSubtasks(await tasksApi.subtasks(task().id));
                            props.onChanged?.();
                          }}
                        />
                      )}
                    </For>
                  </div>
                  <TaskComposer
                    parentId={task().id}
                    placeholder={t('Add a subtask…')}
                    onCreated={async () => {
                      setSubtasks(await tasksApi.subtasks(task().id));
                      props.onChanged?.();
                    }}
                  />
                </section>
              </Show>

              <Show when={task().project}>
                <section class={styles.section}>
                  <h3 class={styles.sectionTitle}>{t('Comments')}</h3>
                  <Comments task={task().id} canComment />
                </section>
              </Show>

              <p class={styles.footnote}>
                <Sparkles size={11} />{' '}
                {t('Created {date}', { date: new Date(task().created_at).toLocaleString(intlLocale()) })}
                <Show when={task().completed_by_name}>
                  {(name) => <> · {t('Completed by {name}', { name: name() })}</>}
                </Show>
              </p>
            </div>
          )}
        </Show>
      </Drawer>

      <ConfirmDialog
        open={confirmDelete()}
        title={t('Delete task?')}
        message={t('The task and its subtasks will be removed.')}
        confirmLabel={t('Delete')}
        destructive
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}

function SubtaskItem(props: {
  task: Task;
  sortable: Sortable<Task>;
  position: number;
  total: number;
  canDrag: boolean;
  onOpen?: (task: Task) => void;
  onChanged: () => void | Promise<void>;
}): JSX.Element {
  const [editing, setEditing] = createSignal(false);
  const [draft, setDraft] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [polishing, setPolishing] = createSignal(false);
  const done = () => props.task.status === 'done';
  const canPolish = () => authStore.aiEnabled() && props.task.can_edit && !done();

  const startEdit = (event?: Event) => {
    event?.preventDefault();
    event?.stopPropagation();
    if (!props.task.can_edit || busy()) return;
    setDraft(props.task.title);
    setEditing(true);
  };

  const cancel = () => {
    setEditing(false);
    setDraft('');
  };

  const save = async () => {
    if (!editing() || busy()) return;
    const title = draft().trim();
    if (!title || title === props.task.title) {
      cancel();
      return;
    }
    setEditing(false);
    setBusy(true);
    try {
      await tasksApi.update(props.task.id, { title, version: props.task.version });
      markStale('task', props.task.id);
      await props.onChanged();
    } catch (err) {
      setDraft(title);
      setEditing(true);
      toast(err instanceof ApiError ? err.message : t('Could not update the task.'));
    } finally {
      setBusy(false);
    }
  };

  const polish = async (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (polishing() || !canPolish()) return;
    setPolishing(true);
    try {
      await polishTasks([props.task.id], () => void props.onChanged());
    } finally {
      setPolishing(false);
    }
  };

  const toggleDone = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    if (busy() || !props.task.can_edit) {
      input.checked = done();
      return;
    }
    setBusy(true);
    try {
      if (input.checked) await tasksApi.complete(props.task.id);
      else await tasksApi.reopen(props.task.id);
      await props.onChanged();
    } catch {
      toast(t('Could not update the task.'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy()) return;
    setBusy(true);
    try {
      await tasksApi.remove(props.task.id);
      await props.onChanged();
      toast(t('Subtask deleted'));
    } catch {
      toast(t('Could not delete.'));
      setBusy(false);
    }
  };

  const title = () => tx('task', props.task.id, 'title', props.task.title);

  return (
    <div
      class={props.sortable.isDragging(props.task) ? `${styles.subtaskRow} ${styles.subtaskDragging}` : styles.subtaskRow}
      {...props.sortable.itemProps(props.task)}
      style={props.sortable.itemStyle(props.task)}
    >
      <Show when={props.canDrag}>
        <button
          type="button"
          class={styles.grip}
          {...props.sortable.handleProps(props.task)}
          aria-label={t('Reorder {name} ({position} of {total})', {
            name: title(),
            position: props.position,
            total: props.total,
          })}
          title={t('Drag to reorder · arrow keys to move')}
        >
          <GripVertical size={14} />
        </button>
      </Show>
      <label class={styles.subtaskCheck}>
        <input
          type="checkbox"
          checked={done()}
          disabled={!props.task.can_edit || busy()}
          onChange={toggleDone}
          aria-label={done() ? t('Reopen') : t('Complete')}
        />
      </label>
      <Show
        when={editing()}
        fallback={
          <button
            type="button"
            class={done() ? `${styles.subtaskTitle} ${styles.subtaskDone}` : styles.subtaskTitle}
            onClick={startEdit}
            disabled={!props.task.can_edit}
            title={props.task.can_edit ? t('Edit subtask') : undefined}
          >
            {title()}
          </button>
        }
      >
        <Input
          ref={(el) => {
            el?.focus();
            el?.select();
          }}
          class={styles.subtaskInput}
          sizeVariant="sm"
          value={draft()}
          disabled={busy()}
          maxLength={300}
          aria-label={t('Edit subtask')}
          onInput={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void save();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              cancel();
            }
          }}
          onBlur={() => void save()}
        />
      </Show>
      <div class={styles.subtaskActions}>
        <Show when={props.task.can_edit && !editing()}>
          <button
            type="button"
            class={`${styles.subtaskAction} ${styles.subtaskActionAlways}`}
            aria-label={t('Edit subtask')}
            title={t('Edit subtask')}
            disabled={busy()}
            onClick={startEdit}
          >
            <Pencil size={13} />
          </button>
        </Show>
        <Show when={canPolish() && !editing()}>
          <button
            type="button"
            class={styles.subtaskAction}
            aria-label={t('Polish {title} with AI', { title: props.task.title })}
            title={t('Polish with AI')}
            disabled={polishing() || busy()}
            onClick={(e) => void polish(e)}
          >
            <Sparkles size={13} />
          </button>
        </Show>
        <Show when={props.onOpen && !editing()}>
          <button
            type="button"
            class={styles.subtaskAction}
            aria-label={t('Open')}
            title={t('Open')}
            onClick={() => props.onOpen?.(props.task)}
          >
            <ChevronRight size={13} />
          </button>
        </Show>
        <Show when={props.task.can_delete && !editing()}>
          <button
            type="button"
            class={styles.subtaskAction}
            aria-label={t('Delete subtask')}
            title={t('Delete subtask')}
            disabled={busy()}
            onClick={() => void remove()}
          >
            <Trash2 size={13} />
          </button>
        </Show>
      </div>
    </div>
  );
}
