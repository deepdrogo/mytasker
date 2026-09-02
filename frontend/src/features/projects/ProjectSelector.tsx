import type { JSX } from 'solid-js';
import { For, Show } from 'solid-js';
import { Select } from '~/components/ui/Input';
import { projectsApi } from '~/features/projects/api';
import { createQuery } from '~/hooks/createQuery';
import type { ID, Project } from '~/types';

interface ProjectSelectorProps {
  value: ID | null;
  onChange: (value: ID | null) => void;
  disabled?: boolean;
  /** Include archived projects (default: open only). */
  includeArchived?: boolean;
}

/** Project dropdown backed by the cached open-projects list. "No project" maps to null. */
export function ProjectSelector(props: ProjectSelectorProps): JSX.Element {
  const query = createQuery(
    () => `projects:selector:${props.includeArchived ? 'all' : 'open'}`,
    () => projectsApi.list({ view: props.includeArchived ? undefined : 'open', page_size: 200, ordering: 'name' }),
    { staleMs: 30_000 },
  );
  const projects = (): Project[] => query.data()?.results ?? [];
  // Keep the current project selectable even when it is not in the fetched list (e.g. archived).
  const missingCurrent = () => props.value !== null && !projects().some((p) => p.id === props.value);

  return (
    <Select
      value={props.value === null ? '' : String(props.value)}
      disabled={props.disabled}
      onChange={(e) => {
        const raw = e.currentTarget.value;
        props.onChange(raw ? Number(raw) : null);
      }}
    >
      <option value="">No project</option>
      <Show when={missingCurrent()}>
        <option value={String(props.value)}>Current project</option>
      </Show>
      <For each={projects()}>{(p) => <option value={String(p.id)}>{p.name}</option>}</For>
    </Select>
  );
}
