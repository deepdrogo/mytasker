import { A } from '@solidjs/router';
import { Clock, Users } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import { Badge, Meta, PriorityMark, ProgressBar, VisibilityMark } from '~/components/shared/Indicators';
import type { Project } from '~/types';
import { formatDate, formatDuration } from '~/utils/format';
import styles from './ProjectCard.module.css';

const STATUS_LABEL: Record<Project['status'], string> = {
  planned: 'Planned',
  active: 'Active',
  paused: 'Paused',
  completed: 'Completed',
  archived: 'Archived',
};

export function ProjectCard(props: { project: Project }): JSX.Element {
  const p = () => props.project;
  const deadlineSoon = () => {
    if (!p().deadline) return false;
    const diff = (new Date(p().deadline as string).getTime() - Date.now()) / 86400000;
    return diff < 3;
  };

  return (
    <A href={`/projects/${p().id}/overview`} class={styles.card}>
      <div class={styles.head}>
        <div class={styles.titleRow}>
          <PriorityMark priority={p().priority} />
          <span class={styles.name}>{p().name}</span>
        </div>
        <div class={styles.badges}>
          <Show when={p().kind === 'active'}>
            <Badge variant="solid">Active</Badge>
          </Show>
          <Show when={p().mode !== 'private'}>
            <Badge variant="outline">{p().mode === 'group_plus' ? 'Group+' : 'Group'}</Badge>
          </Show>
          <Show when={p().status !== 'active'}>
            <Badge variant="dashed">{STATUS_LABEL[p().status]}</Badge>
          </Show>
        </div>
      </div>

      <Show when={p().description}>
        <p class={styles.description}>{p().description}</p>
      </Show>

      <ProgressBar value={p().task_done} max={p().task_total} label={`${p().task_done}/${p().task_total} tasks`} />

      <div class={styles.footer}>
        <Meta>
          <span class="mt-mono">{p().progress}%</span>
        </Meta>
        <Show when={p().open_tasks > 0}>
          <Meta>
            <span>{p().open_tasks} open</span>
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
            <span class={deadlineSoon() ? styles.deadlineSoon : ''}>Due {formatDate(p().deadline)}</span>
          </Meta>
        </Show>
        <Show when={p().role && p().role !== 'owner'}>
          <Meta>
            <VisibilityMark visibility="group" mode={p().mode} />
            <span>{p().role}</span>
          </Meta>
        </Show>
      </div>
    </A>
  );
}
