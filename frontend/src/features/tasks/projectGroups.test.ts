import { describe, expect, it } from 'vitest';
import type { Task } from '~/types';
import { groupByProject } from './projectGroups';

function task(id: number, extra: Partial<Task> = {}): Task {
  return { id, kind: 'business', is_client: false, project: null, ...extra } as Task;
}

const site = { id: 7, name: 'Site' };
const app = { id: 9, name: 'App' };

describe('tasks grouped by theme', () => {
  it('lists projects in first-seen order, then clients, business, personal', () => {
    const groups = groupByProject([
      task(1, { kind: 'personal' }),
      task(2, { project: app } as Partial<Task>),
      task(3, { is_client: true }),
      task(4, { project: site } as Partial<Task>),
      task(5),
      task(6, { project: app } as Partial<Task>),
    ]);
    expect(groups.map((group) => group.key)).toEqual(['p9', 'p7', 'client', 'business', 'personal']);
    expect(groups[0]!.tasks.map((row) => row.id)).toEqual([2, 6]);
    expect(groups[0]!.name).toBe('App');
  });

  it('keeps a client task that belongs to a project inside that project', () => {
    const groups = groupByProject([task(1, { is_client: true, project: site } as Partial<Task>)]);
    expect(groups.map((group) => group.key)).toEqual(['p7']);
  });

  it('puts loose advertising work in its own group right after clients', () => {
    const groups = groupByProject([
      task(1),
      task(2, { is_ad: true }),
      task(3, { is_client: true }),
      task(4, { is_ad: true, project: site } as Partial<Task>),
    ]);
    expect(groups.map((group) => group.key)).toEqual(['p7', 'client', 'ad', 'business']);
  });

  it('returns nothing for an empty list', () => {
    expect(groupByProject([])).toEqual([]);
  });
});
