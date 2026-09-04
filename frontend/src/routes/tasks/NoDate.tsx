import type { JSX } from 'solid-js';
import { TaskListPage } from '~/features/tasks/TaskListPage';
import { t } from '~/i18n';

/** Everything open that has no deadline - the backlog to date or drop. */
export default function NoDate(): JSX.Element {
  return (
    <TaskListPage
      title={t('No date')}
      subtitle={t('Open tasks without a deadline. Give them a day or let them go.')}
      queryName="no-date"
      params={() => ({ view: 'no_date', top_level: true })}
      hideComposer
      showProject
      defaultOrdering="-priority"
      emptyTitle={t('Everything has a date.')}
      emptyHint={t('Tasks you add without a deadline will show up here.')}
    />
  );
}
