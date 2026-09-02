import type { JSX } from 'solid-js';
import { TaskListPage } from '~/features/tasks/TaskListPage';

export default function Completed(): JSX.Element {
  return (
    <TaskListPage
      title="Completed"
      subtitle="Done is done. Reopen anything by mistake."
      queryName="completed"
      params={() => ({ view: 'completed', top_level: true })}
      defaultOrdering="-completed"
      hideComposer
      emptyTitle="No completed tasks yet."
    />
  );
}
