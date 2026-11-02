// MyTasker — the 24-hour cycle. Sleep, work, fun and exercise over the last 24 hours, whatever the clock says:
// a night split in two, a nap at noon or training at dawn all land in the same rolling day.

import { Briefcase, Check, Dumbbell, Gamepad2, Moon, Play, Square } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { For, Show, createMemo, createSignal, onCleanup } from 'solid-js';
import { api } from '~/api/client';
import { createQuery } from '~/hooks/createQuery';
import { t } from '~/i18n';
import { tx } from '~/stores/translations';
import { startSleep, startTimer, stopSleep, stopTimer, timerStore } from '~/stores/timer';
import { toast } from '~/stores/ui';
import type { CycleData, CycleKind } from '~/types';
import { cx } from '~/utils/cx';
import { formatClock, formatDuration, formatTime } from '~/utils/format';
import { arcPath, clockAngle, liveSeconds, pointAt, share, spanAngles } from './cycleMath';
import styles from './CycleCard.module.css';

type GoalKind = 'sleep' | 'business' | 'fun' | 'exercise';

const GOALS: Array<{ kind: GoalKind; label: string; icon: () => JSX.Element }> = [
  { kind: 'sleep', label: 'Sleep', icon: () => <Moon size={13} /> },
  { kind: 'business', label: 'Work', icon: () => <Briefcase size={13} /> },
  { kind: 'fun', label: 'Fun', icon: () => <Gamepad2 size={13} /> },
  { kind: 'exercise', label: 'Exercise', icon: () => <Dumbbell size={13} /> },
];

const KIND_LABEL: Record<CycleKind, string> = { sleep: 'Sleep', business: 'Work', fun: 'Fun', exercise: 'Exercise', personal: 'Other' };
const KIND_CLASS: Record<CycleKind, string> = {
  sleep: styles.kSleep!,
  business: styles.kWork!,
  fun: styles.kFun!,
  exercise: styles.kExercise!,
  personal: styles.kOther!,
};

/** Durations for the rows: a bare "0" reads better than "0s" next to "/ 8h". */
const dur = (seconds: number) => (seconds < 60 ? '0' : formatDuration(seconds));

const SIZE = 240;
const C = SIZE / 2;
const TRACK_R = 108;
const LABEL_R = 92;
const RING_R: Record<GoalKind, number> = { sleep: 76, business: 64, fun: 52, exercise: 40 };
const HOURS = [0, 6, 12, 18];

type Fetched = CycleData & { fetched_at: number };

