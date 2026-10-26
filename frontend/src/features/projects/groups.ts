import type { Priority, ProjectCategory } from '~/types';

/** Projects are shelved in three groups everywhere they are listed: Important, Not important, Startups. */
export type ProjectGroupKey = 'important' | 'normal' | 'startup';

export const GROUP_ORDER: ProjectGroupKey[] = ['important', 'normal', 'startup'];

export const GROUP_LABEL: Record<ProjectGroupKey, string> = {
  important: 'Important',
  normal: 'Not important',
  startup: 'Startups',
};

interface Groupable {
  priority: Priority;
  category: ProjectCategory;
}

export function isImportant(project: { priority: Priority }): boolean {
  return project.priority === 'high' || project.priority === 'critical';
}

/** `splitStartups: false` (the Startups page) files startups by importance like any other project. */
export function groupOf(project: Groupable, splitStartups = true): ProjectGroupKey {
  if (splitStartups && project.category === 'startup') return 'startup';
  return isImportant(project) ? 'important' : 'normal';
}

/** Non-empty groups in shelf order; each keeps the order the list arrived in. */
export function groupProjects<T extends Groupable>(
  projects: readonly T[],
  splitStartups = true,
): Array<{ key: ProjectGroupKey; items: T[] }> {
  const buckets = new Map<ProjectGroupKey, T[]>();
  for (const project of projects) {
    const key = groupOf(project, splitStartups);
    buckets.set(key, [...(buckets.get(key) ?? []), project]);
  }
  return GROUP_ORDER.filter((key) => buckets.has(key)).map((key) => ({ key, items: buckets.get(key) ?? [] }));
}

/** The priority a project gets when it is starred / unstarred. */
export function toggledPriority(project: { priority: Priority }): Priority {
  return isImportant(project) ? 'normal' : 'high';
}
