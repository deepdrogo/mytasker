import { api } from '~/api/client';
import { invalidate } from '~/hooks/createQuery';
import type { DailyCheckinHistory, DailyCheckinItem, ID, ISODate } from '~/types';

/** Which calendar line a tick is for: a project, or the Crypto world span. */
export type CheckinTarget = { project_id: ID; crypto?: never } | { crypto: true; project_id?: never };

export function targetOf(item: { subject: 'project' | 'crypto'; project_id?: ID | null; project?: { id: ID } | null }): CheckinTarget | null {
  if (item.subject === 'crypto') return { crypto: true };
  const id = item.project_id ?? item.project?.id;
  return id ? { project_id: id } : null;
}

export const checkinsApi = {
  daily: (date?: ISODate) => api.get<{ date: ISODate; items: DailyCheckinItem[] }>('/checkins/daily/', { params: { date } }),

  history: (days: number) => api.get<DailyCheckinHistory>('/checkins/history/', { params: { days } }),

  set: async (target: CheckinTarget, checked: boolean, date?: ISODate): Promise<DailyCheckinItem | null> => {
    const result = await api.post<{ item: DailyCheckinItem | null }>('/checkins/daily/', { ...target, checked, date });
    invalidate('today', 'checkins');
    return result.item;
  },
};
