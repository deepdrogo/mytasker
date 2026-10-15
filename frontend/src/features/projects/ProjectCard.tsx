import { A } from '@solidjs/router';
import { Clock, Star, Users } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { createSignal, Show } from 'solid-js';
import { Badge, Meta, PriorityMark, ProgressBar, VisibilityMark } from '~/components/shared/Indicators';
import { projectsApi } from '~/features/projects/api';
import { isImportant, toggledPriority } from '~/features/projects/groups';
import { t } from '~/i18n';
import { tx } from '~/stores/translations';
import { toast } from '~/stores/ui';
import type { Project, Role } from '~/types';
import { cx } from '~/utils/cx';
import { formatDate, formatDuration } from '~/utils/format';
import styles from './ProjectCard.module.css';

const STATUS_LABEL: Record<Project['status'], string> = {
  planned: 'Planned',
  active: 'Active',
  paused: 'Paused',
  completed: 'Completed',
  archived: 'Archived',
};

const ROLE_LABEL: Record<Role, string> = { owner: 'Owner', admin: 'Admin', member: 'Member', viewer: 'Viewer' };

export function ProjectCard(props: { project: Project }): JSX.Element {
  const p = () => props.project;
  const deadlineSoon = () => {
    if (!p().deadline) return false;
    const diff = (new Date(p().deadline as string).getTime() - Date.now()) / 86400000;
    return diff < 3;
  };
  const [busy, setBusy] = createSignal(false);
  const important = () => isImportant(p());
  /** The star sits inside the card link: it must not open the project. */
  const toggleImportant = async (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (busy()) return;
    setBusy(true);
    try {
      await projectsApi.update(p().id, { priority: toggledPriority(p()) });
    } catch {
      toast(t('Could not update the project.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <A href={`/projects/${p().id}/tasks`} class={styles.card}>
      <div class={styles.head}>
        <div class={styles.titleRow}>
          <Show when={p().capabilities.manage_project} fallback={<PriorityMark priority={p().priority} />}>
            <button
              type="button"
              class={cx(styles.star, important() && styles.starOn)}
              onClick={(event) => void toggleImportant(event)}
              disabled={busy()}
              aria-pressed={important()}
              aria-label={important() ? t('Move {name} to Not important', { name: p().name }) : t('Mark {name} important', { name: p().name })}
              title={important() ? t('Important - click to move to Not important') : t('Mark important')}
            >
              <Star size={14} />
            </button>
          </Show>
          <span class={styles.name}>{tx('project', p().id, 'name', p().name)}</span>
        </div>
        <div class={styles.badges}>
          <Show when={p().kind === 'active'}>
            <Badge variant="solid">{t('Active')}</Badge>
          </Show>
          <Show when={p().category === 'startup'}>
            <Badge variant="outline">{t('Startup')}</Badge>
          </Show>
          <Show when={p().mode !== 'private'}>
            <Badge variant="outline">{p().mode === 'group_plus' ? t('Group+') : t('Group')}</Badge>
          </Show>
          <Show when={p().status !== 'active'}>
            <Badge variant="dashed">{t(STATUS_LABEL[p().status])}</Badge>
          </Show>
        </div>
      </div>

      <Show when={p().description}>
        <p class={styles.description}>{tx('project', p().id, 'description', p().description)}</p>
      </Show>

      {/* Progress is only meaningful once there are tasks to measure; an empty project shows no bar or percentage. */}
      <Show when={p().task_total > 0}>
        <ProgressBar
          value={p().task_done}
          max={p().task_total}
          label={t('{done}/{total} tasks', { done: p().task_done, total: p().task_total })}
        />
      </Show>

      <div class={styles.footer}>
        <Show when={p().progress !== null} fallback={<Meta><span class="mt-dim">{t('No tasks yet')}</span></Meta>}>
          <Meta>
            <span class="mt-mono">{p().progress}%</span>
          </Meta>
        </Show>
        <Show when={p().open_tasks > 0}>
          <Meta>
            <span>{t('{count} open', { count: p().open_tasks })}</span>
          </Meta>
        </Show>
        <Show when={p().tracked_seconds > 0}>
          <Meta>
            <Clock size={11} />
            <span class="mt-mono">{formatDuration(p().tracked_seconds)}</span>
          </Meta>
        </Show>
        <Show when={p().member_count > 1}>
          <Meta>
            <Users size={11} />
            <span>{p().member_count}</span>
          </Meta>
        </Show>
        <Show when={p().deadline}>
          <Meta>
            <span class={deadlineSoon() ? styles.deadlineSoon : ''}>{t('Due {date}', { date: formatDate(p().deadline) })}</span>
          </Meta>
        </Show>
        <Show when={p().role && p().role !== 'owner'}>
          <Meta>
            <VisibilityMark visibility="group" mode={p().mode} />
            <span>{t(ROLE_LABEL[p().role as Role])}</span>
          </Meta>
        </Show>
      </div>
    </A>
  );
}
