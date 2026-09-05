import { api } from '~/api/client';
import type { DailyReview, DayMetrics, MonthlyReview, TodayData, WeeklyReview } from '~/types';

export const dashboardApi = {
  snapshot: () => api.get<TodayData>('/today/'),
};

export const analyticsApi = {
  daily: (date?: string) => api.get<DailyReview>('/analytics/daily/', { params: { date } }),
  weekly: (date?: string) => api.get<WeeklyReview>('/analytics/weekly/', { params: { date } }),
  monthly: (date?: string) => api.get<MonthlyReview>('/analytics/monthly/', { params: { date } }),
  recompute: (date?: string) => api.post<DayMetrics>('/analytics/recompute/', undefined, { params: { date } }),
};

/** ISO yyyy-mm-dd for a local Date. */
export function isoDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function shiftDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  date.setDate(date.getDate() + days);
  return isoDay(date);
}

export function shiftMonths(iso: string, months: number): string {
  const [y, m] = iso.split('-').map(Number);
  const date = new Date(y ?? 1970, (m ?? 1) - 1 + months, 1);
  return isoDay(date);
}
