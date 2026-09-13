import { Bitcoin, Briefcase, Rocket, User } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { createMemo } from 'solid-js';
import { Page } from '~/components/shared/Page';
import { CanvasBoard, progressOf, type CanvasColumn } from '~/features/canvas/CanvasBoard';
import { projectsApi } from '~/features/projects/api';
import { tasksApi } from '~/features/tasks/api';
import { createQuery } from '~/hooks/createQuery';
import { t } from '~/i18n';
import { authStore } from '~/stores/auth';
import { tx } from '~/stores/translations';
import type { Task } from '~/types';

/** Everything open that has no deadline - the backlog to date or drop. */
export default function NoDate(): JSX.Element {
  const tasks = createQuery(
    () => 'tasks:no-date:grouped',
    () =>
      tasksApi.list({
        view: 'no_date',
        top_level: true,
        completed: false,
        include_subtasks: '1',
        ordering: 'priority',
        page_size: 200,
      }),
  );
  const projects = createQuery(
    () => 'projects:no-date:grouped',
    () => projectsApi.list({ view: 'open', ordering: 'manual', page_size: 100 }),
  );

  const columns = createMemo<CanvasColumn[]>(() => {
    const personal: Task[] = [];
    const business: Task[] = [];
    const crypto: Task[] = [];
    const byProject = new Map<number, Task[]>();
    for (const task of tasks.data()?.results ?? []) {
      if (task.project) {
        byProject.set(task.project.id, [...(byProject.get(task.project.id) ?? []), task]);
      } else if (task.kind === 'personal') personal.push(task);
      else if (task.kind === 'crypto') crypto.push(task);
      else business.push(task);
    }

    const result: CanvasColumn[] = [
      { key: 'personal', title: t('Personal'), href: '/tasks/personal', icon: <User size={13} />, tasks: personal },
      { key: 'business', title: t('Business'), href: '/tasks/business', icon: <Briefcase size={13} />, tasks: business },
    ];
    const known = new Map((projects.data()?.results ?? []).map((project) => [project.id, project] as const));
    const projectIds = [
      ...(projects.data()?.results ?? []).filter((project) => byProject.has(project.id)).map((project) => project.id),
      ...[...byProject.keys()].filter((id) => !known.has(id)),
    ];
    for (const id of projectIds) {
      const grouped = byProject.get(id) ?? [];
      const project = known.get(id);
      const name = project ? tx('project', id, 'name', project.name) : grouped[0]?.project?.name ?? '';
      result.push({
        key: `p${id}`,
        title: name,
        href: authStore.isAssistant() ? undefined : `/projects/${id}/tasks`,
        icon: project?.category === 'startup' ? <Rocket size={13} /> : undefined,
        tasks: grouped,
        progress: project ? progressOf(project.task_done, project.task_total) : undefined,
      });
    }
    result.push({ key: 'crypto', title: t('Crypto world'), href: '/tasks/crypto', icon: <Bitcoin size={13} />, tasks: crypto });
    return result.filter((column) => column.tasks.length > 0);
  });

  const refresh = () => {
    tasks.refetch();
    projects.refetch();
  };

  return (
    <Page title={t('No date')} subtitle={t('Grouped by personal, business and project.')}>
      <CanvasBoard
        columns={columns}
        loading={() => tasks.loading() || projects.loading()}
        error={() => tasks.error() ?? projects.error()}
        onRefresh={refresh}
        emptyTitle={t('Everything has a date.')}
        emptyHint={t('Tasks you add without a deadline will show up here.')}
      />
    </Page>
  );
}
