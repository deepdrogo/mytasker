// MyTasker — the Dashboard. The Working projects board next to the day's timers, numbers, routine and rules.
// Built by drogoz · https://github.com/deepdrogo/mytasker

import { A } from '@solidjs/router';
import { CalendarOff, Check, Circle, Flame, Moon, Play, ScrollText, Square, X } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { For, Show, createSignal, onCleanup } from 'solid-js';
import { Page } from '~/components/shared/Page';
import { ErrorNote, Skeleton } from '~/components/ui/Feedback';
import { dashboardApi } from '~/features/dashboard/api';
import { WorkingBoard } from '~/features/projects/WorkingBoard';
import { routinesApi, rulesApi } from '~/features/routines/api';
import { createQuery } from '~/hooks/createQuery';
import { t, tn } from '~/i18n';
import { tx } from '~/stores/translations';
import { startSleep, stopSleep, timerStore, toggleTimer } from '~/stores/timer';
import { toast } from '~/stores/ui';
import type { RoutineItem, Rule, TodayData } from '~/types';
import { formatClock, formatDateFull, formatMinutes, percent } from '~/utils/format';
import styles from './Dashboard.module.css';
import { cx } from '~/utils/cx';

export default function Dashboard(): JSX.Element {
  const query = createQuery<TodayData>(() => 'today', () => dashboardApi.snapshot());
  // Live clock so elapsed timers tick without refetching.
  const [tick, setTick] = createSignal(0);
  const interval = setInterval(() => setTick((t) => t + 1), 1000);
  onCleanup(() => clearInterval(interval));

  const data = () => query.data();
  const refresh = () => query.refetch();

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

  return (
    <Page title={t('Dashboard')} subtitle={formatDateFull(new Date().toISOString())}>
      <Show when={!query.error()} fallback={<ErrorNote message={t('Could not load the dashboard.')} onRetry={refresh} />}>
        <Show when={data()} fallback={<Skeleton rows={8} height={40} />}>
          {(d) => (
            <div class={styles.grid}>
              {/* Main column: the Working projects board, the same as on its own page */}
              <section class={styles.col}>
                <WorkingBoard />
              </section>

              {/* Side column: timers, numbers, routine, rules - compact. On narrow screens the column dissolves
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

    </Page>
  );
}

function Section(props: {
  title: string;
  count?: number;
  hint?: string;
  tone?: 'strong';
  action?: JSX.Element;
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
        <Show when={props.action}>
          <span class={styles.sectionAction}>{props.action}</span>
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
