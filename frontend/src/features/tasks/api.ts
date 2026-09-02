import { api, type Paginated, type QueryParams } from '~/api/client';
import { invalidate } from '~/hooks/createQuery';
import type { ID, Priority, RecurrenceRule, Task, TaskKind, Visibility } from '~/types';

export interface TaskListParams extends QueryParams {
  kind?: TaskKind;
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
  q?: string;
  ordering?: string;
  page?: number;
  page_size?: number;
  include_subtasks?: '1';
}

export interface TaskInput {
  title?: string;
  kind?: TaskKind;
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
  tags?: string[];
  sort_order?: number;
  recurrence?: Omit<RecurrenceRule, 'id'> | null;
  version?: number;
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

  remove: async (id: ID): Promise<void> => {
    await api.delete(`/tasks/${id}/`);
    invalidate(...TASK_SCOPES);
  },

  subtasks: (id: ID) => api.get<Task[]>(`/tasks/${id}/subtasks/`),

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
