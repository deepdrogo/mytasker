import type { JSX } from 'solid-js';
import { TaskListPage } from '~/features/tasks/TaskListPage';
import { t } from '~/i18n';

export default function Personal(): JSX.Element {
  return (
    <TaskListPage
      title={t('Personal')}
      subtitle={t('Life tasks, no project needed.')}
      queryName="personal"
      params={() => ({ kind: 'personal', top_level: true, completed: false })}
      composerDefaults={{ kind: 'personal' }}
      composerPlaceholder={t('Add a personal task…')}
      showProject={false}
      emptyTitle={t('Nothing personal pending.')}
      emptyHint={t('Add a task above or press N anywhere.')}
    />
  );
}