export function CycleCard(): JSX.Element {
  const query = createQuery<Fetched>(
    () => 'timer:cycle',
    async () => ({ ...(await api.get<CycleData>('/timer/cycle/')), fetched_at: Date.now() }),
  );
  const [now, setNow] = createSignal(Date.now());
  const tick = setInterval(() => setNow(Date.now()), 1000);
  // The window slides: re-read it every minute so the oldest minutes fall off.
  const refresh = setInterval(() => query.refetch(), 60_000);
  onCleanup(() => {
    clearInterval(tick);
    clearInterval(refresh);
  });

  /** The store knows at once what runs; the cycle data catches up a moment later. */
  const runningKind = (): CycleKind | null => (timerStore.sleep() ? 'sleep' : (timerStore.running()?.category ?? null));
  const runningSince = (): string | undefined => timerStore.sleep()?.started_at ?? timerStore.running()?.started_at;

  const live = createMemo(() => {
    const data = query.data();
    return data ? liveSeconds(data, data.fetched_at, now()) : null;
  });

  const segments = createMemo(() => {
    const data = query.data();
    if (!data) return [];
    const windowEnd = data.window_end;
    return data.segments.map((segment) => {
      const from = new Date(segment.start);
      const to = data.running && segment.end === windowEnd ? new Date(now()) : new Date(segment.end);
      const angles = spanAngles(from, to);
      return { ...segment, from, to, path: arcPath(C, C, TRACK_R, angles.start, angles.sweep) };
    });
  });

  const toggle = async (kind: GoalKind) => {
    try {
      if (runningKind() === kind) {
        if (kind === 'sleep') await stopSleep();
        else await stopTimer();
      } else if (kind === 'sleep') {
        await startSleep();
      } else {
        await startTimer({ category: kind });
      }
    } catch {
      toast(t('Could not switch the timer.'));
    }
  };

  const runningName = (): string => {
    const kind = runningKind();
    const task = timerStore.running()?.task;
    if (kind && kind !== 'sleep' && task) return tx('task', task.id, 'title', task.title);
    return kind ? t(KIND_LABEL[kind]) : t('Last 24 hours');
  };

  const handAngle = () => clockAngle(new Date(now()));
  const ringLength = (r: number) => 2 * Math.PI * r;

  return (
    <section class={styles.card} aria-label={t('24-hour cycle')}>
      <header class={styles.head}>
        <span class={styles.title}>{t('24-hour cycle')}</span>
        <span class={styles.sub}>{t('Last 24 hours')}</span>
      </header>

      <div class={styles.main}>
      <div class={styles.dial}>
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} class={styles.svg} role="img" aria-label={t('24-hour cycle')}>
          {/* Clock face: the last 24 hours laid on a 24h dial, midnight on top. */}
          <circle cx={C} cy={C} r={TRACK_R} class={styles.track} />
          <For each={Array.from({ length: 24 }, (_, hour) => hour)}>
            {(hour) => {
              const [x0, y0] = pointAt(C, C, TRACK_R - 9, hour * 15);
              const [x1, y1] = pointAt(C, C, TRACK_R - (hour % 6 === 0 ? 14 : 11), hour * 15);
              return <line x1={x0} y1={y0} x2={x1} y2={y1} class={cx(styles.tick, hour % 6 === 0 && styles.tickMajor)} />;
            }}
          </For>
          <For each={HOURS}>
            {(hour) => {
              const [x, y] = pointAt(C, C, LABEL_R - 8, hour * 15);
              return (
                <text x={x} y={y} class={styles.hourLabel} text-anchor="middle" dominant-baseline="central">
                  {String(hour).padStart(2, '0')}
                </text>
              );
            }}
          </For>
          <For each={segments()}>
            {(segment) => (
              <path d={segment.path} class={cx(styles.segment, KIND_CLASS[segment.kind])}>
                <title>
                  {`${t(KIND_LABEL[segment.kind])} · ${formatTime(segment.from.toISOString())}–${formatTime(segment.to.toISOString())}`}
                </title>
              </path>
            )}
          </For>
          {/* Now: the seam between the newest and the oldest minute of the window. */}
          {(() => {
            const outer = () => pointAt(C, C, TRACK_R + 9, handAngle());
            const inner = () => pointAt(C, C, TRACK_R - 9, handAngle());
            const dot = () => pointAt(C, C, TRACK_R, handAngle());
            return (
              <>
                <line x1={inner()[0]} y1={inner()[1]} x2={outer()[0]} y2={outer()[1]} class={styles.hand} />
                <circle cx={dot()[0]} cy={dot()[1]} r={3.5} class={styles.handDot} />
              </>
            );
          })()}

          {/* Goal rings: how much of each day's target the last 24 hours hold. */}
          <For each={GOALS}>
            {(goal) => {
              const r = RING_R[goal.kind];
              const length = ringLength(r);
              const progress = () => {
                const data = query.data();
                const seconds = live()?.seconds[goal.kind] ?? 0;
                return data ? share(seconds, data.target_minutes[goal.kind]) : 0;
              };
              return (
                <g class={KIND_CLASS[goal.kind]}>
                  <circle cx={C} cy={C} r={r} class={styles.ringTrack} />
                  <circle
                    cx={C}
                    cy={C}
                    r={r}
                    class={cx(styles.ring, progress() >= 1 && styles.ringFull)}
                    stroke-dasharray={`${length} ${length}`}
                    stroke-dashoffset={length * (1 - progress())}
                    transform={`rotate(-90 ${C} ${C})`}
                  />
                </g>
              );
            }}
          </For>
        </svg>

        <div class={cx(styles.center, runningKind() && KIND_CLASS[runningKind()!])}>
          <span class={styles.centerLabel} title={runningName()}>
            {runningName()}
          </span>
          <Show
            when={runningKind()}
            fallback={<span class={styles.centerValue}>{dur(query.data()?.tracked_seconds ?? 0)}</span>}
          >
            <span class={cx(styles.centerValue, styles.centerLive)}>
              {(now(), formatClock(Math.max(0, Math.floor((now() - new Date(runningSince() ?? now()).getTime()) / 1000))))}
            </span>
          </Show>
          <span class={styles.centerSub}>{runningKind() ? t('running') : t('of 24h tracked')}</span>
        </div>
      </div>

      <ul class={styles.rows}>
        <For each={GOALS}>
          {(goal) => {
            const seconds = () => live()?.seconds[goal.kind] ?? 0;
            const target = () => query.data()?.target_minutes[goal.kind] ?? 0;
            const met = () => target() > 0 && seconds() >= target() * 60;
            const active = () => runningKind() === goal.kind;
            return (
              <li class={cx(styles.row, KIND_CLASS[goal.kind], active() && styles.rowActive)}>
                <span class={styles.rowIcon}>{goal.icon()}</span>
                <div class={styles.rowBody}>
                  <div class={styles.rowLine}>
                    <span class={styles.rowName}>{t(goal.label)}</span>
                    <span class={styles.rowValue}>
                      {dur(seconds())}
                      <span class={styles.rowTarget}> / {formatDuration(target() * 60)}</span>
                    </span>
                  </div>
                  <div class={styles.rowBar}>
                    <div class={styles.rowFill} style={{ width: `${share(seconds(), target()) * 100}%` }} />
                  </div>
                  <span class={styles.rowHint}>
                    <Show when={met()} fallback={target() > 0 ? t('{time} left', { time: formatDuration(target() * 60 - seconds()) }) : ''}>
                      <Check size={11} /> {t('Goal met')}
                    </Show>
                  </span>
                </div>
                <button
                  type="button"
                  class={cx(styles.rowBtn, active() && styles.rowBtnActive)}
                  disabled={timerStore.busy()}
                  onClick={() => void toggle(goal.kind)}
                  aria-pressed={active()}
                  aria-label={active() ? t('Stop {name}', { name: t(goal.label) }) : t('Start {name}', { name: t(goal.label) })}
                  title={active() ? t('Stop {name}', { name: t(goal.label) }) : t('Start {name}', { name: t(goal.label) })}
                >
                  <Show when={active()} fallback={<Play size={12} />}>
                    <Square size={11} />
                  </Show>
                </button>
              </li>
            );
          }}
          </For>
      </ul>
      </div>

      <p class={styles.foot}>
        <span>
          <i class={cx(styles.key, styles.kFree)} /> {t('Free')} <b>{dur(live()?.free ?? 0)}</b>
        </span>
        <Show when={(live()?.seconds.personal ?? 0) > 0}>
          <span>
            <i class={cx(styles.key, styles.kOther)} /> {t('Other')} <b>{dur(live()?.seconds.personal ?? 0)}</b>
          </span>
        </Show>
      </p>
    </section>
  );
}
