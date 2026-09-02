import { api, buildQuery, type Paginated, type QueryParams } from '~/api/client';
import { invalidate } from '~/hooks/createQuery';
import type { ID, Prompt, PromptListItem, PromptVersion, Visibility } from '~/types';

export interface PromptListParams extends QueryParams {
  q?: string;
  category?: string;
  tag?: string;
  project?: ID;
  has_project?: boolean;
  favorite?: boolean;
  archived?: boolean;
  owned?: boolean;
  ordering?: string;
  page?: number;
  page_size?: number;
}

export interface PromptInput {
  title?: string;
  body?: string;
  description?: string;
  category?: string;
  tags?: string[];
  project_id?: ID | null;
  visibility?: Visibility | null;
  is_favorite?: boolean;
  is_archived?: boolean;
  version?: number;
}

export interface PromptFacets {
  categories: Array<{ category: string; count: number }>;
  tags: Array<{ name: string; slug: string; count: number }>;
}

export interface PromptVersionDetail extends PromptVersion {
  body: string;
  description: string;
}

const SCOPES = ['prompts', 'projects', 'search'];

export const promptsApi = {
  list: (params: PromptListParams) => api.get<Paginated<PromptListItem>>('/prompts/', { params }),
  get: (id: ID) => api.get<Prompt>(`/prompts/${id}/`),
  facets: () => api.get<PromptFacets>('/prompts/facets/'),
  versions: (id: ID) => api.get<PromptVersion[]>(`/prompts/${id}/versions/`),
  version: (id: ID, number: number) => api.get<PromptVersionDetail>(`/prompts/${id}/versions/${number}/`),

  create: async (input: PromptInput) => {
    const prompt = await api.post<Prompt>('/prompts/', input);
    invalidate(...SCOPES);
    return prompt;
  },
  update: async (id: ID, input: PromptInput) => {
    const prompt = await api.patch<Prompt>(`/prompts/${id}/`, input);
    invalidate(...SCOPES);
    return prompt;
  },
  remove: async (id: ID) => {
    await api.delete(`/prompts/${id}/`);
    invalidate(...SCOPES);
  },
  duplicate: async (id: ID) => {
    const prompt = await api.post<Prompt>(`/prompts/${id}/duplicate/`);
    invalidate(...SCOPES);
    return prompt;
  },
  toggleFavorite: async (id: ID) => {
    const prompt = await api.post<Prompt>(`/prompts/${id}/favorite/`);
    invalidate('prompts');
    return prompt;
  },
  toggleArchive: async (id: ID) => {
    const prompt = await api.post<Prompt>(`/prompts/${id}/archive/`);
    invalidate('prompts');
    return prompt;
  },
  restore: async (id: ID, number: number) => {
    const prompt = await api.post<Prompt>(`/prompts/${id}/versions/${number}/`);
    invalidate(...SCOPES);
    return prompt;
  },
};

export function promptListKey(name: string, params: PromptListParams): string {
  return `prompts:${name}${buildQuery(params)}`;
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  }
}
