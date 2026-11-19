// MyTasker — the two dots a project carries everywhere (Dashboard, Working, All, Ads): the work state
// (yellow waiting → blue active → green working) and the violet advertising-candidate switch.

import type { JSX } from 'solid-js';
import { projectsApi } from '~/features/projects/api';
import { t } from '~/i18n';
import { tx } from '~/stores/translations';
import { toast } from '~/stores/ui';
import type { Project, WorkState } from '~/types';
import { cx } from '~/utils/cx';
import styles from './ProjectDots.module.css';

/** Tapping the dot walks the cycle: waiting (yellow) → active (blue) → working (green) → waiting. */
export const NEXT_STATE: Record<WorkState, WorkState> = { waiting: 'active', active: 'working', working: 'waiting' };
export const STATE_LABEL: Record<WorkState, string> = { working: 'Working', active: 'Active', waiting: 'Waiting' };
const STATE_TITLE: Record<WorkState, string> = {
  waiting: 'Waiting — click for Active',
  active: 'Active — click for Working',
  working: 'Working — click for Waiting',
};
const STATE_DOT: Record<WorkState, string> = { working: styles.working!, active: styles.active!, waiting: '' };

/** Persist a state change; returns false when the server refused it. Every view refetches through `projects`. */
export async function saveWorkState(project: Project, state: WorkState): Promise<boolean> {
  try {
    await projectsApi.setWorkState(project.id, state);
    return true;
  } catch {
    toast(t('Could not update the project.'));
    return false;
  }
}

export async function saveAd(project: Project, on: boolean): Promise<boolean> {
  try {
    await projectsApi.update(project.id, { is_ad: on });
    toast(on ? t('{name}: advertising candidate', { name: project.name }) : t('{name}: no longer an advertising candidate', { name: project.name }));
    return true;
  } catch {
    toast(t('Could not update the project.'));
    return false;
  }
}

/** Both dots sit inside links on some cards: a tap must never open the project. */
const stop = (event: MouseEvent) => {
  event.preventDefault();
  event.stopPropagation();
};

export function StateDot(props: { project: Project; onCycle: (next: WorkState) => void; class?: string }): JSX.Element {
  const name = () => tx('project', props.project.id, 'name', props.project.name);
  return (
    <button
      type="button"
      class={cx(styles.dot, STATE_DOT[props.project.work_state], props.class)}
      disabled={!props.project.capabilities.manage_project}
      onClick={(event) => {
        stop(event);
        props.onCycle(NEXT_STATE[props.project.work_state]);
      }}
      aria-label={t('{name}: {state}. Click to switch to {next}.', {
        name: name(),
        state: t(STATE_LABEL[props.project.work_state]),
        next: t(STATE_LABEL[NEXT_STATE[props.project.work_state]]),
      })}
      title={t(STATE_TITLE[props.project.work_state])}
    />
  );
}

export function AdDot(props: { project: Project; onToggle: (on: boolean) => void; class?: string }): JSX.Element {
  const on = () => props.project.is_ad;
  return (
    <button
      type="button"
      class={cx(styles.dot, styles.ad, on() && styles.adOn, props.class)}
      disabled={!props.project.capabilities.manage_project}
      onClick={(event) => {
        stop(event);
        props.onToggle(!on());
      }}
      aria-pressed={on()}
      aria-label={on() ? t('Advertising candidate - click to remove') : t('Mark as advertising candidate')}
      title={on() ? t('Advertising candidate - click to remove') : t('Mark as advertising candidate')}
    />
  );
}
