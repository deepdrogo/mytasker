// MyTasker — the Today screen. The whole day, one page, no scrolling on desktop.
// Built by drogoz · https://github.com/deepdrogo/mytasker

import { A } from '@solidjs/router';
import { Check, Circle, Flame, Moon, Play, Square, Undo2 } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { For, Show, createMemo, createSignal, onCleanup } from 'solid-js';
import { Page } from '~/components/shared/Page';
import { Button } from '~/components/ui/Button';
import { ErrorNote, Skeleton } from '~/components/ui/Feedback';
import { routinesApi } from '~/features/routines/api';
import { ShareDialog } from '~/features/sharing/ShareDialog';
import { tasksApi } from '~/features/tasks/api';
import { TaskComposer } from '~/features/tasks/TaskComposer';
import { TaskEditor } from '~/features/tasks/TaskEditor';
import { TaskList } from '~/features/tasks/TaskList';
import { todayApi } from '~/features/today/api';
import { createQuery, invalidate } from '~/hooks/createQuery';
import { authStore } from '~/stores/auth';
import { startSleep, stopSleep, timerStore, toggleTimer } from '~/stores/timer';
import { toast } from '~/stores/ui';
import type { RoutineItem, Task, TodayData } from '~/types';
import { formatClock, formatDateFull, formatMinutes, percent, pluralize } from '~/utils/format';
import styles from './Today.module.css';
import { cx } from '~/utils/cx';

