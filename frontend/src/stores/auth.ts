// MyTasker — session store.
// Built by drogoz · https://github.com/deepdrogo/mytasker

import { createSignal } from 'solid-js';
import { api, ApiError, ensureCsrf, onUnauthorized } from '~/api/client';
import { clearCache } from '~/hooks/createQuery';
import { t } from '~/i18n';
import { toast } from '~/stores/ui';
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
  /**
   * Assistant accounts only add tasks for their principal. The backend refuses everything else;
   * the frontend mirrors that with a reduced navigation and route guard (see ASSISTANT_ROUTES).
   */
  isAssistant: () => user()?.is_assistant === true,
  principal: () => user()?.principal ?? null,
};

/** Route prefixes an assistant may open. Anything else redirects to /tasks/personal. */
export const ASSISTANT_ROUTES = ['/tasks', '/projects', '/settings', '/from'];

export function assistantMayOpen(pathname: string): boolean {
  if (pathname === '/projects/ideas' || pathname.startsWith('/projects/ideas/')) return false;
  return ASSISTANT_ROUTES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export async function bootstrapAuth(): Promise<void> {
  const [me, cfg] = await Promise.allSettled([api.get<Me>('/auth/me/'), api.get<PublicConfig>('/auth/config/')]);
  if (me.status === 'fulfilled') setUser(me.value);
  else setUser(null);
  if (cfg.status === 'fulfilled') setConfig(cfg.value);
  setReady(true);
  if (me.status === 'fulfilled') void syncTimezone(me.value);
}

export async function login(email: string, password: string): Promise<Me> {
  await ensureCsrf();
  const me = await api.post<Me>('/auth/login/', { email, password });
  clearCache();
  setUser(me);
  void syncTimezone(me);
  return me;
}

const TZ_PROMPT_KEY = 'mt_tz_prompted';

async function saveTimezone(zone: string): Promise<void> {
  setUser(await api.patch<Me>('/auth/me/', { timezone: zone }));
  // "Today", overdue and every dated list are cut by the profile timezone: refetch them all.
  clearCache();
}

/**
 * The server decides "today" and "overdue" in the profile timezone while this browser labels dates in its
 * own, so the two must agree. A profile still on the UTC default follows the browser silently; any other
 * mismatch (travel, a second device) is offered once per pair and never forced.
 */
async function syncTimezone(me: Me): Promise<void> {
  const browser = guessTimezone();
  if (!browser || browser === me.timezone) return;
  try {
    if (me.timezone === 'UTC') {
      await saveTimezone(browser);
      toast(t('Timezone set to {zone}', { zone: browser }));
      return;
    }
    const pair = `${me.timezone}>${browser}`;
    if (localStorage.getItem(TZ_PROMPT_KEY) === pair) return;
    localStorage.setItem(TZ_PROMPT_KEY, pair);
    toast(t('This device is on {zone}, your profile on {profile}.', { zone: browser, profile: me.timezone }), {
      ms: 15000,
      action: {
        label: t('Use {zone}', { zone: browser }),
        run: () => void saveTimezone(browser).then(() => toast(t('Timezone set to {zone}', { zone: browser }))),
      },
    });
  } catch {
    /* offline or storage blocked: keep the profile as it is */
  }
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
