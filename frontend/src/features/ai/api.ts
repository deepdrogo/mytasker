import { api } from '~/api/client';
import { invalidate } from '~/hooks/createQuery';
import type { AIAction, AICommandResult, ID } from '~/types';

export interface ImproveTaskResult {
  title: string;
  description: string;
  priority?: string | null;
  estimated_minutes?: number | null;
  suggested_subtasks?: string[];
}

export interface BreakdownResult {
  subtasks: Array<{ title: string; estimated_minutes?: number | null }>;
  note?: string;
}

export interface PlanBlock {
  label: string;
  start: string;
  end: string;
  task_ids: ID[];
  reason?: string;
}

export interface PlanDayResult {
  summary: string;
  blocks: PlanBlock[];
  defer?: Array<{ task_id: ID; reason: string }>;
  top_three: ID[];
}

export interface ImprovePromptResult {
  title?: string;
  body: string;
  changes: string[];
}

export interface ImproveIdeaResult {
  title: string;
  improved_text: string;
  first_tasks: string[];
  risks?: string[];
}

export interface PolishedTask {
  id: ID;
  title: string;
  previous_title: string;
  description: string;
  previous_description: string;
}

export interface PolishTasksResult {
  updated: PolishedTask[];
  unchanged: ID[];
  skipped: ID[];
}

export type ChatTurn = { role: 'user' | 'assistant'; content: string };

const AI_SCOPES = ['tasks', 'today', 'projects', 'prompts', 'routines', 'ai', 'timer'];

export const aiApi = {
  status: () => api.get<{ configured: boolean }>('/ai/status/'),
  command: async (text: string, history: ChatTurn[] = []) => {
    const result = await api.post<AICommandResult>('/ai/command/', { text, history });
    if (result.changed) invalidate(...AI_SCOPES);
    return result;
  },
  confirm: async (actionId: ID) => {
    const result = await api.post<{ action_id: ID; status: string; reply: string }>(`/ai/actions/${actionId}/confirm/`);
    invalidate(...AI_SCOPES);
    return result;
  },
  reject: (actionId: ID) => api.post<AIAction>(`/ai/actions/${actionId}/reject/`),
  history: () => api.get<AIAction[]>('/ai/actions/'),

  improveTask: (taskId: ID) => api.post<ImproveTaskResult>(`/ai/tasks/${taskId}/improve/`),
  /** Rewrites the titles of the given tasks and applies them server-side; returns what changed for undo. */
  polishTasks: async (taskIds: ID[]) => {
    const result = await api.post<PolishTasksResult>('/ai/tasks/polish/', { task_ids: taskIds });
    if (result.updated.length) invalidate('tasks', 'today', 'projects', 'search');
    return result;
  },
  breakDown: (taskId: ID) => api.post<BreakdownResult>(`/ai/tasks/${taskId}/breakdown/`),
  applyBreakdown: async (taskId: ID, subtasks: BreakdownResult['subtasks']) => {
    const result = await api.post<{ created: Array<{ id: ID; title: string }> }>(`/ai/tasks/${taskId}/breakdown/apply/`, {
      subtasks,
    });
    invalidate('tasks', 'today');
    return result;
  },
  planDay: () => api.post<PlanDayResult>('/ai/plan-day/'),
  improvePrompt: (promptId: ID, goal = '') => api.post<ImprovePromptResult>(`/ai/prompts/${promptId}/improve/`, { goal }),
  improveIdea: (ideaId: ID) => api.post<ImproveIdeaResult>(`/ai/ideas/${ideaId}/improve/`),
};
