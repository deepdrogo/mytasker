import { api, buildQuery, type Paginated, type QueryParams } from '~/api/client';
import { invalidate } from '~/hooks/createQuery';
import type {
  ID,
  Idea,
  Priority,
  Project,
  ProjectCategory,
  ProjectKind,
  ProjectMember,
  ProjectMode,
  ProjectStatus,
  Role,
  Task,
} from '~/types';

export interface ProjectListParams extends QueryParams {
  kind?: ProjectKind;
  category?: ProjectCategory;
  mode?: ProjectMode;
  status?: string;
  view?: 'active' | 'open' | 'archived' | 'team';
  q?: string;
  owned?: boolean;
  ordering?: string;
  page?: number;
  page_size?: number;
}

export interface ProjectInput {
  name?: string;
  description?: string;
  kind?: ProjectKind;
  category?: ProjectCategory;
  mode?: ProjectMode;
  status?: ProjectStatus;
  priority?: Priority;
  /** Active (working on it) vs inactive — drives the Working projects page. */
  is_working?: boolean;
  start_date?: string | null;
  deadline?: string | null;
  notes?: string;
  sort_order?: number;
  version?: number;
}

export interface ProjectOverview {
  stats: { total: number; done: number; overdue: number; in_progress: number };
  tracked_seconds: number;
  time_by_member: Array<{ user_id: ID; display_name: string; seconds: number }>;
  upcoming: Task[];
}

export interface IdeaInput {
  title?: string;
  raw_text?: string;
  improved_text?: string;
  notes?: string;
  category?: string;
  priority?: Priority;
}

const SCOPES = ['projects', 'today', 'tasks', 'search'];

export const projectsApi = {
  list: (params: ProjectListParams) => api.get<Paginated<Project>>('/projects/', { params }),
  get: (id: ID) => api.get<Project>(`/projects/${id}/`),
  overview: (id: ID) => api.get<ProjectOverview>(`/projects/${id}/overview/`),
  members: (id: ID) => api.get<ProjectMember[]>(`/projects/${id}/members/`),

  create: async (input: ProjectInput) => {
    const project = await api.post<Project>('/projects/', input);
    invalidate(...SCOPES);
    return project;
  },
  update: async (id: ID, input: ProjectInput) => {
    const project = await api.patch<Project>(`/projects/${id}/`, input);
    invalidate(...SCOPES);
    return project;
  },
  /** Drop the hand-made order; the calendar and the dashboard list projects by start date again. */
  followCalendar: async () => {
    await api.post('/projects/follow-calendar/', {});
    invalidate('projects');
  },
  /** Hand-made order of the rows a page shows, first on top; projects not sent keep their place. */
  reorder: async (ids: ID[]) => {
    const result = await api.post<{ ids: ID[] }>('/projects/reorder/', { ids });
    // The dashboard keeps its own optimistic copy; only the project lists need to refetch.
    invalidate('projects');
    return result.ids;
  },
  /** Toggle whether the owner is actively working on this project (Working projects catalog). */
  setWorking: async (id: ID, working: boolean) => {
    const project = await api.post<Project>(`/projects/${id}/working/`, { working });
    invalidate('projects', 'today');
    return project;
  },
  changeMode: async (id: ID, mode: ProjectMode) => {
    const project = await api.post<Project>(`/projects/${id}/mode/`, { mode });
    invalidate(...SCOPES, 'prompts');
    return project;
  },
  remove: async (id: ID) => {
    await api.delete(`/projects/${id}/`);
    invalidate(...SCOPES, 'prompts');
  },
  invite: async (id: ID, email: string, role: Role) => {
    const membership = await api.post<ProjectMember & { invite_url: string }>(`/projects/${id}/members/`, { email, role });
    invalidate('projects');
    return membership;
  },
  changeRole: async (id: ID, membershipId: ID, role: Role) => {
    const membership = await api.patch<ProjectMember>(`/projects/${id}/members/${membershipId}/`, { role });
    invalidate('projects');
    return membership;
  },
  removeMember: async (id: ID, membershipId: ID) => {
    await api.delete(`/projects/${id}/members/${membershipId}/`);
    invalidate('projects');
  },
  leave: async (id: ID) => {
    await api.post(`/projects/${id}/leave/`);
    invalidate(...SCOPES);
  },
  join: async (token: string) => {
    const project = await api.post<Project>('/projects/join/', { token });
    invalidate(...SCOPES);
    return project;
  },
};

export const ideasApi = {
  list: (params: QueryParams = {}) => api.get<Paginated<Idea>>('/ideas/', { params }),
  create: async (input: IdeaInput) => {
    const idea = await api.post<Idea>('/ideas/', input);
    invalidate('ideas', 'search');
    return idea;
  },
  update: async (id: ID, input: IdeaInput) => {
    const idea = await api.patch<Idea>(`/ideas/${id}/`, input);
    invalidate('ideas', 'search');
    return idea;
  },
  remove: async (id: ID) => {
    await api.delete(`/ideas/${id}/`);
    invalidate('ideas', 'search');
  },
  convert: async (id: ID, kind: ProjectKind = 'project') => {
    const project = await api.post<Project>(`/ideas/${id}/convert/`, { kind });
    invalidate('ideas', ...SCOPES);
    return project;
  },
};

export function projectListKey(name: string, params: ProjectListParams): string {
  return `projects:${name}${buildQuery(params)}`;
}
