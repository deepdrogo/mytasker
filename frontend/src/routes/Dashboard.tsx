// MyTasker — the Dashboard. The whole day on one page: dated work, the week ahead, active projects, timers, routine.
// Built by drogoz · https://github.com/deepdrogo/mytasker

import { A } from '@solidjs/router';
import { CalendarOff, Check, Circle, Flame, GripVertical, Moon, Play, Rocket, ScrollText, Square, Undo2, X } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { For, Show, createMemo, createSignal, onCleanup } from 'solid-js';
import { Page } from '~/components/shared/Page';
import { PriorityMark } from '~/components/shared/Indicators';
import { ErrorNote, Skeleton } from '~/components/ui/Feedback';
import { dashboardApi } from '~/features/dashboard/api';
import { projectsApi } from '~/features/projects/api';
import { routinesApi, rulesApi } from '~/features/routines/api';
import { ShareDialog } from '~/features/sharing/ShareDialog';
import { tasksApi } from '~/features/tasks/api';
import { TaskComposer } from '~/features/tasks/TaskComposer';
import { TaskEditor } from '~/features/tasks/TaskEditor';
import { TaskList } from '~/features/tasks/TaskList';
import { createQuery, invalidate } from '~/hooks/createQuery';
import { createSortable, type Sortable } from '~/hooks/createSortable';
import { intlLocale, t, tn } from '~/i18n';
import { authStore } from '~/stores/auth';
import { tx } from '~/stores/translations';
import { startSleep, stopSleep, timerStore, toggleTimer } from '~/stores/timer';
import { toast } from '~/stores/ui';
import type { RoutineItem, Rule, Task, TodayData, TodayProject } from '~/types';
import { formatClock, formatDateFull, formatDueDate, formatMinutes, percent } from '~/utils/format';
import styles from './Dashboard.module.css';
import { cx } from '~/utils/cx';

