import { api, type Paginated, type QueryParams } from '~/api/client';
import { invalidate } from '~/hooks/createQuery';
import type { ID, Priority, RecurrenceRule, Task, TaskKind, TaskOrigin, Visibility } from '~/types';

export interface TaskListParams extends QueryParams {
  kind?: TaskKind;
  exclude_kind?: TaskKind;
  origin?: TaskOrigin;
  view?: 'today' | 'tomorrow' | 'week' | 'upcoming' | 'overdue' | 'no_date' | 'completed';
  project?: ID;
  parent?: ID;
  top_level?: boolean;
  assignee?: ID;
  priority?: string;
  status?: string;
  tag?: string;
  completed?: boolean;
  overdue?: boolean;
  has_project?: boolean;
  /** Long-term work ticked daily: `true` only those, `false` everything else. */
  is_ongoing?: boolean;
  q?: string;
  ordering?: string;
  page?: number;
  page_size?: number;
  include_subtasks?: '1';
}

export interface TaskInput {
  title?: string;
  kind?: TaskKind;
  /** Create only. Defaults to `project` when a project is given, `list` otherwise. */
  origin?: TaskOrigin;
  description?: string;
  notes?: string;
  priority?: Priority;
  visibility?: Visibility;
  project_id?: ID | null;
  parent_id?: ID | null;
  assignee_id?: ID | null;
  start_at?: string | null;
  due_at?: string | null;
  due_has_time?: boolean;
  reminder_at?: string | null;
  estimated_minutes?: number | null;
  is_ongoing?: boolean;
  tags?: string[];
  sort_order?: number;
  recurrence?: Omit<RecurrenceRule, 'id'> | null;
  version?: number;
}

export interface BulkRescheduleResult {
  updated: ID[];
  skipped: ID[];
}

export interface TaskCounts {
  personal: number;
  business: number;
  today: number;
  overdue: number;
  upcoming: number;
}

/** Namespaces to invalidate after any task mutation. */
const TASK_SCOPES = ['tasks', 'today', 'projects', 'analytics', 'activity'];

export const tasksApi = {
  list: (params: TaskListParams) => api.get<Paginated<Task>>('/tasks/', { params }),

  get: (id: ID) => api.get<Task>(`/tasks/${id}/`),

  counts: () => api.get<TaskCounts>('/tasks/counts/'),

  create: async (input: TaskInput): Promise<Task> => {
    const task = await api.post<Task>('/tasks/', input);
    invalidate(...TASK_SCOPES);
    return task;
  },

  update: async (id: ID, input: TaskInput): Promise<Task> => {
    const task = await api.patch<Task>(`/tasks/${id}/`, input);
    invalidate(...TASK_SCOPES);
    return task;
  },

  complete: async (id: ID): Promise<Task> => {
    const task = await api.post<Task>(`/tasks/${id}/complete/`);
    invalidate(...TASK_SCOPES);
    return task;
  },

  reopen: async (id: ID): Promise<Task> => {
    const task = await api.post<Task>(`/tasks/${id}/reopen/`);
    invalidate(...TASK_SCOPES);
    return task;
  },

  /** Daily tick for a long-term task. `checked: false` removes today's tick. */
  checkin: async (id: ID, checked = true): Promise<Task> => {
    const task = await api.post<Task>(`/tasks/${id}/checkin/`, { checked });
    invalidate(...TASK_SCOPES);
    return task;
  },

  /** "Skip today" on a long-term task: a deliberate miss that is counted and breaks the streak. */
  skipCheckin: async (id: ID): Promise<Task> => {
    const task = await api.post<Task>(`/tasks/${id}/checkin/`, { skipped: true });
    invalidate(...TASK_SCOPES);
    return task;
  },

  duplicate: async (id: ID): Promise<Task> => {
    const task = await api.post<Task>(`/tasks/${id}/duplicate/`);
    invalidate(...TASK_SCOPES);
    return task;
  },

  snooze: async (id: ID, minutes: number): Promise<Task> => {
    const task = await api.post<Task>(`/tasks/${id}/snooze/`, { minutes });
    invalidate(...TASK_SCOPES);
    return task;
  },

  /** Same deadline for many tasks; `dueAt: null` clears it. */
  bulkReschedule: async (taskIds: ID[], dueAt: string | null, dueHasTime = false): Promise<BulkRescheduleResult> => {
    const result = await api.post<BulkRescheduleResult>('/tasks/bulk-reschedule/', {
      task_ids: taskIds,
      due_at: dueAt,
      due_has_time: dueHasTime,
    });
    invalidate(...TASK_SCOPES);
    return result;
  },

  remove: async (id: ID): Promise<void> => {
    await api.delete(`/tasks/${id}/`);
    invalidate(...TASK_SCOPES);
  },

  bulkComplete: async (taskIds: ID[]): Promise<BulkRescheduleResult> => {
    const result = await api.post<BulkRescheduleResult>('/tasks/bulk-complete/', { task_ids: taskIds });
    invalidate(...TASK_SCOPES);
    return result;
  },

  bulkDelete: async (taskIds: ID[]): Promise<{ deleted: ID[]; skipped: ID[] }> => {
    const result = await api.post<{ deleted: ID[]; skipped: ID[] }>('/tasks/bulk-delete/', { task_ids: taskIds });
    invalidate(...TASK_SCOPES);
    return result;
  },

  subtasks: (id: ID) => api.get<Task[]>(`/tasks/${id}/subtasks/`),

  /** Persist a new subtask order (first id on top). Ordering is a preference — versions stay put. */
  reorderSubtasks: async (parentId: ID, ids: ID[]): Promise<{ ids: ID[] }> => {
    const result = await api.post<{ ids: ID[] }>(`/tasks/${parentId}/subtasks/reorder/`, { ids });
    invalidate(...TASK_SCOPES);
    return result;
  },

  addSubtask: async (id: ID, input: TaskInput): Promise<Task> => {
    const task = await api.post<Task>(`/tasks/${id}/subtasks/`, input);
    invalidate(...TASK_SCOPES);
    return task;
  },
};

export function taskListKey(name: string, params: TaskListParams): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  return `tasks:${name}${parts ? `:${parts}` : ''}`;
}
