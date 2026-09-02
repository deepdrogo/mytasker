import type { JSX } from 'solid-js';
import { TaskListPage } from '~/features/tasks/TaskListPage';

export default function Business(): JSX.Element {
  return (
    <TaskListPage
      title="Business"
      subtitle="Work tasks across all projects."
      queryName="business"
      params={() => ({ kind: 'business', top_level: true, completed: false })}
      composerDefaults={{ kind: 'business' }}
      composerPlaceholder="Add a business task…"
      emptyTitle="No open business tasks."
      emptyHint="Tasks created inside a project appear here as well."
    />
  );
}
