// MyTasker — where a new task goes: the Personal or Business list, or a project. Plus its kind of work
// (client / advertising). Shared by the one-line composer and the full Add task page.

import { Handshake, Megaphone } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { createEffect, For } from 'solid-js';
import { Select } from '~/components/ui/Input';
import { projectsApi } from '~/features/projects/api';
import type { TaskInput } from '~/features/tasks/api';
import { createQuery } from '~/hooks/createQuery';
import { t } from '~/i18n';
import { tx } from '~/stores/translations';
import type { ID, Project, TaskKind } from '~/types';
import { cx } from '~/utils/cx';
import styles from './TaskTarget.module.css';

export type TaskTarget = { kind: 'personal' | 'business'; projectId?: never } | { projectId: ID; kind?: never };

export interface TaskType {
  client: boolean;
  ad: boolean;
}

/** The open projects, in the board's order (same cached list the project dropdowns use). */
export function useOpenProjects() {
  const query = createQuery(
    () => 'projects:selector:open',
    () => projectsApi.list({ view: 'open', page_size: 200, ordering: 'name' }),
    { staleMs: 30_000 },
  );
  return (): Project[] => query.data()?.results ?? [];
}

/** What the target and type add to a create payload. Project tasks are business work. */
export function targetPayload(target: TaskTarget, type: TaskType): TaskInput {
  const kind: TaskKind = target.projectId !== undefined ? 'business' : target.kind;
  return {
    kind,
    ...(target.projectId !== undefined ? { project_id: target.projectId } : {}),
    is_client: type.client,
    is_ad: type.ad,
  };
}

function encode(target: TaskTarget): string {
  return target.projectId !== undefined ? `p${target.projectId}` : target.kind;
}

function decode(value: string): TaskTarget {
  if (value.startsWith('p')) return { projectId: Number(value.slice(1)) };
  return { kind: value === 'personal' ? 'personal' : 'business' };
}

/** Compact dropdown: Personal, Business, then every open project. */
export function TargetSelect(props: { value: TaskTarget; onChange: (target: TaskTarget) => void; class?: string }): JSX.Element {
  const projects = useOpenProjects();
  let select: HTMLSelectElement | undefined;
  // A <select> forgets its value when the options re-render (projects loaded); put it back.
  createEffect(() => {
    projects();
    const value = encode(props.value);
    if (select && select.value !== value) select.value = value;
  });
  return (
    <Select
      ref={(el) => (select = el)}
      class={props.class}
      sizeVariant="sm"
      value={encode(props.value)}
      onChange={(e) => props.onChange(decode(e.currentTarget.value))}
      aria-label={t('Where this task goes')}
      title={t('Where this task goes')}
    >
      <optgroup label={t('Lists')}>
        <option value="personal">{t('Personal')}</option>
        <option value="business">{t('Business')}</option>
      </optgroup>
      <optgroup label={t('Projects')}>
        <For each={projects()}>{(project) => <option value={`p${project.id}`}>{tx('project', project.id, 'name', project.name)}</option>}</For>
      </optgroup>
    </Select>
  );
}

/** Two small toggles: client work (white) and advertising work (violet). */
export function TypeToggles(props: { value: TaskType; onChange: (type: TaskType) => void; labels?: boolean }): JSX.Element {
  return (
    <span class={styles.types}>
      <button
        type="button"
        class={cx(styles.type, props.value.client && styles.clientOn)}
        aria-pressed={props.value.client}
        onClick={() => props.onChange({ ...props.value, client: !props.value.client })}
        title={t('Client task')}
        aria-label={t('Client task')}
      >
        <Handshake size={13} />
        {props.labels ? <span>{t('Client')}</span> : null}
      </button>
      <button
        type="button"
        class={cx(styles.type, props.value.ad && styles.adOn)}
        aria-pressed={props.value.ad}
        onClick={() => props.onChange({ ...props.value, ad: !props.value.ad })}
        title={t('Advertising task')}
        aria-label={t('Advertising task')}
      >
        <Megaphone size={13} />
        {props.labels ? <span>{t('Ad')}</span> : null}
      </button>
    </span>
  );
}
