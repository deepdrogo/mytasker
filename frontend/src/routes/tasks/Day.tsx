import { Navigate, useNavigate, useParams } from '@solidjs/router';
import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import { DayTaskListPage } from '~/features/tasks/DayTaskListPage';
import { addDays, isoDay } from '~/features/tasks/span';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function isRealDay(value: string | undefined): value is string {
  if (!value || !ISO_DAY.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year as number, (month as number) - 1, day);
  return isoDay(date) === value;
}

/** `/day/2026-11-23`: one chosen day, grouped like Tomorrow. `/day` opens on the day after tomorrow. */
export default function Day(): JSX.Element {
  const params = useParams<{ date?: string }>();
  const navigate = useNavigate();
  const today = () => isoDay(new Date());

  // Today and tomorrow already have their own pages (Today also carries the overdue work).
  const target = (iso: string) => {
    if (iso === today()) return '/today';
    if (iso === addDays(today(), 1)) return '/tomorrow';
    return `/day/${iso}`;
  };

  return (
    <Show when={isRealDay(params.date) && target(params.date as string).startsWith('/day/')} fallback={
      <Navigate href={isRealDay(params.date) ? target(params.date as string) : `/day/${addDays(today(), 2)}`} />
    }>
      <DayTaskListPage day="date" date={params.date} onPickDay={(iso) => navigate(target(iso))} />
    </Show>
  );
}
