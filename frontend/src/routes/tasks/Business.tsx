import type { JSX } from 'solid-js';
import { TaskListPage } from '~/features/tasks/TaskListPage';
import { t } from '~/i18n';

/**
 * Only tasks added from this list live here (`origin=list`), optionally filed under a project too.
 * Tasks typed inside a project page stay in that project.
 */
export default function Business(): JSX.Element {
  return (
    <TaskListPage
      title={t('Business')}
      subtitle={t('Work tasks you add here. Pick a project to file a task there as well.')}
      queryName="business"
      params={() => ({ kind: 'business', origin: 'list', top_level: true, completed: false })}
      composerDefaults={{ kind: 'business', origin: 'list' }}
      composerPlaceholder={t('Add a business task…')}
      composerProjectPicker
      emptyTitle={t('No open business tasks.')}
      emptyHint={t('Add one above. Tasks created inside a project stay in that project.')}
    />
  );
}
