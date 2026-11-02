// MyTasker — where a signed-in person lands after login: always the Dashboard.
// A user whose preference is `projects` (set per-account, e.g. the owner) gets a projects-focused
// navigation; the Dashboard already carries the Working projects board, so it is home for them too.
// Nothing is removed for anyone — every module stays reachable by URL and in the drawer.

import { authStore } from '~/stores/auth';

export const DASHBOARD_HOME = '/dashboard';

/** True when the current user has opted into the projects-first navigation. */
export function prefersProjectsHome(): boolean {
  return authStore.user()?.preferences?.home_view === 'projects';
}

/** The route a signed-in user should land on. */
export function homeRoute(): string {
  return DASHBOARD_HOME;
}
