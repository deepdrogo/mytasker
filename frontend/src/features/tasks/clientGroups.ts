// MyTasker — Clients page grouping: the user's own client work, then one group per person it was handed to.
// Built by drogoz · https://github.com/deepdrogo/mytasker

import type { Task, UserRef } from '~/types';

export interface PersonGroup {
  person: UserRef;
  tasks: Task[];
  overdue: number;
}

/** People a task is handed to, never its owner. `assignees` wins; `assignee` covers older single hand-overs. */
export function handedTo(task: Task): UserRef[] {
  const list = task.assignees?.length ? task.assignees : task.assignee ? [task.assignee] : [];
  return list.filter((person) => person.id !== task.owner.id);
}

/**
 * Splits client work into what the user does themselves and what each person has.
 * A task handed to two people sits in both groups: each group answers "what does this person have".
 * People with the most work come first, then by name.
 */
export function splitByPerson(tasks: Task[]): { mine: Task[]; people: PersonGroup[] } {
  const mine: Task[] = [];
  const byPerson = new Map<number, PersonGroup>();
  for (const task of tasks) {
    const people = handedTo(task);
    if (people.length === 0) {
      mine.push(task);
      continue;
    }
    for (const person of people) {
      const group = byPerson.get(person.id) ?? { person, tasks: [], overdue: 0 };
      group.tasks.push(task);
      if (task.is_overdue) group.overdue += 1;
      byPerson.set(person.id, group);
    }
  }
  const people = [...byPerson.values()].sort(
    (a, b) => b.tasks.length - a.tasks.length || a.person.display_name.localeCompare(b.person.display_name),
  );
  return { mine, people };
}
