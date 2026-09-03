import type { JSX } from 'solid-js';
import { TaskListPage } from '~/features/tasks/TaskListPage';
import { t } from '~/i18n';

export default function Upcoming(): JSX.Element {
  return (
    <TaskListPage
      title={t('Upcoming')}
      subtitle={t('Everything due after today.')}
      queryName="upcoming"
      params={() => ({ view: 'upcoming', top_level: true })}
      defaultOrdering="due"
      hideComposer
      emptyTitle={t('Nothing scheduled ahead.')}
      emptyHint={t('Tasks with a future deadline will show up here.')}
    />
  );
}
