import { api } from '~/api/client';
import { invalidate } from '~/hooks/createQuery';
import type { GuestShareView, ID, ShareLink } from '~/types';

export interface ShareCreateInput {
  task_ids: ID[];
  title?: string;
  password?: string | null;
  expires_at?: string | null;
  ask_guest_name?: boolean;
  allow_complete?: boolean;
  allow_reopen?: boolean;
  one_time?: boolean;
  max_uses?: number | null;
}

export const sharesApi = {
  list: (params: { task?: ID; active?: boolean } = {}) => api.get<ShareLink[]>('/shares/', { params }),
  create: async (input: ShareCreateInput) => {
    const share = await api.post<ShareLink>('/shares/', input);
    invalidate('shares');
    return share;
  },
  update: async (id: ID, input: Partial<ShareCreateInput>) => {
    const share = await api.patch<ShareLink>(`/shares/${id}/`, input);
    invalidate('shares');
    return share;
  },
  revoke: async (id: ID) => {
    const share = await api.post<ShareLink>(`/shares/${id}/revoke/`);
    invalidate('shares');
    return share;
  },
  remove: async (id: ID) => {
    await api.delete(`/shares/${id}/`);
    invalidate('shares');
  },
};

const SESSION_PREFIX = 'mt.share.';

function sessionToken(token: string): string | null {
  try {
    return window.localStorage.getItem(SESSION_PREFIX + token);
  } catch {
    return null;
  }
}

function storeSession(token: string, session: string): void {
  try {
    window.localStorage.setItem(SESSION_PREFIX + token, session);
  } catch {
    /* private mode */
  }
}

function headers(token: string): Record<string, string> {
  const session = sessionToken(token);
  return session ? { 'X-Share-Session': session } : {};
}

type GuestResponse = GuestShareView & { session_token?: string };

function absorb(token: string, data: GuestResponse): GuestShareView {
  if (data.session_token) storeSession(token, data.session_token);
  return data;
}

/** Anonymous guest API for /s/:token. Session is a header, never a cookie, so it cannot collide with the app login. */
export const guestApi = {
  view: async (token: string) => absorb(token, await api.get<GuestResponse>(`/share/${token}/`, { headers: headers(token) })),
  unlock: async (token: string, password: string) =>
    absorb(token, await api.post<GuestResponse>(`/share/${token}/unlock/`, { password }, { headers: headers(token) })),
  identify: async (token: string, name: string) =>
    absorb(token, await api.post<GuestResponse>(`/share/${token}/identify/`, { name }, { headers: headers(token) })),
  complete: async (token: string, taskId: ID) =>
    absorb(token, await api.post<GuestResponse>(`/share/${token}/tasks/${taskId}/complete/`, {}, { headers: headers(token) })),
  reopen: async (token: string, taskId: ID) =>
    absorb(token, await api.post<GuestResponse>(`/share/${token}/tasks/${taskId}/reopen/`, {}, { headers: headers(token) })),
};
