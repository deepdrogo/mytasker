import type { JSX } from 'solid-js';
import { ProjectListPage } from '~/features/projects/ProjectListPage';
import { t } from '~/i18n';

export default function ProjectsStartups(): JSX.Element {
  return (
    <ProjectListPage
      title={t('Startups')}
      subtitle={t('Ventures kept apart from everyday projects')}
      queryName="startups"
      params={{ category: 'startup' }}
      defaultCategory="startup"
      emptyTitle={t('No startups yet')}
      emptyHint={t('Projects created here are filed under Startups automatically.')}
      showStatusFilter
    />
  );
}
