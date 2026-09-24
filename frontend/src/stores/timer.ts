/**
 * Timer state. The backend owns `started_at`; this store only renders elapsed time and survives
 * refreshes because it always re-reads the running entry from the API.
 */

import { createSignal } from 'solid-js';
import { api } from '~/api/client';
import { invalidate } from '~/hooks/createQuery';
import type { ID, SleepSession, TimeCategory, TimeEntry } from '~/types';

export interface TimerState {
  running: TimeEntry | null;
  sleep: SleepSession | null;
  today: { business: number; personal: number; total: number };
}

/**
 * Server totals already contain the timer that was running when they were read, up to that moment.
 * Remember which entry that was and when, so the live figure adds only the time since - never twice.
 */
interface TotalsSnapshot {
  today: TimerState['today'];
  runningId: ID | null;
  runningCategory: TimeCategory | null;
  readAt: number;
}

const [running, setRunning] = createSignal<TimeEntry | null>(null);
const [sleep, setSleep] = createSignal<SleepSession | null>(null);
const [totals, setTotals] = createSignal<TotalsSnapshot>({
  today: { business: 0, personal: 0, total: 0 },
  runningId: null,
  runningCategory: null,
  readAt: Date.now(),
});
const todayTotals = () => totals().today;

function applyTotals(state: TimerState): void {
  setTotals({
    today: state.today,
    runningId: state.running?.id ?? null,
    runningCategory: state.running?.category ?? null,
    readAt: Date.now(),
  });
}
const [nowMs, setNowMs] = createSignal(Date.now());
const [busy, setBusy] = createSignal(false);

let ticker: number | undefined;

function ensureTicker(): void {
  const needed = running() !== null || sleep() !== null;
  if (needed && ticker === undefined) {
    ticker = window.setInterval(() => setNowMs(Date.now()), 1000);
  } else if (!needed && ticker !== undefined) {
    window.clearInterval(ticker);
    ticker = undefined;
  }
}

function elapsedFrom(startedAt: string | undefined): number {
  if (!startedAt) return 0;
  return Math.max(0, Math.floor((nowMs() - new Date(startedAt).getTime()) / 1000));
}

export const timerStore = {
  running,
  sleep,
  busy,
  todayTotals,
  elapsedSeconds: (): number => elapsedFrom(running()?.started_at),
  sleepElapsedSeconds: (): number => elapsedFrom(sleep()?.started_at),
  /** Live business seconds today including the running business timer. */
  businessSecondsToday: (): number => {
    const snapshot = totals();
    const entry = running();
    const base = snapshot.today.business;
    if (entry && entry.id === snapshot.runningId) {
      // Already counted up to `readAt`; add only what has run since.
      return snapshot.runningCategory === 'business' ? base + Math.max(0, Math.floor((nowMs() - snapshot.readAt) / 1000)) : base;
    }
    // A timer started after the totals were read is not in them yet (the refresh after start catches up).
    return entry && entry.category === 'business' ? base + elapsedFrom(entry.started_at) : base;
  },
  isTrackingTask: (taskId: ID): boolean => running()?.task?.id === taskId,
};

export function applyRunningTimer(entry: TimeEntry | null): void {
  setRunning(entry);
  setNowMs(Date.now());
  ensureTicker();
}

export function applySleep(session: SleepSession | null): void {
  setSleep(session);
  ensureTicker();
}

export async function loadTimerState(): Promise<void> {
  try {
    const state = await api.get<TimerState>('/timer/');
    setRunning(state.running);
    setSleep(state.sleep);
    applyTotals(state);
    setNowMs(Date.now());
    ensureTicker();
  } catch {
    applyRunningTimer(null);
  }
}


export interface StartTimerInput {
  category?: TimeCategory;
  task_id?: ID | null;
  project_id?: ID | null;
  routine_item_id?: ID | null;
  note?: string;
}

const TIMER_SCOPES = ['timer', 'today', 'tasks', 'routines', 'analytics', 'projects'];

export async function startTimer(input: StartTimerInput = {}): Promise<TimeEntry> {
  setBusy(true);
  try {
    const entry = await api.post<TimeEntry>('/timer/start/', input);
    applyRunningTimer(entry);
    invalidate(...TIMER_SCOPES);
    void refreshTotals();
    return entry;
  } finally {
    setBusy(false);
  }
}

export async function stopTimer(): Promise<TimeEntry | null> {
  if (!running()) return null;
  setBusy(true);
  try {
    const entry = await api.post<TimeEntry>('/timer/stop/');
    applyRunningTimer(null);
    invalidate(...TIMER_SCOPES);
    void refreshTotals();
    return entry;
  } finally {
    setBusy(false);
  }
}

export async function resumeTimer(entryId: ID): Promise<TimeEntry> {
  setBusy(true);
  try {
    const entry = await api.post<TimeEntry>(`/timer/entries/${entryId}/resume/`);
    applyRunningTimer(entry);
    invalidate(...TIMER_SCOPES);
    void refreshTotals();
    return entry;
  } finally {
    setBusy(false);
  }
}

export async function toggleTaskTimer(taskId: ID, extra: StartTimerInput = {}): Promise<void> {
  if (timerStore.isTrackingTask(taskId)) await stopTimer();
  else await startTimer({ ...extra, task_id: taskId });
}

export async function toggleTimer(input: StartTimerInput = {}): Promise<void> {
  if (running()) await stopTimer();
  else await startTimer(input);
}

export async function startSleep(): Promise<void> {
  setBusy(true);
  try {
    const session = await api.post<SleepSession>('/sleep/start/');
    applyRunningTimer(null);
    applySleep(session);
    invalidate(...TIMER_SCOPES, 'sleep');
  } finally {
    setBusy(false);
  }
}

export async function stopSleep(): Promise<void> {
  setBusy(true);
  try {
    await api.post<SleepSession>('/sleep/stop/');
    applySleep(null);
    invalidate(...TIMER_SCOPES, 'sleep');
  } finally {
    setBusy(false);
  }
}

async function refreshTotals(): Promise<void> {
  try {
    const state = await api.get<TimerState>('/timer/');
    applyTotals(state);
  } catch {
    /* non-critical */
  }
}
