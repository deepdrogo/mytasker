// MyTasker — Advertising work: the ad-candidate companies on top, then every open ad task grouped by project.

import type { JSX } from 'solid-js';
import { AdCompanies } from '~/features/ads/AdWork';
import { TaskListPage } from '~/features/tasks/TaskListPage';
import { t } from '~/i18n';

export default function Ads(): JSX.Element {
  return (
    <TaskListPage
      title={t('Advertising work')}
      subtitle={t('Companies with ad work and every advertising task, in one place.')}
      queryName="ads"
      params={() => ({ is_ad: true, completed: false, top_level: true })}
      composerDefaults={{ is_ad: true, kind: 'business' }}
      composerPlaceholder={t('Add an advertising task…')}
      composerProjectPicker
      showProject
      showKind
      groupByProject
      defaultOrdering="due"
      emptyTitle={t('No advertising tasks yet.')}
      emptyHint={t('Add one above, or mark any task as an advertising task from its menu.')}
      beforeList={() => <AdCompanies />}
    />
  );
}
