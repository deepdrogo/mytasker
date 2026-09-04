// MyTasker — Projects › Canvas: every open project as a column, tasks and subtasks expanded.
// Built by drogoz · https://github.com/deepdrogo/mytasker

import { Rocket } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { createMemo, createSignal } from 'solid-js';
import { Page } from '~/components/shared/Page';
import { Checkbox } from '~/components/ui/Input';
import { CanvasBoard, progressOf, type CanvasColumn } from '~/features/canvas/CanvasBoard';
import { projectsApi } from '~/features/projects/api';
import { projectTabs } from '~/features/projects/ProjectListPage';
import { tasksApi } from '~/features/tasks/api';
import { createQuery } from '~/hooks/createQuery';
import { t } from '~/i18n';
import { tx } from '~/stores/translations';
import type { Task } from '~/types';
import { formatDuration } from '~/utils/format';

export default function ProjectsCanvas(): JSX.Element {
  const [showEmpty, setShowEmpty] = createSignal(false);

  const projects = createQuery(
    () => 'projects:canvas',
    () => projectsApi.list({ view: 'open', ordering: 'manual', page_size: 100 }),
  );
  const tasks = createQuery(
    () => 'tasks:canvas:projects',
    () => tasksApi.list({ has_project: true, top_level: true, completed: false, include_subtasks: '1', ordering: 'manual', page_size: 200 }),
  );

  const byProject = createMemo(() => {
    const map = new Map<number, Task[]>();
    for (const task of tasks.data()?.results ?? []) {
      const id = task.project?.id;
      if (id === undefined) continue;
      const list = map.get(id) ?? [];
      list.push(task);
      map.set(id, list);
    }
    return map;
  });

  const columns = createMemo<CanvasColumn[]>(() => {
    const list = projects.data()?.results ?? [];
    const withTasks = list.filter((p) => (byProject().get(p.id)?.length ?? 0) > 0);
    const empty = showEmpty() ? list.filter((p) => (byProject().get(p.id)?.length ?? 0) === 0) : [];
    return [...withTasks, ...empty].map((p) => {
      const open = byProject().get(p.id) ?? [];
      const tracked = p.tracked_seconds ? ` · ${formatDuration(p.tracked_seconds)}` : '';
      return {
        key: `p${p.id}`,
        title: tx('project', p.id, 'name', p.name),
        href: `/projects/${p.id}/tasks`,
        icon: p.category === 'startup' ? <Rocket size={13} /> : undefined,
        meta: `${t('{count} open', { count: open.length })}${tracked}`,
        tasks: open,
        progress: progressOf(p.task_done, p.task_total),
        composerDefaults: { kind: 'business', origin: 'project', project_id: p.id },
        composerPlaceholder: t('Add a task to {name}…', { name: tx('project', p.id, 'name', p.name) }),
      };
    });
  });

  const refresh = () => {
    void projects.refetch();
    void tasks.refetch();
  };

  return (
    <Page
      title={t('Canvas')}
      subtitle={t('Every project and its tasks, side by side.')}
      tabs={projectTabs()}
      actions={<Checkbox label={t('Show empty projects')} checked={showEmpty()} onChange={(e) => setShowEmpty(e.currentTarget.checked)} />}
    >
      <CanvasBoard
        columns={columns}
        loading={() => projects.loading() || tasks.loading()}
        error={() => projects.error() ?? tasks.error()}
        onRefresh={refresh}
        emptyTitle={t('No project has open tasks right now.')}
        emptyHint={t('Turn on "Show empty projects" to add tasks to a project.')}
      />
    </Page>
  );
}
