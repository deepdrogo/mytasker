import { FolderKanban, Plus } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { createSignal, For, Show } from 'solid-js';
import { Page } from '~/components/shared/Page';
import { Button } from '~/components/ui/Button';
import { EmptyState, ErrorNote, Skeleton } from '~/components/ui/Feedback';
import { Input, Select } from '~/components/ui/Input';
import { projectListKey, projectsApi, type ProjectListParams } from '~/features/projects/api';
import { ProjectCard } from '~/features/projects/ProjectCard';
import { ProjectEditor } from '~/features/projects/ProjectEditor';
import { createQuery } from '~/hooks/createQuery';
import { t } from '~/i18n';
import type { ProjectCategory, ProjectKind } from '~/types';
import styles from './ProjectListPage.module.css';

const PROJECT_TABS = [
  { label: 'Active', href: '/projects/active' },
  { label: 'Startups', href: '/projects/startups' },
  { label: 'All', href: '/projects/all' },
  { label: 'Canvas', href: '/projects/canvas' },
  { label: 'Ideas', href: '/projects/ideas' },
];

/** Section tabs shared by the project routes. Call inside JSX so labels follow the locale. */
export function projectTabs(): Array<{ label: string; href: string }> {
  return PROJECT_TABS.map((tab) => ({ ...tab, label: t(tab.label) }));
}

const SORTS = [
  { value: 'manual', label: 'Manual' },
  { value: 'deadline', label: 'Deadline' },
  { value: '-progress', label: 'Progress' },
  { value: 'name', label: 'Name' },
  { value: '-updated', label: 'Recently updated' },
];

interface ProjectListPageProps {
  title: string;
  subtitle?: string;
  queryName: string;
  params: ProjectListParams;
  defaultKind?: ProjectKind;
  /** Pre-selected category for projects created from this page (e.g. the Startups tab). */
  defaultCategory?: ProjectCategory;
  emptyTitle: string;
  emptyHint?: string;
  showStatusFilter?: boolean;
}

export function ProjectListPage(props: ProjectListPageProps): JSX.Element {
  const [ordering, setOrdering] = createSignal('manual');
  const [status, setStatus] = createSignal('');
  const [search, setSearch] = createSignal('');
  const [creating, setCreating] = createSignal(false);

  const params = (): ProjectListParams => ({
    ...props.params,
    ordering: ordering(),
    status: status() || undefined,
    q: search().trim() || undefined,
    page_size: 100,
  });

  const query = createQuery(
    () => projectListKey(props.queryName, params()),
    () => projectsApi.list(params()),
  );

  return (
    <>
      <Page
        title={props.title}
        subtitle={props.subtitle}
        tabs={projectTabs()}
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus size={14} />
            {t('New')}
          </Button>
        }
        toolbar={
          <div class={styles.toolbar}>
            <Input
              sizeVariant="sm"
              placeholder={t('Filter by name')}
              value={search()}
              onInput={(e) => setSearch(e.currentTarget.value)}
              aria-label={t('Filter projects')}
            />
            <Show when={props.showStatusFilter}>
              <Select sizeVariant="sm" value={status()} onChange={(e) => setStatus(e.currentTarget.value)} aria-label={t('Status')}>
                <option value="">{t('Any status')}</option>
                <option value="planned">{t('Planned')}</option>
                <option value="active">{t('Active')}</option>
                <option value="paused">{t('Paused')}</option>
                <option value="completed">{t('Completed')}</option>
                <option value="archived">{t('Archived')}</option>
              </Select>
            </Show>
            <Select sizeVariant="sm" value={ordering()} onChange={(e) => setOrdering(e.currentTarget.value)} aria-label={t('Sort')}>
              <For each={SORTS}>{(sort) => <option value={sort.value}>{t(sort.label)}</option>}</For>
            </Select>
          </div>
        }
      >
        <Show when={!query.error()} fallback={<ErrorNote message={t('Could not load projects.')} onRetry={query.refetch} />}>
          <Show when={query.data()} fallback={<Skeleton rows={4} height={120} />}>
            {(data) => (
              <Show
                when={data().results.length > 0}
                fallback={
                  <EmptyState
                    icon={<FolderKanban size={22} />}
                    title={props.emptyTitle}
                    hint={props.emptyHint}
                    action={
                      <Button size="sm" onClick={() => setCreating(true)}>
                        {t('Create a project')}
                      </Button>
                    }
                  />
                }
              >
                <div class={styles.grid}>
                  <For each={data().results}>{(project) => <ProjectCard project={project} />}</For>
                </div>
              </Show>
            )}
          </Show>
        </Show>
      </Page>

      <ProjectEditor
        open={creating()}
        onClose={() => setCreating(false)}
        defaultKind={props.defaultKind}
        defaultCategory={props.defaultCategory}
        onSaved={() => query.refetch()}
      />
    </>
  );
}
