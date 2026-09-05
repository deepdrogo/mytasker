import type { JSX } from 'solid-js';
import { DayTaskListPage } from '~/features/tasks/DayTaskListPage';

export default function Tomorrow(): JSX.Element {
  return <DayTaskListPage day="tomorrow" />;
}
