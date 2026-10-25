// MyTasker — "Working projects": a calm, premium catalog of every project with a working / not-working mark.
// Built by drogoz · https://github.com/deepdrogo/mytasker

import { A } from '@solidjs/router';
import { Check, Clock, FolderKanban } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { createMemo, For, Show } from 'solid-js';
import { Page } from '~/components/shared/Page';
import { EmptyState, ErrorNote, Skeleton } from '~/components/ui/Feedback';
import { projectsApi } from '~/features/projects/api';
import { projectTabs } from '~/features/projects/ProjectListPage';
import { createQuery } from '~/hooks/createQuery';
import { t } from '~/i18n';
import { tx } from '~/stores/translations';
import { toast } from '~/stores/ui';
import type { Project } from '~/types';
import { formatDuration } from '~/utils/format';
import styles from './Working.module.css';

export default function Working(): JSX.Element {
  const query = createQuery(
    () => 'projects:working-catalog',
    () => projectsApi.list({ page_size: 200, ordering: 'name' }),
  );

  const projects = () => query.data()?.results ?? [];
  const workingCount = createMemo(() => projects().filter((p) => p.is_working).length);
  // Working projects float to the top; within each group keep the server's name ordering.
  const ordered = createMemo(() =>
    [...projects()].sort((a, b) => Number(b.is_working) - Number(a.is_working)),
  );

  const toggle = async (project: Project) => {
    const next = !project.is_working;
    // Optimistic: flip locally, then confirm with the server; revert on failure.
    query.mutate((prev) =>
      prev
        ? { ...prev, results: prev.results.map((p) => (p.id === project.id ? { ...p, is_working: next } : p)) }
        : prev,
    );
    try {
      await projectsApi.setWorking(project.id, next);
    } catch {
      query.mutate((prev) =>
        prev
          ? { ...prev, results: prev.results.map((p) => (p.id === project.id ? { ...p, is_working: !next } : p)) }
          : prev,
      );
      toast(t('Could not update the project.'));
    }
  };

  return (
    <Page
      title={t('Working projects')}
      subtitle={t('Everything you are building — and what you are working on right now.')}
      tabs={projectTabs()}
    >
      <Show when={!query.error()} fallback={<ErrorNote message={t('Could not load projects.')} onRetry={query.refetch} />}>
        <Show when={query.data()} fallback={<Skeleton rows={5} height={64} />}>
          <Show
            when={projects().length > 0}
            fallback={
              <EmptyState
                icon={<FolderKanban size={22} />}
                title={t('No projects yet')}
                hint={t('Create a project to see it here.')}
              />
            }
          >
            <div class={styles.wrap}>
              <p class={styles.summary}>
                <span class={styles.summaryStrong}>{t('{count} working', { count: workingCount() })}</span>
                <span class={styles.summaryDim}>{t('of {count} projects', { count: projects().length })}</span>
              </p>

              <ul class={styles.list}>
                <For each={ordered()}>
                  {(project) => (
                    <li class={[styles.row, project.is_working ? styles.rowOn : ''].filter(Boolean).join(' ')}>
                      <button
                        type="button"
                        class={[styles.status, project.is_working ? styles.statusOn : ''].filter(Boolean).join(' ')}
                        onClick={() => void toggle(project)}
                        aria-pressed={project.is_working}
                        aria-label={
                          project.is_working
                            ? t('Stop working on {name}', { name: project.name })
                            : t('Mark {name} as working', { name: project.name })
                        }
                        title={project.is_working ? t('Working — click to clear') : t('Not working — click to mark')}
                      >
                        <Show when={project.is_working}>
                          <Check size={13} stroke-width={3} />
                        </Show>
                      </button>

                      <A href={`/projects/${project.id}/tasks`} class={styles.main}>
                        <span class={styles.name}>{tx('project', project.id, 'name', project.name)}</span>
                        <span class={styles.meta}>
                          <Show when={project.is_working}>
                            <span class={styles.working}>{t('Working')}</span>
                          </Show>
                          <Show when={project.open_tasks > 0}>
                            <span>{t('{count} open', { count: project.open_tasks })}</span>
                          </Show>
                          <Show when={project.progress !== null}>
                            <span class="mt-mono">{project.progress}%</span>
                          </Show>
                          <Show when={project.tracked_seconds > 0}>
                            <span class={styles.metaTime}>
                              <Clock size={11} />
                              <span class="mt-mono">{formatDuration(project.tracked_seconds)}</span>
                            </span>
                          </Show>
                        </span>
                      </A>
                    </li>
                  )}
                </For>
              </ul>
            </div>
          </Show>
        </Show>
      </Show>
    </Page>
  );
}
