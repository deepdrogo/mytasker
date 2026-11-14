// MyTasker — split a task list into themes: one group per project, then loose client / business / personal work.
// Built by drogoz · https://github.com/deepdrogo/mytasker

import type { ID, Task } from '~/types';

export type TaskGroupKind = 'project' | 'client' | 'business' | 'personal';

export interface TaskGroup {
  /** Stable key for keyed rendering: `p<id>` for projects, the kind otherwise. */
  key: string;
  kind: TaskGroupKind;
  projectId: ID | null;
  /** Raw project name (translate at render time); empty for the loose groups. */
  name: string;
  tasks: Task[];
}

const LOOSE_ORDER: TaskGroupKind[] = ['client', 'business', 'personal'];

function looseKind(task: Task): TaskGroupKind {
  if (task.is_client) return 'client';
  return task.kind === 'personal' ? 'personal' : 'business';
}

/**
 * Projects first, in the order their first task appears (the list is already sorted, so the group holding
 * the most pressing task leads); then tasks without a project: Clients, Business, Personal. Tasks keep the
 * list's order inside every group.
 */
export function groupByProject(tasks: Task[]): TaskGroup[] {
  const projects = new Map<ID, TaskGroup>();
  const loose = new Map<TaskGroupKind, TaskGroup>();
  for (const task of tasks) {
    if (task.project) {
      const id = task.project.id;
      const group = projects.get(id) ?? { key: `p${id}`, kind: 'project', projectId: id, name: task.project.name, tasks: [] };
      group.tasks.push(task);
      projects.set(id, group);
      continue;
    }
    const kind = looseKind(task);
    const group = loose.get(kind) ?? { key: kind, kind, projectId: null, name: '', tasks: [] };
    group.tasks.push(task);
    loose.set(kind, group);
  }
  const rest = LOOSE_ORDER.map((kind) => loose.get(kind)).filter((group): group is TaskGroup => Boolean(group));
  return [...projects.values(), ...rest];
}

export const LOOSE_LABEL: Record<Exclude<TaskGroupKind, 'project'>, string> = {
  client: 'Clients',
  business: 'Business',
  personal: 'Personal',
};
