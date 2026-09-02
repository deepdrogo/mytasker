import type { JSX } from 'solid-js';
import { ProjectListPage } from '~/features/projects/ProjectListPage';

export default function ProjectsAll(): JSX.Element {
  return (
    <ProjectListPage
      title="Projects"
      subtitle="Everything you own or collaborate on"
      queryName="all"
      params={{}}
      emptyTitle="No projects yet"
      emptyHint="Projects group tasks, prompts, time and people."
      showStatusFilter
    />
  );
}
