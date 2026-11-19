import { describe, expect, it } from 'vitest';
import type { Project } from '~/types';
import { shelveByWorkGroup } from './workGroups';

function project(id: number, extra: Partial<Project> = {}): Project {
  return { id, name: `P${id}`, status: 'active', work_state: 'waiting', work_group_id: null, ...extra } as Project;
}

const groups = [
  { id: 2, name: 'Crypto', sort_order: 2 },
  { id: 1, name: 'Clients', sort_order: 1 },
  { id: 3, name: 'Empty', sort_order: 3 },
];

describe('All projects shelved like the Working board', () => {
  it('follows the board group order, then No group, and skips empty groups', () => {
    const shelves = shelveByWorkGroup(
      [project(1, { work_group_id: 2 }), project(2), project(3, { work_group_id: 1 })],
      groups,
    );
    expect(shelves.map((shelf) => shelf.key)).toEqual(['g1', 'g2', 'none']);
  });

  it('puts green, then blue, then yellow, then finished - keeping the sort inside each colour', () => {
    const [shelf] = shelveByWorkGroup(
      [
        project(1, { status: 'completed', work_state: 'working' }),
        project(2),
        project(3, { work_state: 'active' }),
        project(4, { work_state: 'working' }),
        project(5),
        project(6, { work_state: 'working' }),
      ],
      [],
    );
    expect(shelf!.projects.map((p) => p.id)).toEqual([4, 6, 3, 2, 5, 1]);
  });

  it('treats a project in a deleted group as ungrouped', () => {
    const shelves = shelveByWorkGroup([project(1, { work_group_id: 99 })], groups);
    expect(shelves.map((shelf) => shelf.key)).toEqual(['none']);
  });
});
