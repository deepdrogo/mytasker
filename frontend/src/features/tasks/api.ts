import { api, type Paginated, type QueryParams } from '~/api/client';
import { invalidate } from '~/hooks/createQuery';
import { noteLocalChange } from '~/stores/localChanges';
import type { ID, Priority, RecurrenceRule, Task, TaskKind, TaskOrigin, Visibility } from '~/types';

export interface TaskListParams extends QueryParams {
  kind?: TaskKind;
  exclude_kind?: TaskKind;
  origin?: TaskOrigin;
  view?: 'today' | 'tomorrow' | 'week' | 'upcoming' | 'overdue' | 'no_date' | 'completed';
  /** Inclusive dates for the task calendar. A start date through the due date matches every day inside. */
  span_from?: string;
  span_to?: string;
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
  /** Client work: `true` only client tasks (the Clients page), `false` everything else. */
  is_client?: boolean;
  /** `'0'` turns off the default "client work first" pinning. */
  pin_clients?: '0';
  /** Only tasks I own (People page: what I handed to one person). */
  mine?: boolean;
  /** Work handed to me by others: `true` only that, `false` keeps it out of my own lists. */
  delegated?: boolean;
  /** Work handed to me by one specific person. */
  delegated_by?: ID;
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
  /** Hand the task to these People (replaces the current set; `[]` takes it back). */
  assignee_ids?: ID[];
  start_at?: string | null;
  due_at?: string | null;
  due_has_time?: boolean;
  reminder_at?: string | null;
  estimated_minutes?: number | null;
  is_ongoing?: boolean;
  is_client?: boolean;
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
  crypto: number;
  clients: number;
  today: number;
  overdue: number;
  upcoming: number;
}

/** Where a task should live next: one of the three lists, or a project. */
export type MoveDestination = { kind: TaskKind; project_id?: never } | { project_id: ID; kind?: never };

export interface BulkMoveResult {
  moved: ID[];
  skipped: ID[];
}

/** Namespaces to invalidate after any task mutation. */
const TASK_SCOPES = ['tasks', 'today', 'projects', 'analytics', 'activity', 'search', 'people'];

/** Refresh everything that shows tasks and remember the ids so the realtime echo is not refetched twice. */
function changed(...ids: Array<ID | null | undefined>): void {
  noteLocalChange('task', ...ids);
  invalidate(...TASK_SCOPES);
}

export const tasksApi = {
  list: (params: TaskListParams) => api.get<Paginated<Task>>('/tasks/', { params }),

  get: (id: ID) => api.get<Task>(`/tasks/${id}/`),

  counts: () => api.get<TaskCounts>('/tasks/counts/'),

  create: async (input: TaskInput): Promise<Task> => {
    const task = await api.post<Task>('/tasks/', input);
    changed(task.id);
    return task;
  },

  update: async (id: ID, input: TaskInput): Promise<Task> => {
    const task = await api.patch<Task>(`/tasks/${id}/`, input);
    changed(id);
    return task;
  },

  complete: async (id: ID): Promise<Task> => {
    const task = await api.post<Task>(`/tasks/${id}/complete/`);
    changed(id, ...(task.subtasks ?? []).map((sub) => sub.id));
    return task;
  },

  reopen: async (id: ID): Promise<Task> => {
    const task = await api.post<Task>(`/tasks/${id}/reopen/`);
    changed(id);
    return task;
  },

  /** Daily tick for a long-term task. `checked: false` removes today's tick. */
  checkin: async (id: ID, checked = true): Promise<Task> => {
    const task = await api.post<Task>(`/tasks/${id}/checkin/`, { checked });
    changed(id);
    return task;
  },

  /** "Skip today" on a long-term task: a deliberate miss that is counted and breaks the streak. */
  skipCheckin: async (id: ID): Promise<Task> => {
    const task = await api.post<Task>(`/tasks/${id}/checkin/`, { skipped: true });
    changed(id);
    return task;
  },

  duplicate: async (id: ID): Promise<Task> => {
    const task = await api.post<Task>(`/tasks/${id}/duplicate/`);
    changed(task.id);
    return task;
  },

  snooze: async (id: ID, minutes: number): Promise<Task> => {
    const task = await api.post<Task>(`/tasks/${id}/snooze/`, { minutes });
    changed(id);
    return task;
  },

  /**
   * Move a task to another list (`{ kind }`) or into a project (`{ project_id }`).
   * Subtasks travel with it and the client flag is kept.
   */
  move: async (id: ID, destination: MoveDestination): Promise<Task> => {
    const task = await api.post<Task>(`/tasks/${id}/move/`, destination);
    changed(id, ...(task.subtasks ?? []).map((sub) => sub.id));
    return task;
  },

  bulkMove: async (taskIds: ID[], destination: MoveDestination): Promise<BulkMoveResult> => {
    const result = await api.post<BulkMoveResult>('/tasks/bulk-move/', { task_ids: taskIds, ...destination });
    changed(...result.moved);
    return result;
  },

  /** Hand many tasks to the same People at once (`[]` takes them all back). */
  bulkAssign: async (taskIds: ID[], assigneeIds: ID[]): Promise<BulkRescheduleResult> => {
    const result = await api.post<BulkRescheduleResult>('/tasks/bulk-assign/', { task_ids: taskIds, assignee_ids: assigneeIds });
    changed(...result.updated);
    return result;
  },

  /** Same deadline for many tasks; `dueAt: null` clears it. */
  bulkReschedule: async (taskIds: ID[], dueAt: string | null, dueHasTime = false): Promise<BulkRescheduleResult> => {
    const result = await api.post<BulkRescheduleResult>('/tasks/bulk-reschedule/', {
      task_ids: taskIds,
      due_at: dueAt,
      due_has_time: dueHasTime,
    });
    changed(...result.updated);
    return result;
  },

  remove: async (id: ID): Promise<void> => {
    await api.delete(`/tasks/${id}/`);
    changed(id);
  },

  bulkComplete: async (taskIds: ID[]): Promise<BulkRescheduleResult> => {
    const result = await api.post<BulkRescheduleResult>('/tasks/bulk-complete/', { task_ids: taskIds });
    changed(...result.updated);
    return result;
  },

  bulkDelete: async (taskIds: ID[]): Promise<{ deleted: ID[]; skipped: ID[] }> => {
    const result = await api.post<{ deleted: ID[]; skipped: ID[] }>('/tasks/bulk-delete/', { task_ids: taskIds });
    changed(...result.deleted);
    return result;
  },

  subtasks: (id: ID) => api.get<Task[]>(`/tasks/${id}/subtasks/`),

  /** Persist the manual order for one top-level list or project column. */
  reorder: async (ids: ID[]): Promise<{ ids: ID[] }> => {
    const result = await api.post<{ ids: ID[] }>('/tasks/reorder/', { ids });
    invalidate('tasks');
    return result;
  },

  /** Persist a new subtask order (first id on top). Ordering is a preference — versions stay put. */
  reorderSubtasks: async (parentId: ID, ids: ID[]): Promise<{ ids: ID[] }> => {
    const result = await api.post<{ ids: ID[] }>(`/tasks/${parentId}/subtasks/reorder/`, { ids });
    changed(parentId);
    return result;
  },

  addSubtask: async (id: ID, input: TaskInput): Promise<Task> => {
    const task = await api.post<Task>(`/tasks/${id}/subtasks/`, input);
    changed(task.id, id);
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
