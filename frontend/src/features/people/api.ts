import { api } from '~/api/client';
import { invalidate } from '~/hooks/createQuery';
import type { Delegator, ID, Person, UserRef } from '~/types';

export type PersonCandidate = UserRef & { email: string };

/** People: who an administrator hands work to, and who handed work to me. */
export const peopleApi = {
  list: () => api.get<Person[]>('/people/'),

  search: (q: string, signal?: AbortSignal) => api.get<PersonCandidate[]>('/people/search/', { params: { q }, signal }),

  add: async (input: { email?: string; user_id?: ID; note?: string }): Promise<Person> => {
    const person = await api.post<Person>('/people/', input);
    invalidate('people');
    return person;
  },

  update: async (id: ID, note: string): Promise<Person> => {
    const person = await api.patch<Person>(`/people/${id}/`, { note });
    invalidate('people');
    return person;
  },

  remove: async (id: ID): Promise<void> => {
    await api.delete(`/people/${id}/`);
    invalidate('people', 'tasks', 'today');
  },

  /** Who has handed work to me. Drives the "From <name>" pages; empty means no such page. */
  delegators: () => api.get<Delegator[]>('/people/delegators/'),
};