export default function Today(): JSX.Element {
  const query = createQuery<TodayData>(() => 'today', () => todayApi.snapshot());
  const [activeTask, setActiveTask] = createSignal<Task | null>(null);
  const [shareTasks, setShareTasks] = createSignal<Task[] | null>(null);

  // Live clock so elapsed timers tick without refetching.
  const [tick, setTick] = createSignal(0);
  const interval = setInterval(() => setTick((t) => t + 1), 1000);
  onCleanup(() => clearInterval(interval));

  const data = () => query.data();
  const refresh = () => query.refetch();
  const greeting = createMemo(() => {
    const hour = new Date().getHours();
    const name = authStore.user()?.display_name?.split(' ')[0] ?? '';
    const part = hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    return name ? `${part}, ${name}.` : `${part}.`;
  });

  const undo = async (task: Task) => {
    try {
      await tasksApi.reopen(task.id);
      toast('Reopened');
      refresh();
    } catch {
      toast('Could not reopen.');
    }
  };

  const businessSeconds = () => {
    tick();
    return timerStore.businessSecondsToday();
  };

  return (
    <Page title="Today" subtitle={formatDateFull(new Date().toISOString())}>
      <Show when={!query.error()} fallback={<ErrorNote message="Could not load today." onRetry={refresh} />}>
        <Show when={data()} fallback={<Skeleton rows={8} height={40} />}>
          {(d) => (
            <div class={styles.grid}>
              {/* Column 1: tasks */}
              <section class={styles.col}>
                <p class={styles.greeting}>{greeting()}</p>
                <TaskComposer
                  defaults={{ due_at: endOfToday() }}
                  placeholder="Add a task for today…"
                  onCreated={() => {
                    refresh();
                    invalidate('tasks');
                  }}
                />

                <Show when={d().tasks.overdue.length > 0}>
                  <Section title="Overdue" count={d().tasks.overdue.length} tone="strong">
                    <TaskList tasks={d().tasks.overdue} compact showProject onOpen={setActiveTask} onChanged={refresh} onShare={(t) => setShareTasks([t])} />
                  </Section>
                </Show>

                <Section title="Due today" count={d().tasks.due_today.length}>
                  <TaskList
                    tasks={d().tasks.due_today}
                    compact
                    showProject
                    emptyTitle="Nothing due today."
                    emptyHint="Add a task above or pull one from Focus."
                    onOpen={setActiveTask}
                    onChanged={refresh}
                    onShare={(t) => setShareTasks([t])}
                  />
                </Section>

                <Show when={d().tasks.focus.length > 0}>
                  <Section title="Focus" hint="High priority, no date">
                    <TaskList tasks={d().tasks.focus} compact showProject onOpen={setActiveTask} onChanged={refresh} onShare={(t) => setShareTasks([t])} />
                  </Section>
                </Show>

                <Section title="Completed today" count={d().tasks.completed.length}>
                  <Show when={d().tasks.completed.length > 0} fallback={<p class={styles.dim}>Nothing yet - the day is young.</p>}>
                    <ul class={styles.completed}>
                      <For each={d().tasks.completed}>
                        {(task) => (
                          <li class={styles.completedRow}>
                            <Check size={14} />
                            <button type="button" class={styles.completedTitle} onClick={() => setActiveTask(task)}>
                              {task.title}
                            </button>
                            <Show when={task.completed_by_name && task.completed_by?.id !== authStore.user()?.id}>
                              <span class={styles.by}>by {task.completed_by_name}</span>
                            </Show>
                            <button type="button" class={styles.undo} onClick={() => void undo(task)} aria-label="Undo">
                              <Undo2 size={13} /> Undo
                            </button>
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>
                </Section>
              </section>

              {/* Column 2: time + routine */}
              <section class={styles.col}>
                <div class={styles.card}>
                  <div class={styles.cardHead}>
                    <span>Business time</span>
                    <span class={styles.target}>target {formatMinutes(d().metrics.business_target_minutes)}</span>
                  </div>
                  <div class={styles.big}>{formatClock(businessSeconds())}</div>
                  <Bar value={percent(businessSeconds() / 60, d().metrics.business_target_minutes)} />
                  <div class={styles.cardActions}>
                    <Button
                      variant={timerStore.running() ? 'secondary' : 'primary'}
                      size="sm"
                      loading={timerStore.busy()}
                      onClick={() => void toggleTimer({ category: 'business' })}
                    >
                      <Show when={timerStore.running()} fallback={<><Play size={14} /> Start</>}>
                        <Square size={14} /> Stop
                      </Show>
                    </Button>
                    <Show when={timerStore.running()}>
                      <span class={styles.runningLabel}>
                        {timerStore.running()?.task?.title || timerStore.running()?.routine_item?.name || timerStore.running()?.note || 'Running'}
                      </span>
                    </Show>
                  </div>
                </div>

                <div class={styles.card}>
                  <div class={styles.cardHead}>
                    <span>
                      <Moon size={13} /> Sleep
                    </span>
                    <span class={styles.target}>target {formatMinutes(d().metrics.sleep_target_minutes)}</span>
                  </div>
                  <div class={styles.bigSmall}>
                    <Show when={timerStore.sleep()} fallback={formatMinutes(d().metrics.sleep_minutes)}>
                      {(tick(), formatClock(timerStore.sleepElapsedSeconds()))}
                    </Show>
                  </div>
                  <div class={styles.cardActions}>
                    <Button variant="secondary" size="sm" loading={timerStore.busy()} onClick={() => void (timerStore.sleep() ? stopSleep() : startSleep())}>
                      {timerStore.sleep() ? 'Wake up' : 'Going to sleep'}
                    </Button>
                  </div>
                </div>

                <RoutineBlock title="Business routine" items={d().routine.business} currentId={d().routine.current_item_id} onChanged={refresh} />
                <RoutineBlock title="Personal routine" items={d().routine.personal} currentId={d().routine.current_item_id} onChanged={refresh} />
              </section>

              {/* Column 3: metrics + projects */}
              <section class={styles.col}>
                <div class={styles.stats}>
                  <Stat label="Done" value={String(d().metrics.tasks_completed)} />
                  <Stat label="Planned" value={String(d().metrics.tasks_planned)} />
                  <Stat label="Missed" value={String(d().metrics.tasks_missed)} />
                  <Stat label="Routine" value={`${d().metrics.routine_items_completed}/${d().metrics.routine_items_total}`} />
                  <Stat label="Streak" value={<><Flame size={13} /> {d().streak}</>} />
                  <Stat label="Personal" value={formatMinutes(d().metrics.personal_minutes)} />
                </div>

                <Section title="Active projects" count={d().active_projects.length}>
                  <Show when={d().active_projects.length > 0} fallback={<p class={styles.dim}>No active projects.</p>}>
                    <ul class={styles.projects}>
                      <For each={d().active_projects}>
                        {(p) => (
                          <li>
                            <A href={`/projects/${p.id}`} class={styles.projectLink}>
                              <span>{p.name}</span>
                              <Show when={d().metrics.project_minutes[String(p.id)]}>
                                <span class={styles.mono}>{formatMinutes(d().metrics.project_minutes[String(p.id)] ?? 0)}</span>
                              </Show>
                            </A>
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>
                </Section>

                <p class={styles.dim}>
                  {pluralize(d().metrics.tasks_completed, 'task')} done · {d().metrics.completion_rate}% of plan ·{' '}
                  <A href="/insights" class={styles.link}>
                    Insights
                  </A>
                </p>
              </section>
            </div>
          )}
        </Show>
      </Show>

      <TaskEditor
        task={activeTask()}
        open={activeTask() !== null}
        onClose={() => setActiveTask(null)}
        onChanged={() => {
          refresh();
          const current = activeTask();
          if (current) void tasksApi.get(current.id).then(setActiveTask).catch(() => setActiveTask(null));
        }}
        onShare={(task) => setShareTasks([task])}
      />
      <ShareDialog tasks={shareTasks()} open={shareTasks() !== null} onClose={() => setShareTasks(null)} />
    </Page>
  );
}

function endOfToday(): string {
  const d = new Date();
  d.setHours(23, 59, 0, 0);
  return d.toISOString();
}

function Section(props: { title: string; count?: number; hint?: string; tone?: 'strong'; children: JSX.Element }): JSX.Element {
  return (
    <div class={styles.section}>
      <div class={cx(styles.sectionHead, props.tone === 'strong' && styles.strong)}>
        <span>{props.title}</span>
        <Show when={props.count !== undefined}>
          <span class={styles.count}>{props.count}</span>
        </Show>
        <Show when={props.hint}>
          <span class={styles.hint}>{props.hint}</span>
        </Show>
      </div>
      {props.children}
    </div>
  );
}

function Stat(props: { label: string; value: JSX.Element }): JSX.Element {
  return (
    <div class={styles.stat}>
      <span class={styles.statValue}>{props.value}</span>
      <span class={styles.statLabel}>{props.label}</span>
    </div>
  );
}

function Bar(props: { value: number }): JSX.Element {
  return (
    <div class={styles.bar} role="progressbar" aria-valuenow={props.value} aria-valuemin={0} aria-valuemax={100}>
      <div class={styles.barFill} style={{ width: `${Math.min(100, props.value)}%` }} />
    </div>
  );
}

function RoutineBlock(props: { title: string; items: RoutineItem[]; currentId: number | null; onChanged: () => void }): JSX.Element {
  const [busy, setBusy] = createSignal<number | null>(null);
  const done = () => props.items.filter((i) => i.today_completed).length;

  const toggle = async (item: RoutineItem) => {
    setBusy(item.id);
    try {
      await routinesApi.complete(item.id, !item.today_completed);
      props.onChanged();
    } catch {
      toast('Could not update routine.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Show when={props.items.length > 0}>
      <Section title={props.title} hint={`${done()}/${props.items.length}`}>
        <ul class={styles.routine}>
          <For each={props.items}>
            {(item) => (
              <li class={cx(styles.routineRow, item.id === props.currentId && styles.current, item.today_completed && styles.routineDone)}>
                <button
                  type="button"
                  class={styles.routineCheck}
                  disabled={busy() === item.id}
                  onClick={() => void toggle(item)}
                  aria-label={item.today_completed ? 'Mark not done' : 'Mark done'}
                >
                  <Show when={item.today_completed} fallback={<Circle size={15} />}>
                    <Check size={15} />
                  </Show>
                </button>
                <span class={styles.routineName}>{item.name}</span>
                <span class={styles.routineTime}>
                  {item.start_time ? item.start_time.slice(0, 5) : ''}
                  {item.today_minutes ? ` · ${formatMinutes(item.today_minutes)}` : item.target_minutes ? ` · ${formatMinutes(item.target_minutes)}` : ''}
                </span>
              </li>
            )}
          </For>
        </ul>
      </Section>
    </Show>
  );
}
