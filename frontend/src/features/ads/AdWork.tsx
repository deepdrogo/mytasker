// MyTasker — Advertising work: the projects with the violet dot lit, and how much ad work each has open.
// A small strip under the board on the Dashboard; a fuller card grid on the Ads page. Same data, same colours.

import { A } from '@solidjs/router';
import type { JSX } from 'solid-js';
import { createMemo, For, Show } from 'solid-js';
import { projectListKey, projectsApi, type ProjectListParams } from '~/features/projects/api';
import { ProjectAvatar } from '~/features/projects/ProjectAvatar';
import { AdDot, saveAd, saveWorkState, STATE_LABEL, StateDot } from '~/features/projects/ProjectDots';
import { tasksApi, taskListKey, type TaskListParams } from '~/features/tasks/api';
import { createQuery } from '~/hooks/createQuery';
import { t } from '~/i18n';
import { tx } from '~/stores/translations';
import type { ID, Project } from '~/types';
import { cx } from '~/utils/cx';
import styles from './AdWork.module.css';

const AD_PROJECTS: ProjectListParams = { is_ad: true, ordering: 'manual', page_size: 100 };
const OPEN_AD_TASKS: TaskListParams = { is_ad: true, completed: false, top_level: true, ordering: 'due', page_size: 200 };

/** Ad-candidate projects plus open ad tasks per project, shared by the strip and the Ads page. */
function useAdWork() {
  const projects = createQuery(() => projectListKey('ads', AD_PROJECTS), () => projectsApi.list(AD_PROJECTS));
  const tasks = createQuery(() => taskListKey('ads-open', OPEN_AD_TASKS), () => tasksApi.list(OPEN_AD_TASKS));
  const live = createMemo(() =>
    (projects.data()?.results ?? []).filter((project) => project.status !== 'archived' && project.status !== 'completed'),
  );
  const openByProject = createMemo(() => {
    const counts = new Map<ID, number>();
    for (const task of tasks.data()?.results ?? []) {
      if (task.project) counts.set(task.project.id, (counts.get(task.project.id) ?? 0) + 1);
    }
    return counts;
  });
  const looseOpen = () => (tasks.data()?.results ?? []).filter((task) => !task.project).length;
  const totalOpen = () => tasks.data()?.results.length ?? 0;
  return { projects, live, openByProject, looseOpen, totalOpen };
}

/** Dashboard: a compact row of ad-candidate projects right under the Working board. */
export function AdWorkStrip(): JSX.Element {
  const ad = useAdWork();
  return (
    <section class={styles.strip} aria-label={t('Advertising work')}>
      <header class={styles.head}>
        <i class={styles.key} />
        <span class={styles.title}>{t('Advertising work')}</span>
        <span class={styles.count}>{ad.live().length}</span>
        <Show when={ad.totalOpen() > 0}>
          <span class={styles.hint}>{t('{count} open ad tasks', { count: ad.totalOpen() })}</span>
        </Show>
        <A href="/ads" class={styles.link}>
          {t('Open')} →
        </A>
      </header>
      <Show
        when={ad.live().length > 0}
        fallback={<p class={styles.empty}>{t('Light the violet dot on a project and it shows up here - it stays on the board too.')}</p>}
      >
        <ul class={styles.chips}>
          <For each={ad.live()}>
            {(project) => (
              <li class={styles.chip}>
                <A href={`/projects/${project.id}/tasks`} class={styles.chipLink} title={project.name}>
                  <ProjectAvatar project={project} size={22} />
                  <span class={styles.chipName}>{tx('project', project.id, 'name', project.name)}</span>
                  <Show when={ad.openByProject().get(project.id)}>
                    {(count) => <span class={styles.chipCount}>{count()}</span>}
                  </Show>
                </A>
                <AdDot project={project} onToggle={(on) => void saveAd(project, on)} />
              </li>
            )}
          </For>
        </ul>
      </Show>
    </section>
  );
}

/** Ads page: one card per ad-candidate company. */
export function AdCompanies(): JSX.Element {
  const ad = useAdWork();
  return (
    <section class={styles.companies} aria-label={t('Advertising candidates')}>
      <header class={styles.head}>
        <i class={styles.key} />
        <span class={styles.title}>{t('Advertising candidates')}</span>
        <span class={styles.count}>{ad.live().length}</span>
        <span class={styles.hint}>{t('Companies with ad work. Light the violet dot on any project to add one.')}</span>
      </header>
      <Show
        when={ad.live().length > 0}
        fallback={<p class={styles.empty}>{t('No company yet. On the Dashboard, Working or All, tap the dashed violet dot next to a project.')}</p>}
      >
        <div class={styles.grid}>
          <For each={ad.live()}>{(project) => <CompanyCard project={project} open={ad.openByProject().get(project.id) ?? 0} />}</For>
        </div>
      </Show>
      <Show when={ad.looseOpen() > 0}>
        <p class={styles.loose}>{t('{count} ad tasks without a project are in the list below.', { count: ad.looseOpen() })}</p>
      </Show>
    </section>
  );
}

function CompanyCard(props: { project: Project; open: number }): JSX.Element {
  const name = () => tx('project', props.project.id, 'name', props.project.name);
  return (
    <A href={`/projects/${props.project.id}/tasks`} class={styles.card}>
      <ProjectAvatar project={props.project} size={36} />
      <span class={styles.cardBody}>
        <span class={styles.cardName}>{name()}</span>
        <span class={styles.cardMeta}>
          {t(STATE_LABEL[props.project.work_state])}
          {' · '}
          <span class={cx(props.open > 0 && styles.cardOpen)}>
            {props.open > 0 ? t('{count} open ad tasks', { count: props.open }) : t('No open ad tasks')}
          </span>
        </span>
      </span>
      <span class={styles.cardDots}>
        <AdDot project={props.project} onToggle={(on) => void saveAd(props.project, on)} />
        <StateDot project={props.project} onCycle={(next) => void saveWorkState(props.project, next)} />
      </span>
    </A>
  );
}
