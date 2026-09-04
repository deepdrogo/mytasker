import { api, type Paginated, type QueryParams } from '~/api/client';
import { invalidate } from '~/hooks/createQuery';
import type { ID, RoutineItem, RoutineKind, Rule, SleepSession, TimeEntry, TimeTotals } from '~/types';

export interface RoutineItemInput {
  name?: string;
  description?: string;
  target_minutes?: number;
  start_time?: string | null;
  end_time?: string | null;
  repeat_days?: number;
  order?: number;
  counts_as_business?: boolean;
  is_active?: boolean;
}

export interface RoutineListResponse {
  items: RoutineItem[];
  current_item_id: ID | null;
}

const SCOPES = ['routines', 'today'];

export const routinesApi = {
  items: (kind: RoutineKind, params: QueryParams = {}) =>
    api.get<RoutineListResponse>(`/routines/${kind}/items/`, { params }),
  create: async (kind: RoutineKind, input: RoutineItemInput) => {
    const item = await api.post<RoutineItem>(`/routines/${kind}/items/`, input);
    invalidate(...SCOPES);
    return item;
  },
  update: async (id: ID, input: RoutineItemInput) => {
    const item = await api.patch<RoutineItem>(`/routines/items/${id}/`, input);
    invalidate(...SCOPES);
    return item;
  },
  remove: async (id: ID) => {
    await api.delete(`/routines/items/${id}/`);
    invalidate(...SCOPES);
  },
  complete: async (id: ID, completed: boolean, manualMinutes?: number | null) => {
    const item = await api.post<RoutineItem>(`/routines/items/${id}/complete/`, {
      completed,
      manual_minutes: manualMinutes ?? undefined,
    });
    invalidate(...SCOPES, 'analytics');
    return item;
  },
  reorder: async (kind: RoutineKind, ids: ID[]) => {
    await api.post(`/routines/${kind}/reorder/`, { ids });
    invalidate('routines');
  },
};

export interface RuleInput {
  text?: string;
  description?: string;
  order?: number;
  is_enabled?: boolean;
}

export const rulesApi = {
  list: () => api.get<Rule[]>('/rules/'),
  create: async (input: RuleInput) => {
    const rule = await api.post<Rule>('/rules/', input);
    invalidate('rules');
    return rule;
  },
  update: async (id: ID, input: RuleInput) => {
    const rule = await api.patch<Rule>(`/rules/${id}/`, input);
    invalidate('rules');
    return rule;
  },
  remove: async (id: ID) => {
    await api.delete(`/rules/${id}/`);
    invalidate('rules');
  },
  reorder: async (ids: ID[]) => {
    await api.post('/rules/reorder/', { ids });
    invalidate('rules');
  },
  /** Daily self-check: `true` kept, `false` broken, `null` clears today's mark. */
  markKept: async (id: ID, kept: boolean | null) => {
    const rule = await api.post<Rule>(`/rules/${id}/kept/`, { kept });
    invalidate('rules', 'today');
    return rule;
  },
};

export type { TimeTotals } from '~/types';

export interface ManualEntryInput {
  started_at: string;
  ended_at: string;
  category?: 'business' | 'personal';
  task_id?: ID | null;
  project_id?: ID | null;
  routine_item_id?: ID | null;
  note?: string;
}

export const timeApi = {
  entries: (params: QueryParams = {}) => api.get<Paginated<TimeEntry>>('/timer/entries/', { params }),
  totals: (params: QueryParams = {}) => api.get<TimeTotals>('/timer/totals/', { params }),
  addManual: async (input: ManualEntryInput) => {
    const entry = await api.post<TimeEntry>('/timer/entries/', input);
    invalidate('timer', 'today', 'analytics', 'tasks', 'projects');
    return entry;
  },
  update: async (id: ID, input: Partial<ManualEntryInput>) => {
    const entry = await api.patch<TimeEntry>(`/timer/entries/${id}/`, input);
    invalidate('timer', 'today', 'analytics', 'tasks', 'projects');
    return entry;
  },
  remove: async (id: ID) => {
    await api.delete(`/timer/entries/${id}/`);
    invalidate('timer', 'today', 'analytics', 'tasks', 'projects');
  },
  sleepSessions: (params: QueryParams = {}) => api.get<Paginated<SleepSession>>('/sleep/', { params }),
  addSleep: async (input: { started_at: string; ended_at: string; note?: string }) => {
    const session = await api.post<SleepSession>('/sleep/', input);
    invalidate('sleep', 'today', 'analytics');
    return session;
  },
  removeSleep: async (id: ID) => {
    await api.delete(`/sleep/${id}/`);
    invalidate('sleep', 'today', 'analytics');
  },
};

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function weekdayEnabled(mask: number, index: number): boolean {
  return (mask & (1 << index)) !== 0;
}

export function toggleWeekday(mask: number, index: number): number {
  return mask ^ (1 << index);
}

export function describeRepeat(mask: number): string {
  if (mask === 127) return 'Every day';
  if (mask === 31) return 'Weekdays';
  if (mask === 96) return 'Weekends';
  return WEEKDAYS.filter((_, i) => weekdayEnabled(mask, i)).join(', ') || 'Never';
}
