import type { JSX } from 'solid-js';
import { ProjectListPage } from '~/features/projects/ProjectListPage';
import { t } from '~/i18n';

export default function ProjectsAll(): JSX.Element {
  return (
    <ProjectListPage
      title={t('Projects')}
      subtitle={t('Everything you own or collaborate on')}
      queryName="all"
      params={{}}
      emptyTitle={t('No projects yet')}
      emptyHint={t('Projects group tasks, prompts, time and people.')}
      showStatusFilter
    />
  );
}
