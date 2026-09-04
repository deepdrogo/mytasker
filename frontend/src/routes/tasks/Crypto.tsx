import type { JSX } from 'solid-js';
import { TaskListPage } from '~/features/tasks/TaskListPage';
import { t } from '~/i18n';

export default function Crypto(): JSX.Element {
  return (
    <TaskListPage
      title={t('Crypto world')}
      subtitle={t('A private list for crypto work. It never appears on Today.')}
      queryName="crypto"
      params={() => ({ kind: 'crypto', top_level: true, completed: false })}
      composerDefaults={{ kind: 'crypto' }}
      composerPlaceholder={t('Add a crypto task…')}
      showProject={false}
      emptyTitle={t('Nothing in the crypto world yet.')}
      emptyHint={t('Add a task above or press N anywhere.')}
    />
  );
}
