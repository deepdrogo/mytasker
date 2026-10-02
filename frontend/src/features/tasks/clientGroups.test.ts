import { describe, expect, it } from 'vitest';
import type { Task, UserRef } from '~/types';
import { handedTo, splitByPerson } from './clientGroups';

const me: UserRef = { id: 1, display_name: 'Drogoz' };
const technocrat: UserRef = { id: 21, display_name: 'Technocrat' };
const alina: UserRef = { id: 22, display_name: 'alina' };

function task(id: number, assignees: UserRef[], extra: Partial<Task> = {}): Task {
  return { id, owner: me, assignee: assignees[0] ?? null, assignees, is_overdue: false, ...extra } as Task;
}

describe('client work by person', () => {
  it('keeps unassigned work and work assigned to the owner as mine', () => {
    const { mine, people } = splitByPerson([task(1, []), task(2, [me])]);
    expect(mine.map((row) => row.id)).toEqual([1, 2]);
    expect(people).toEqual([]);
  });

  it('puts a task handed to two people in both groups, busiest person first', () => {
    const { mine, people } = splitByPerson([
      task(1, [technocrat]),
      task(2, [alina, technocrat], { is_overdue: true }),
      task(3, []),
    ]);
    expect(mine.map((row) => row.id)).toEqual([3]);
    expect(people.map((group) => group.person.display_name)).toEqual(['Technocrat', 'alina']);
    expect(people[0]!.tasks.map((row) => row.id)).toEqual([1, 2]);
    expect(people[0]!.overdue).toBe(1);
    expect(people[1]!.tasks.map((row) => row.id)).toEqual([2]);
  });

  it('orders people with the same load by name and falls back to the single assignee', () => {
    const old = { ...task(4, []), assignee: technocrat, assignees: [] } as Task;
    expect(handedTo(old)).toEqual([technocrat]);
    const { people } = splitByPerson([task(1, [technocrat]), task(2, [alina])]);
    expect(people.map((group) => group.person.display_name)).toEqual(['alina', 'Technocrat']);
  });
});
