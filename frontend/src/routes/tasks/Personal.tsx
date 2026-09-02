import type { JSX } from 'solid-js';
import { TaskListPage } from '~/features/tasks/TaskListPage';

export default function Personal(): JSX.Element {
  return (
    <TaskListPage
      title="Personal"
      subtitle="Life tasks, no project needed."
      queryName="personal"
      params={() => ({ kind: 'personal', top_level: true, completed: false })}
      composerDefaults={{ kind: 'personal' }}
      composerPlaceholder="Add a personal task…"
      showProject={false}
      emptyTitle="Nothing personal pending."
      emptyHint="Add a task above or press N anywhere."
    />
  );
}
