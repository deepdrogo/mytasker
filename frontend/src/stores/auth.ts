// MyTasker — session store.
// Built by drogoz · https://github.com/deepdrogo/mytasker

import { createSignal } from 'solid-js';
import { api, ApiError, ensureCsrf, onUnauthorized } from '~/api/client';
import { clearCache } from '~/hooks/createQuery';
import type { Me, PublicConfig } from '~/types';

const [user, setUser] = createSignal<Me | null>(null);
const [config, setConfig] = createSignal<PublicConfig | null>(null);
const [ready, setReady] = createSignal(false);

export const authStore = {
  user,
  config,
  ready,
  isAuthenticated: () => user() !== null,
  isAdmin: () => user()?.is_staff === true,
  /**
   * Single source of truth for showing any AI affordance. AI is an administrators-only feature;
   * the backend computes `me.ai_enabled` = provider configured AND user is staff.
   */
  aiEnabled: () => user()?.ai_enabled === true,
  /** Provider configured on the server, regardless of who is asking (for explanatory copy only). */
  aiConfigured: () => config()?.ai_enabled === true,
};

export async function bootstrapAuth(): Promise<void> {
  const [me, cfg] = await Promise.allSettled([api.get<Me>('/auth/me/'), api.get<PublicConfig>('/auth/config/')]);
  if (me.status === 'fulfilled') setUser(me.value);
  else setUser(null);
  if (cfg.status === 'fulfilled') setConfig(cfg.value);
  setReady(true);
}

export async function login(email: string, password: string): Promise<Me> {
  await ensureCsrf();
  const me = await api.post<Me>('/auth/login/', { email, password });
  clearCache();
  setUser(me);
  return me;
}

export async function register(input: {
  email: string;
  password: string;
  full_name?: string;
  timezone?: string;
}): Promise<Me> {
  await ensureCsrf();
  const me = await api.post<Me>('/auth/register/', input);
  clearCache();
  setUser(me);
  return me;
}

export async function logout(): Promise<void> {
  try {
    await api.post('/auth/logout/');
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
  }
  setUser(null);
  clearCache();
}

export async function refreshMe(): Promise<void> {
  try {
    setUser(await api.get<Me>('/auth/me/'));
  } catch {
    setUser(null);
  }
}

export function applyMe(me: Me): void {
  setUser(me);
}

export function guessTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

onUnauthorized(() => {
  if (user() !== null) {
    setUser(null);
    clearCache();
  }
});
