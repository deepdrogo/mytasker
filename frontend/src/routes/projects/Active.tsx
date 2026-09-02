import type { JSX } from 'solid-js';
import { ProjectListPage } from '~/features/projects/ProjectListPage';

export default function ProjectsActive(): JSX.Element {
  return (
    <ProjectListPage
      title="Active Projects"
      subtitle="What you are pushing forward right now"
      queryName="active"
      params={{ view: 'active' }}
      defaultKind="active"
      emptyTitle="No active projects"
      emptyHint="Mark a project as Active to keep it in focus here and on Today."
    />
  );
}
