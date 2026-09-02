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
import type { ProjectKind } from '~/types';
import styles from './ProjectListPage.module.css';

export const PROJECT_TABS = [
  { label: 'Active', href: '/projects/active' },
  { label: 'All', href: '/projects/all' },
  { label: 'Ideas', href: '/projects/ideas' },
];

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
        tabs={PROJECT_TABS}
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus size={14} />
            New
          </Button>
        }
        toolbar={
          <div class={styles.toolbar}>
            <Input
              sizeVariant="sm"
              placeholder="Filter by name"
              value={search()}
              onInput={(e) => setSearch(e.currentTarget.value)}
              aria-label="Filter projects"
            />
            <Show when={props.showStatusFilter}>
              <Select sizeVariant="sm" value={status()} onChange={(e) => setStatus(e.currentTarget.value)} aria-label="Status">
                <option value="">Any status</option>
                <option value="planned">Planned</option>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="completed">Completed</option>
                <option value="archived">Archived</option>
              </Select>
            </Show>
            <Select sizeVariant="sm" value={ordering()} onChange={(e) => setOrdering(e.currentTarget.value)} aria-label="Sort">
              <For each={SORTS}>{(sort) => <option value={sort.value}>{sort.label}</option>}</For>
            </Select>
          </div>
        }
      >
        <Show when={!query.error()} fallback={<ErrorNote message="Could not load projects." onRetry={query.refetch} />}>
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
                        Create a project
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
        onSaved={() => query.refetch()}
      />
    </>
  );
}
