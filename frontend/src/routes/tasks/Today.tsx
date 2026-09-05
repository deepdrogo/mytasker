import type { JSX } from 'solid-js';
import { DayTaskListPage } from '~/features/tasks/DayTaskListPage';

export default function Today(): JSX.Element {
  return <DayTaskListPage day="today" />;
}
