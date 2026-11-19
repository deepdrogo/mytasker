// MyTasker — cut a project list into the Working-board groups, so All reads exactly like the Dashboard.

import type { WorkGroup } from '~/features/projects/api';
import type { ID, Project, WorkState } from '~/types';

export interface WorkShelf {
  /** `g<id>` for a named group, `none` for projects without one. */
  key: string;
  groupId: ID | null;
  name: string;
  projects: Project[];
}

const STATE_RANK: Record<WorkState, number> = { working: 0, active: 1, waiting: 2 };
const FINISHED = new Set<Project['status']>(['completed', 'archived']);

/**
 * Groups in the board's order, then "No group". Inside each: green (working) first, then blue, then yellow -
 * as the board's lit shelf - and finished projects last. The incoming sort decides ties, so the chosen sort
 * still holds inside every colour. Empty groups are left out.
 */
export function shelveByWorkGroup(projects: Project[], groups: WorkGroup[]): WorkShelf[] {
  const position = new Map(projects.map((project, index) => [project.id, index]));
  const rank = (project: Project) => (FINISHED.has(project.status) ? 3 : STATE_RANK[project.work_state]);
  const ordered = [...projects].sort((a, b) => rank(a) - rank(b) || position.get(a.id)! - position.get(b.id)!);
  const known = new Set(groups.map((group) => group.id));
  const shelves: WorkShelf[] = [...groups]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((group) => ({
      key: `g${group.id}`,
      groupId: group.id,
      name: group.name,
      projects: ordered.filter((project) => project.work_group_id === group.id),
    }));
  shelves.push({
    key: 'none',
    groupId: null,
    name: '',
    projects: ordered.filter((project) => project.work_group_id == null || !known.has(project.work_group_id)),
  });
  return shelves.filter((shelf) => shelf.projects.length > 0);
}
