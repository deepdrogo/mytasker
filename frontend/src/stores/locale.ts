// MyTasker — keeps the UI language in sync between this browser and the account.
// Built by drogoz · https://github.com/deepdrogo/mytasker

import { api } from '~/api/client';
import { hasExplicitLocale, isLocale, locale, setLocale, type Locale } from '~/i18n';
import { applyMe, authStore } from '~/stores/auth';
import type { Me } from '~/types';

/**
 * Called whenever `me` arrives from the server. An explicit choice made in this browser wins and is
 * pushed to the account; otherwise the account's saved language is applied.
 */
export function syncLocaleWithAccount(me: Me): void {
  if (hasExplicitLocale()) {
    if (isLocale(me.locale) && me.locale !== locale()) void persistLocale(locale());
    return;
  }
  if (isLocale(me.locale)) setLocale(me.locale, { persist: false });
}

export async function changeLocale(next: Locale): Promise<void> {
  setLocale(next);
  if (authStore.isAuthenticated()) await persistLocale(next);
}

async function persistLocale(next: Locale): Promise<void> {
  try {
    applyMe(await api.patch<Me>('/auth/me/', { locale: next }));
  } catch {
    /* the local choice still applies; the account is updated next time */
  }
}
