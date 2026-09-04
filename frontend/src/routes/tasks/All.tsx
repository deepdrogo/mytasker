// MyTasker — Tasks › All: personal, business and every project on one page, subtasks expanded.
// Built by drogoz · https://github.com/deepdrogo/mytasker

import { Briefcase, Rocket, User } from 'lucide-solid';
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

export default function TasksAll(): JSX.Element {
  const tasks = createQuery(
    () => 'tasks:canvas:all',
    () => tasksApi.list({ top_level: true, completed: false, include_subtasks: '1', ordering: 'manual', page_size: 200 }),
  );
  const projects = createQuery(
    () => 'projects:canvas',
    () => projectsApi.list({ view: 'open', ordering: 'manual', page_size: 100 }),
  );

  const columns = createMemo<CanvasColumn[]>(() => {
    const all = tasks.data()?.results ?? [];
    const personal: Task[] = [];
    const business: Task[] = [];
    const byProject = new Map<number, Task[]>();
    for (const task of all) {
      if (task.project) {
        const list = byProject.get(task.project.id) ?? [];
        list.push(task);
        byProject.set(task.project.id, list);
      } else if (task.kind === 'personal') personal.push(task);
      else business.push(task);
    }

    const cols: CanvasColumn[] = [];
    // Assistants only ever see what they added; the personal/business split still applies.
    cols.push({
      key: 'personal',
      title: t('Personal'),
      href: '/tasks/personal',
      icon: <User size={13} />,
      tasks: personal,
      composerDefaults: { kind: 'personal' },
      composerPlaceholder: t('Add a personal task…'),
    });
    cols.push({
      key: 'business',
      title: t('Business'),
      href: '/tasks/business',
      icon: <Briefcase size={13} />,
      tasks: business,
      composerDefaults: { kind: 'business', origin: 'list' },
      composerPlaceholder: t('Add a business task…'),
    });

    const known = new Map((projects.data()?.results ?? []).map((p) => [p.id, p] as const));
    // Projects in list order first, then any project the task list references but the project list did not return.
    const ordered = [
      ...(projects.data()?.results ?? []).filter((p) => byProject.has(p.id)).map((p) => p.id),
      ...[...byProject.keys()].filter((id) => !known.has(id)),
    ];
    for (const id of ordered) {
      const open = byProject.get(id) ?? [];
      const project = known.get(id);
      const name = project ? tx('project', id, 'name', project.name) : tx('project', id, 'name', open[0]?.project?.name ?? '');
      cols.push({
        key: `p${id}`,
        title: name,
        href: authStore.isAssistant() ? undefined : `/projects/${id}/tasks`,
        icon: project?.category === 'startup' ? <Rocket size={13} /> : undefined,
        tasks: open,
        progress: project ? progressOf(project.task_done, project.task_total) : undefined,
        composerDefaults: { kind: 'business', origin: 'project', project_id: id },
        composerPlaceholder: t('Add a task to {name}…', { name }),
      });
    }
    return cols;
  });

  const refresh = () => {
    void tasks.refetch();
    void projects.refetch();
  };

  return (
    <Page title={t('All tasks')} subtitle={t('Personal, business and projects on one canvas.')}>
      <CanvasBoard
        columns={columns}
        loading={() => tasks.loading()}
        error={() => tasks.error()}
        onRefresh={refresh}
        emptyTitle={t('No open tasks.')}
      />
    </Page>
  );
}
