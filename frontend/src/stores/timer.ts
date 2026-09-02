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

const [running, setRunning] = createSignal<TimeEntry | null>(null);
const [sleep, setSleep] = createSignal<SleepSession | null>(null);
const [todayTotals, setTodayTotals] = createSignal<TimerState['today']>({ business: 0, personal: 0, total: 0 });
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
    const base = todayTotals().business;
    const entry = running();
    return entry && entry.category === 'business' ? base + elapsedFrom(entry.started_at) - entry.duration_seconds : base;
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
    setTodayTotals(state.today);
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
    setTodayTotals(state.today);
  } catch {
    /* non-critical */
  }
}