export default function Dashboard(): JSX.Element {
  const query = createQuery<TodayData>(() => 'today', () => dashboardApi.snapshot());
  const [activeTask, setActiveTask] = createSignal<Task | null>(null);
  const [shareTasks, setShareTasks] = createSignal<Task[] | null>(null);

  // Active projects are arranged by hand: drag the grip (or use arrow keys on it), the order is saved per user list.
  const projectOrder = createSortable<TodayProject>({
    items: () => query.data()?.active_projects ?? [],
    key: (project) => project.id,
    onReorder: async (projects) => {
      // Keep the snapshot in step so any re-render shows the arranged order before the refetch lands.
      query.mutate((current) => (current ? { ...current, active_projects: projects } : current));
      try {
        await projectsApi.reorder(projects.map((project) => project.id));
      } catch {
        toast(t('Could not save the order.'));
        query.refetch();
      }
    },
  });

  // Live clock so elapsed timers tick without refetching.
  const [tick, setTick] = createSignal(0);
  const interval = setInterval(() => setTick((t) => t + 1), 1000);
  onCleanup(() => clearInterval(interval));

  const data = () => query.data();
  const refresh = () => query.refetch();

  const undo = async (task: Task) => {
    try {
      await tasksApi.reopen(task.id);
      toast(t('Reopened'));
      refresh();
    } catch {
      toast(t('Could not reopen.'));
    }
  };

  const businessSeconds = () => {
    tick();
    return timerStore.businessSecondsToday();
  };

  const runningLabel = () => {
    const running = timerStore.running();
    if (running?.task) return tx('task', running.task.id, 'title', running.task.title);
    if (running?.routine_item) return tx('routine_item', running.routine_item.id, 'name', running.routine_item.name);
    return running?.note || t('Running');
  };

  const use12h = () => authStore.user()?.preferences.time_format === '12h';

  /** Upcoming (next 7 days) grouped by local day, in order. */
  const upcomingGroups = createMemo(() => {
    const groups = new Map<string, { label: string; tasks: Task[] }>();
    for (const task of data()?.tasks.upcoming ?? []) {
      if (!task.due_at) continue;
      const date = new Date(task.due_at);
      const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
      const group = groups.get(key) ?? {
        label: date.toLocaleDateString(intlLocale(), { weekday: 'short', day: 'numeric', month: 'short' }),
        tasks: [],
      };
      group.tasks.push(task);
      groups.set(key, group);
    }
    return [...groups.values()];
  });

  const share = (task: Task) => setShareTasks([task]);

  return (
    <Page title={t('Dashboard')} subtitle={formatDateFull(new Date().toISOString())}>
      <Show when={!query.error()} fallback={<ErrorNote message={t('Could not load the dashboard.')} onRetry={refresh} />}>
        <Show when={data()} fallback={<Skeleton rows={8} height={40} />}>
          {(d) => (
            <div class={styles.grid}>
              {/* Column 1: the plate - dated work, daily check-ins, personal / business, the week ahead */}
              <section class={styles.col}>
                <TaskComposer
                  defaults={{ due_at: endOfToday() }}
                  placeholder={t('Add a task for today…')}
                  onCreated={() => {
                    refresh();
                    invalidate('tasks');
                  }}
                />

                <Show when={d().tasks.overdue.length > 0}>
                  <Section title={t('Overdue')} count={d().tasks.overdue.length} tone="strong">
                    <TaskList tasks={d().tasks.overdue} compact showProject onOpen={setActiveTask} onChanged={refresh} onShare={share} />
                  </Section>
                </Show>

                <Section title={t('Due today')} count={d().tasks.due_today.length} link={{ href: '/today', label: t('Today') }}>
                  <TaskList
                    tasks={d().tasks.due_today}
                    compact
                    showProject
                    emptyTitle={t('Nothing due today.')}
                    emptyHint={t('Add a task above or pull one from Focus.')}
                    onOpen={setActiveTask}
                    onChanged={refresh}
                    onShare={share}
                  />
                </Section>

                <Show when={d().tasks.ongoing.length > 0}>
                  <Section
                    title={t('Daily check-ins')}
                    hint={`${d().tasks.ongoing.filter((task) => task.today_checked).length}/${d().tasks.ongoing.length}`}
                  >
                    <TaskList tasks={d().tasks.ongoing} compact showProject onOpen={setActiveTask} onChanged={refresh} onShare={share} />
                  </Section>
                </Show>

                <Show when={d().tasks.focus.length > 0}>
                  <Section title={t('Focus')} hint={t('High priority, no date')}>
                    <TaskList tasks={d().tasks.focus} compact showProject onOpen={setActiveTask} onChanged={refresh} onShare={share} />
                  </Section>
                </Show>

                <div class={styles.plate}>
                  <Section title={t('Personal')} count={d().tasks.personal.length} link={{ href: '/tasks/personal', label: t('All') }}>
                    <TaskList
                      tasks={d().tasks.personal}
                      compact
                      dense
                      showProject={false}
                      emptyTitle={t('Nothing personal pending.')}
                      onOpen={setActiveTask}
                      onChanged={refresh}
                      onShare={share}
                    />
                  </Section>
                  <Section title={t('Business')} count={d().tasks.business.length} link={{ href: '/tasks/business', label: t('All') }}>
                    <TaskList
                      tasks={d().tasks.business}
                      compact
                      dense
                      showProject={false}
                      emptyTitle={t('No business tasks pending.')}
                      onOpen={setActiveTask}
                      onChanged={refresh}
                      onShare={share}
                    />
                  </Section>
                </div>

                <Section title={t('Next 7 days')} count={d().tasks.upcoming.length} link={{ href: '/tasks/upcoming', label: t('Upcoming') }}>
                  <Show when={upcomingGroups().length > 0} fallback={<p class={styles.dim}>{t('Nothing scheduled ahead.')}</p>}>
                    <div class={styles.calendar}>
                      <For each={upcomingGroups()}>
                        {(group) => (
                          <div class={styles.calDay}>
                            <div class={styles.calDayLabel}>
                              <span>{group.label}</span>
                              <span class={styles.count}>{group.tasks.length}</span>
                            </div>
                            <ul class={styles.calList}>
                              <For each={group.tasks}>
                                {(task) => (
                                  <li>
                                    <button type="button" class={styles.calTask} onClick={() => setActiveTask(task)}>
                                      <PriorityMark priority={task.priority} />
                                      <span class={styles.calTitle}>{tx('task', task.id, 'title', task.title)}</span>
                                      <Show when={task.project}>
                                        {(project) => <span class={styles.calProject}>{tx('project', project().id, 'name', project().name)}</span>}
                                      </Show>
                                      <Show when={task.due_has_time}>
                                        <span class={styles.mono}>{formatDueDate(task.due_at, true, use12h()).split(' ').pop()}</span>
                                      </Show>
                                    </button>
                                  </li>
                                )}
                              </For>
                            </ul>
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>
                </Section>

                <Section title={t('Completed today')} count={d().tasks.completed.length}>
                  <Show when={d().tasks.completed.length > 0} fallback={<p class={styles.dim}>{t('Nothing yet - the day is young.')}</p>}>
                    <ul class={styles.completed}>
                      <For each={d().tasks.completed}>
                        {(task) => (
                          <li class={styles.completedRow}>
                            <Check size={14} />
                            <button type="button" class={styles.completedTitle} onClick={() => setActiveTask(task)}>
                              {tx('task', task.id, 'title', task.title)}
                            </button>
                            <Show when={task.completed_by_name && task.completed_by?.id !== authStore.user()?.id}>
                              <span class={styles.by}>{t('by {name}', { name: task.completed_by_name ?? '' })}</span>
                            </Show>
                            <button type="button" class={styles.undo} onClick={() => void undo(task)} aria-label={t('Undo')}>
                              <Undo2 size={13} /> {t('Undo')}
                            </button>
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>
                </Section>
              </section>

              {/* Column 2: active projects, expanded vertically, in the user's own order */}
              <section class={styles.col}>
                <Section
                  title={t('Active projects')}
                  count={projectOrder.items().length}
                  hint={projectOrder.items().length > 1 ? t('drag to reorder') : t('with open tasks')}
                  link={{ href: '/projects/canvas', label: t('Canvas') }}
                >
                  <Show
                    when={projectOrder.items().length > 0}
                    fallback={<p class={styles.dim}>{t('No project has open tasks right now.')}</p>}
                  >
                    {/* The wrapper scrolls, not the list itself: the drag hook measures rows against the list and
                        auto-scrolls the nearest scrolling ancestor. */}
                    <div class={cx(projectOrder.items().length > 4 && styles.projectsScroll)}>
                      <ul class={styles.projects} ref={projectOrder.setContainer}>
                        <For each={projectOrder.items()}>
                          {(p, index) => (
                            <ProjectCardMini
                              project={p}
                              minutes={d().metrics.project_minutes[String(p.id)] ?? 0}
                              onOpenTask={(id) => void tasksApi.get(id).then(setActiveTask)}
                              sortable={projectOrder}
                              position={index() + 1}
                              total={projectOrder.items().length}
                            />
                          )}
                        </For>
                      </ul>
                    </div>
                  </Show>
                </Section>
              </section>

              {/* Column 3: timers, numbers, routine, rules - compact. On narrow screens the column dissolves
                  (display: contents): timers + stats jump to the top, routine + rules sink to the very bottom. */}
              <section class={cx(styles.col, styles.side)}>
                <div class={cx(styles.sideGroup, styles.sideTop)}>
                <div class={styles.timers}>
                  <div class={styles.tile}>
                    <div class={styles.tileHead}>
                      <span>{t('Business time')}</span>
                      <span class={styles.tileTarget}>/ {formatMinutes(d().metrics.business_target_minutes)}</span>
                    </div>
                    <div class={styles.tileRow}>
                      <span class={styles.tileValue}>{formatClock(businessSeconds())}</span>
                      <button
                        type="button"
                        class={cx(styles.tileBtn, timerStore.running() && styles.tileBtnActive)}
                        disabled={timerStore.busy()}
                        onClick={() => void toggleTimer({ category: 'business' })}
                        aria-label={timerStore.running() ? t('Stop') : t('Start')}
                        title={timerStore.running() ? runningLabel() : t('Start')}
                      >
                        <Show when={timerStore.running()} fallback={<Play size={13} />}>
                          <Square size={12} />
                        </Show>
                      </button>
                    </div>
                    <Bar value={percent(businessSeconds() / 60, d().metrics.business_target_minutes)} />
                    <Show when={timerStore.running()}>
                      <span class={styles.runningLabel}>{runningLabel()}</span>
                    </Show>
                  </div>
                  <div class={styles.tile}>
                    <div class={styles.tileHead}>
                      <span>
                        <Moon size={11} /> {t('Sleep')}
                      </span>
                      <span class={styles.tileTarget}>/ {formatMinutes(d().metrics.sleep_target_minutes)}</span>
                    </div>
                    <div class={styles.tileRow}>
                      <span class={styles.tileValue}>
                        <Show when={timerStore.sleep()} fallback={formatMinutes(d().metrics.sleep_minutes)}>
                          {(tick(), formatClock(timerStore.sleepElapsedSeconds()))}
                        </Show>
                      </span>
                      <button
                        type="button"
                        class={cx(styles.tileBtn, timerStore.sleep() && styles.tileBtnActive)}
                        disabled={timerStore.busy()}
                        onClick={() => void (timerStore.sleep() ? stopSleep() : startSleep())}
                        aria-label={timerStore.sleep() ? t('Wake up') : t('Going to sleep')}
                        title={timerStore.sleep() ? t('Wake up') : t('Going to sleep')}
                      >
                        <Show when={timerStore.sleep()} fallback={<Moon size={13} />}>
                          <Square size={12} />
                        </Show>
                      </button>
                    </div>
                  </div>
                </div>

                <div class={styles.stats}>
                  <Stat label={t('Done')} value={String(d().metrics.tasks_completed)} />
                  <Stat label={t('Planned')} value={String(d().metrics.tasks_planned)} />
                  <Stat label={t('Missed')} value={String(d().metrics.tasks_missed)} />
                  <Stat label={t('Routine')} value={`${d().metrics.routine_items_completed}/${d().metrics.routine_items_total}`} />
                  <Stat label={t('Streak')} value={<><Flame size={12} /> {d().streak}</>} />
                  <Stat label={t('Personal')} value={formatMinutes(d().metrics.personal_minutes)} />
                </div>
                </div>

                <div class={cx(styles.sideGroup, styles.sideBottom)}>
                <Show when={d().routine.paused}>
                  <p class={styles.weekendNote}>
                    <CalendarOff size={13} />
                    <span>
                      {t('Weekend - the routine takes the day off. Rules still count.')}{' '}
                      <A href="/settings/preferences" class={styles.link}>
                        {t('Change')}
                      </A>
                    </span>
                  </p>
                </Show>
                <RoutineBlock title={t('Business routine')} items={d().routine.business} currentId={d().routine.current_item_id} onChanged={refresh} />
                <RoutineBlock title={t('Personal routine')} items={d().routine.personal} currentId={d().routine.current_item_id} onChanged={refresh} />
                <RulesBlock rules={d().rules} onChanged={refresh} />

                <p class={styles.dim}>
                  {t('{tasks} done · {rate}% of plan', { tasks: tn(d().metrics.tasks_completed, 'task'), rate: d().metrics.completion_rate })} ·{' '}
                  <A href="/insights" class={styles.link}>
                    {t('Insights')}
                  </A>
                </p>
                </div>
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
        onOpenTask={(task) => void tasksApi.get(task.id).then(setActiveTask).catch(() => setActiveTask(task))}
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

function Section(props: {
  title: string;
  count?: number;
  hint?: string;
  tone?: 'strong';
  link?: { href: string; label: string };
  children: JSX.Element;
}): JSX.Element {
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
        <Show when={props.link}>
          {(link) => (
            <A href={link().href} class={cx(styles.hint, styles.sectionLink)}>
              {link().label} →
            </A>
          )}
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
      toast(t('Could not update routine.'));
    } finally {
      setBusy(null);
    }
  };

  const window = (item: RoutineItem) =>
    item.start_time && item.end_time ? `${item.start_time.slice(0, 5)}–${item.end_time.slice(0, 5)}` : item.start_time ? item.start_time.slice(0, 5) : '';
  const progress = (item: RoutineItem) => (item.target_minutes > 0 ? percent(item.today_minutes, item.target_minutes) : 0);

  return (
    <Show when={props.items.length > 0}>
      <Section title={props.title} hint={`${done()}/${props.items.length}`}>
        <div class={styles.routineProgress} aria-hidden="true">
          <For each={props.items}>{(item) => <span class={cx(styles.routineSeg, item.today_completed && styles.routineSegDone)} />}</For>
        </div>
        <ul class={styles.routine}>
          <For each={props.items}>
            {(item) => (
              <li class={cx(styles.routineRow, item.id === props.currentId && styles.current, item.today_completed && styles.routineDone)}>
                <button
                  type="button"
                  class={styles.routineCheck}
                  disabled={busy() === item.id}
                  onClick={() => void toggle(item)}
                  aria-label={item.today_completed ? t('Mark not done') : t('Mark done')}
                >
                  <Show when={item.today_completed} fallback={<Circle size={15} />}>
                    <Check size={15} />
                  </Show>
                </button>
                <div class={styles.routineBody}>
                  <div class={styles.routineLine}>
                    <span class={styles.routineName}>{tx('routine_item', item.id, 'name', item.name)}</span>
                    <Show when={item.id === props.currentId && !item.today_completed}>
                      <span class={styles.nowPill}>{t('now')}</span>
                    </Show>
                    <span class={styles.routineTime}>
                      {window(item)}
                      {item.today_minutes
                        ? `${window(item) ? ' · ' : ''}${formatMinutes(item.today_minutes)}${item.target_minutes ? ` / ${formatMinutes(item.target_minutes)}` : ''}`
                        : item.target_minutes
                          ? `${window(item) ? ' · ' : ''}${formatMinutes(item.target_minutes)}`
                          : ''}
                    </span>
                  </div>
                  <Show when={item.target_minutes > 0 && item.today_minutes > 0 && !item.today_completed}>
                    <div class={styles.miniBar}>
                      <div class={styles.miniBarFill} style={{ width: `${Math.min(100, progress(item))}%` }} />
                    </div>
                  </Show>
                </div>
              </li>
            )}
          </For>
        </ul>
      </Section>
    </Show>
  );
}

/** Daily self-check for personal rules: kept / broken / not yet checked. */
function RulesBlock(props: { rules: Rule[]; onChanged: () => void }): JSX.Element {
  const [busy, setBusy] = createSignal<number | null>(null);
  const kept = () => props.rules.filter((r) => r.today_kept === true).length;
  const checked = () => props.rules.filter((r) => r.today_kept !== null).length;

  const mark = async (rule: Rule, value: boolean) => {
    setBusy(rule.id);
    try {
      // Clicking the active state again clears the mark.
      await rulesApi.markKept(rule.id, rule.today_kept === value ? null : value);
      props.onChanged();
    } catch {
      toast(t('Could not update the rule.'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Show when={props.rules.length > 0}>
      <Section title={t('Rules')} hint={`${kept()}/${props.rules.length}`}>
        <div class={styles.routineProgress} aria-hidden="true">
          <For each={props.rules}>
            {(rule) => <span class={cx(styles.routineSeg, rule.today_kept === true && styles.routineSegDone, rule.today_kept === false && styles.routineSegBroken)} />}
          </For>
        </div>
        <ul class={cx(styles.routine, styles.rules)}>
          <For each={props.rules}>
            {(rule) => (
              <li class={cx(styles.routineRow, styles.ruleRow, rule.today_kept === true && styles.ruleKept, rule.today_kept === false && styles.ruleBroken)}>
                <ScrollText size={14} class={styles.ruleIcon} />
                <div class={styles.routineBody}>
                  <div class={styles.routineLine}>
                    <span class={styles.routineName}>{tx('rule', rule.id, 'text', rule.text)}</span>
                    <Show when={rule.streak > 1}>
                      <span class={styles.streakPill} title={t('{count} days in a row', { count: rule.streak })}>
                        <Flame size={11} /> {rule.streak}
                      </span>
                    </Show>
                  </div>
                </div>
                <div class={styles.ruleActions}>
                  <button
                    type="button"
                    class={cx(styles.ruleBtn, rule.today_kept === true && styles.ruleBtnKept)}
                    disabled={busy() === rule.id}
                    onClick={() => void mark(rule, true)}
                    aria-pressed={rule.today_kept === true}
                    aria-label={t('Kept today')}
                    title={t('Kept today')}
                  >
                    <Check size={14} />
                  </button>
                  <button
                    type="button"
                    class={cx(styles.ruleBtn, rule.today_kept === false && styles.ruleBtnBroken)}
                    disabled={busy() === rule.id}
                    onClick={() => void mark(rule, false)}
                    aria-pressed={rule.today_kept === false}
                    aria-label={t('Broken today')}
                    title={t('Broken today')}
                  >
                    <X size={14} />
                  </button>
                </div>
              </li>
            )}
          </For>
        </ul>
        <Show when={checked() < props.rules.length}>
          <p class={styles.dim}>{t('{count} still to check today', { count: props.rules.length - checked() })}</p>
        </Show>
      </Section>
    </Show>
  );
}

/** The top three slots carry a faint colour so the day's order reads at a glance: 1 red, 2 amber, 3 green. */
const RANK_CLASS: Record<number, string> = { 1: 'rank1', 2: 'rank2', 3: 'rank3' };

/** Compact project card for the dashboard: progress, next open tasks, tracked minutes, drag grip to reorder. */
function ProjectCardMini(props: {
  project: TodayProject;
  minutes: number;
  onOpenTask: (id: number) => void;
  sortable: Sortable<TodayProject>;
  position: number;
  total: number;
}): JSX.Element {
  const total = () => props.project.task_total ?? 0;
  const done = () => props.project.task_done ?? 0;
  const use12h = () => authStore.user()?.preferences.time_format === '12h';
  const name = () => tx('project', props.project.id, 'name', props.project.name);
  const rankClass = () => {
    const key = RANK_CLASS[props.position];
    return key ? styles[key] : undefined;
  };
  return (
    <li
      class={cx(styles.projectCard, rankClass(), props.sortable.isDragging(props.project) && styles.projectDragging)}
      {...props.sortable.itemProps(props.project)}
      style={props.sortable.itemStyle(props.project)}
    >
      <div class={styles.projectHeadRow}>
        <Show when={props.total > 1}>
          <button
            type="button"
            class={styles.grip}
            {...props.sortable.handleProps(props.project)}
            aria-label={t('Reorder {name} ({position} of {total})', { name: name(), position: props.position, total: props.total })}
            title={t('Drag to reorder · arrow keys to move')}
          >
            <GripVertical size={14} />
          </button>
        </Show>
        <span class={styles.rank} aria-label={t('Position {position}', { position: props.position })}>
          {props.position}
        </span>
        <A href={`/projects/${props.project.id}/tasks`} class={styles.projectHead}>
          <span class={styles.projectName}>
            <Show when={props.project.category === 'startup'}>
              <Rocket size={12} />
            </Show>
            {name()}
          </span>
          <span class={styles.mono}>
            {t('{count} open', { count: props.project.task_open ?? 0 })}
            <Show when={props.minutes > 0}> · {formatMinutes(props.minutes)}</Show>
          </span>
        </A>
      </div>
      <Show when={total() > 0}>
        <div class={styles.miniBar}>
          <div class={styles.miniBarFill} style={{ width: `${percent(done(), total())}%` }} />
        </div>
      </Show>
      <ul class={styles.nextTasks}>
        <For each={props.project.next_tasks}>
          {(task) => (
            <li>
              <button type="button" class={styles.nextTask} onClick={() => props.onOpenTask(task.id)}>
                <PriorityMark priority={task.priority} />
                <span class={styles.nextTaskTitle}>{tx('task', task.id, 'title', task.title)}</span>
                <Show when={task.due_at}>
                  <span class={styles.mono}>{formatDueDate(task.due_at, false, use12h())}</span>
                </Show>
              </button>
            </li>
          )}
        </For>
      </ul>
    </li>
  );
}
