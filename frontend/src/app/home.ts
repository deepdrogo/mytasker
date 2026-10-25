// MyTasker — where a signed-in person lands after login.
// Most users keep the classic dashboard. A user whose preference is `projects` (set per-account, e.g.
// the owner) instead lands on the Working projects catalog and gets a projects-focused navigation.
// Nothing is removed for anyone — every module stays reachable by URL and in the drawer.

import { authStore } from '~/stores/auth';

export const DASHBOARD_HOME = '/dashboard';
export const WORKING_PROJECTS_HOME = '/projects/working';

/** True when the current user has opted into the projects-first home experience. */
export function prefersProjectsHome(): boolean {
  return authStore.user()?.preferences?.home_view === 'projects';
}

/** The route a signed-in user should land on, honouring their per-account home preference. */
export function homeRoute(): string {
  return prefersProjectsHome() ? WORKING_PROJECTS_HOME : DASHBOARD_HOME;
}
