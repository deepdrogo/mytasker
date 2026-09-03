import type { JSX } from 'solid-js';
import { TaskListPage } from '~/features/tasks/TaskListPage';
import { t } from '~/i18n';

export default function Completed(): JSX.Element {
  return (
    <TaskListPage
      title={t('Completed')}
      subtitle={t('Done is done. Reopen anything by mistake.')}
      queryName="completed"
      params={() => ({ view: 'completed', top_level: true })}
      defaultOrdering="-completed"
      hideComposer
      emptyTitle={t('No completed tasks yet.')}
    />
  );
}
