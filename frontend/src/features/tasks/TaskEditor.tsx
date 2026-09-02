import { Play, Repeat, Share2, Sparkles, Square, Trash2 } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { batch, createEffect, createSignal, For, Show } from 'solid-js';
import { ApiError } from '~/api/client';
import { Button } from '~/components/ui/Button';
import { Drawer } from '~/components/ui/Drawer';
import { ConfirmDialog, ErrorNote } from '~/components/ui/Feedback';
import { Checkbox, Field, Input, Select, Textarea } from '~/components/ui/Input';
import { AITaskTools } from '~/features/ai/AITaskTools';
import { Comments } from '~/features/collab/Comments';
import { ProjectSelector } from '~/features/projects/ProjectSelector';
import { tasksApi, type TaskInput } from '~/features/tasks/api';
import { TaskComposer } from '~/features/tasks/TaskComposer';
import { startTimer, stopTimer, timerStore } from '~/stores/timer';
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
}

const PRIORITIES: Priority[] = ['critical', 'high', 'normal', 'low'];
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
      setProjectId(task.project?.id ?? null);
      setVisibility(task.visibility);
      setRecurrence(task.recurrence?.freq ?? '');
      setDirty(false);
      setError('');
    });
    void tasksApi.subtasks(task.id).then(setSubtasks).catch(() => setSubtasks([]));
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
      toast('Saved');
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.isConflict ? 'This task changed elsewhere. Close and reopen to get the latest.' : err.message);
      } else {
        setError('Could not save the task.');
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
    toast('Task deleted');
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
        title="Task"
        footer={
          <>
            <Show when={props.task?.can_delete}>
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)} aria-label="Delete task">
                <Trash2 size={14} />
              </Button>
            </Show>
            <div class={styles.footerSpacer} />
            <Button variant="ghost" onClick={props.onClose}>
              Close
            </Button>
            <Button variant="primary" onClick={save} loading={saving()} disabled={!dirty() || !props.task?.can_edit}>
              Save
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
                <Button variant={task().status === 'done' ? 'secondary' : 'primary'} size="sm" onClick={toggleComplete}>
                  {task().status === 'done' ? 'Reopen' : 'Complete'}
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
                  {isRunning() ? 'Stop' : 'Timer'}
                </Button>
                <Button variant="secondary" size="sm" onClick={() => props.onShare?.(task())}>
                  <Share2 size={14} />
                  Share
                </Button>
              </div>

              <Show when={task().tracked_seconds > 0}>
                <p class={styles.tracked}>
                  Tracked <span class="mt-mono">{formatDuration(task().tracked_seconds)}</span>
                  <Show when={task().estimated_minutes}>
                    {' '}
                    of <span class="mt-mono">{formatDuration((task().estimated_minutes ?? 0) * 60)}</span> estimated
                  </Show>
                </p>
              </Show>

              <Field label="Title">
                <Input
                  value={title()}
                  onInput={(e) => mark(setTitle)(e.currentTarget.value)}
                  disabled={!task().can_edit}
                  maxLength={300}
                />
              </Field>

              <Field label="Description">
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
                <Field label="Priority">
                  <Select
                    value={priority()}
                    onChange={(e) => mark(setPriority)(e.currentTarget.value as Priority)}
                    disabled={!task().can_edit}
                  >
                    <For each={PRIORITIES}>
                      {(value) => <option value={value}>{value[0]!.toUpperCase() + value.slice(1)}</option>}
                    </For>
                  </Select>
                </Field>

                <Field label="Estimate (min)">
                  <Input
                    type="number"
                    min="1"
                    value={estimate()}
                    onInput={(e) => mark(setEstimate)(e.currentTarget.value)}
                    disabled={!task().can_edit}
                  />
                </Field>

                <Field label="Due">
                  <Input
                    type={hasTime() ? 'datetime-local' : 'date'}
                    value={hasTime() ? dueAt() : dueAt().slice(0, 10)}
                    onInput={(e) => mark(setDueAt)(hasTime() ? e.currentTarget.value : `${e.currentTarget.value}T23:59`)}
                    disabled={!task().can_edit}
                  />
                </Field>

                <Field label="Reminder">
                  <Input
                    type="datetime-local"
                    value={reminderAt()}
                    onInput={(e) => mark(setReminderAt)(e.currentTarget.value)}
                    disabled={!task().can_edit}
                  />
                </Field>
              </div>

              <Checkbox
                label="Due at a specific time"
                checked={hasTime()}
                onChange={(e) => mark(setHasTime)(e.currentTarget.checked)}
                disabled={!task().can_edit}
              />

              <Field label="Project">
                <ProjectSelector
                  value={projectId()}
                  onChange={(value) => mark(setProjectId)(value)}
                  disabled={!task().can_edit || task().parent !== null}
                />
              </Field>

              <Show when={projectId() !== null}>
                <Field label="Visibility" hint="Private tasks in a Group Plus project stay invisible to members.">
                  <Select
                    value={visibility()}
                    onChange={(e) => mark(setVisibility)(e.currentTarget.value as 'private' | 'group')}
                    disabled={!task().can_edit}
                  >
                    <option value="group">Visible to project members</option>
                    <option value="private">Private to me</option>
                  </Select>
                </Field>
              </Show>

              <Field label="Repeat">
                <Select
                  value={recurrence()}
                  onChange={(e) => mark(setRecurrence)(e.currentTarget.value)}
                  disabled={!task().can_edit || task().parent !== null}
                >
                  <For each={RECURRENCE_OPTIONS}>{(opt) => <option value={opt.value}>{opt.label}</option>}</For>
                </Select>
              </Field>

              <Show when={recurrence()}>
                <p class={styles.hint}>
                  <Repeat size={12} /> The next occurrence is created when you complete this task.
                </p>
              </Show>

              <Field label="Notes">
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
                    Subtasks
                    <Show when={subtasks().length > 0}>
                      <span class="mt-mono">
                        {subtasks().filter((s) => s.status === 'done').length}/{subtasks().length}
                      </span>
                    </Show>
                  </h3>
                  <div class={styles.subtasks}>
                    <For each={subtasks()}>
                      {(subtask) => (
                        <label class={styles.subtaskRow}>
                          <input
                            type="checkbox"
                            checked={subtask.status === 'done'}
                            disabled={!subtask.can_edit}
                            onChange={async (e) => {
                              if (e.currentTarget.checked) await tasksApi.complete(subtask.id);
                              else await tasksApi.reopen(subtask.id);
                              setSubtasks(await tasksApi.subtasks(task().id));
                              props.onChanged?.();
                            }}
                          />
                          <span class={subtask.status === 'done' ? styles.subtaskDone : undefined}>
                            {subtask.title}
                          </span>
                        </label>
                      )}
                    </For>
                  </div>
                  <TaskComposer
                    parentId={task().id}
                    placeholder="Add a subtask…"
                    onCreated={async () => {
                      setSubtasks(await tasksApi.subtasks(task().id));
                      props.onChanged?.();
                    }}
                  />
                </section>
              </Show>

              <Show when={task().project}>
                <section class={styles.section}>
                  <h3 class={styles.sectionTitle}>Comments</h3>
                  <Comments task={task().id} canComment />
                </section>
              </Show>

              <p class={styles.footnote}>
                <Sparkles size={11} /> Created {new Date(task().created_at).toLocaleString()}
                <Show when={task().completed_by_name}>
                  {' '}
                  · Completed by {task().completed_by_name}
                </Show>
              </p>
            </div>
          )}
        </Show>
      </Drawer>

      <ConfirmDialog
        open={confirmDelete()}
        title="Delete task?"
        message="The task and its subtasks will be removed."
        confirmLabel="Delete"
        destructive
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}
