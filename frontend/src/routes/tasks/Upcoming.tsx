import type { JSX } from 'solid-js';
import { TaskListPage } from '~/features/tasks/TaskListPage';

export default function Upcoming(): JSX.Element {
  return (
    <TaskListPage
      title="Upcoming"
      subtitle="Everything due after today."
      queryName="upcoming"
      params={() => ({ view: 'upcoming', top_level: true })}
      defaultOrdering="due"
      hideComposer
      emptyTitle="Nothing scheduled ahead."
      emptyHint="Tasks with a future deadline will show up here."
    />
  );
}
