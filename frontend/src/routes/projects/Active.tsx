import type { JSX } from 'solid-js';
import { ProjectListPage } from '~/features/projects/ProjectListPage';
import { t } from '~/i18n';

export default function ProjectsActive(): JSX.Element {
  return (
    <ProjectListPage
      title={t('Active Projects')}
      subtitle={t('What you are pushing forward right now')}
      queryName="active"
      params={{ view: 'active' }}
      defaultKind="active"
      emptyTitle={t('No active projects')}
      emptyHint={t('Mark a project as Active to keep it in focus here and on the Dashboard.')}
    />
  );
}
