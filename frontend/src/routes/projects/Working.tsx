// MyTasker — Working projects. A dense board of the projects in progress, sorted into groups you name.

import { A } from '@solidjs/router';
import { FolderInput, GripVertical, Plus, Trash2 } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { createEffect, createMemo, createSignal, For, Show } from 'solid-js';
import { Page } from '~/components/shared/Page';
import { Dropdown, type MenuItem } from '~/components/ui/Dropdown';
import { ConfirmDialog, EmptyState, ErrorNote, Skeleton } from '~/components/ui/Feedback';
import { projectsApi, workGroupsApi, type WorkGroup } from '~/features/projects/api';
import { createQuery } from '~/hooks/createQuery';
import { createSortable, type Sortable } from '~/hooks/createSortable';
import { t } from '~/i18n';
import { tx } from '~/stores/translations';
import { toast } from '~/stores/ui';
import type { ID, Project } from '~/types';
import styles from './Working.module.css';

export default function Working(): JSX.Element {
  const projectsQuery = createQuery(
    () => 'projects:working-catalog',
    () => projectsApi.list({ page_size: 200, ordering: 'manual' }),
  );
  const groupsQuery = createQuery(() => 'work-groups', () => workGroupsApi.list());

  const projects = () => projectsQuery.data()?.results ?? [];
  /** Archived and finished projects stay on All. This board is the live shelf. */
  const visible = createMemo(() => projects().filter((project) => project.status !== 'archived' && project.status !== 'completed'));
  const workingCount = createMemo(() => visible().filter((project) => project.is_working).length);
  const groups = () => groupsQuery.data() ?? [];
  const inGroup = (id: ID) => visible().filter((project) => project.work_group_id === id);
  const ungrouped = createMemo(() => visible().filter((project) => project.work_group_id == null));

  const [draft, setDraft] = createSignal('');
  const [creating, setCreating] = createSignal(false);

  const patch = (id: ID, partial: Partial<Project>) => {
    projectsQuery.mutate((prev) =>
      prev ? { ...prev, results: prev.results.map((project) => (project.id === id ? { ...project, ...partial } : project)) } : prev,
    );
  };

  const toggleWorking = async (project: Project) => {
    if (!project.capabilities.manage_project) return;
    const next = !project.is_working;
    patch(project.id, { is_working: next });
    try {
      await projectsApi.setWorking(project.id, next);
    } catch {
      patch(project.id, { is_working: !next });
      toast(t('Could not update the project.'));
    }
  };

  const moveTo = async (project: Project, groupId: ID | null) => {
    if (!project.capabilities.manage_project || project.work_group_id === groupId) return;
    const previous = project.work_group_id;
    patch(project.id, { work_group_id: groupId });
    try {
      await projectsApi.update(project.id, { work_group_id: groupId });
    } catch {
      patch(project.id, { work_group_id: previous });
      toast(t('Could not update the project.'));
    }
  };

  /** The new order takes the slots this group already holds, so other groups stay put. */
  const saveOrder = async (arranged: Project[]) => {
    const ids = new Set(arranged.map((project) => project.id));
    const queue = [...arranged];
    projectsQuery.mutate((prev) =>
      prev ? { ...prev, results: prev.results.map((project) => (ids.has(project.id) ? (queue.shift() ?? project) : project)) } : prev,
    );
    try {
      await projectsApi.reorder(arranged.map((project) => project.id));
    } catch {
      toast(t('Could not save the order.'));
      projectsQuery.refetch();
    }
  };

  const saveGroupOrder = async (arranged: WorkGroup[]) => {
    groupsQuery.mutate(() => arranged.map((group, index) => ({ ...group, sort_order: index + 1 })));
    try {
      await workGroupsApi.reorder(arranged.map((group) => group.id));
    } catch {
      toast(t('Could not save the order.'));
      groupsQuery.refetch();
    }
  };

  const createGroup = async (event: Event) => {
    event.preventDefault();
    const name = draft().trim();
    if (!name || creating()) return;
    setCreating(true);
    try {
      await workGroupsApi.create(name);
      setDraft('');
    } catch {
      toast(t('Could not save the group.'));
    } finally {
      setCreating(false);
    }
  };

  const groupSortable = createSortable<WorkGroup>({
    items: groups,
    key: (group) => group.id,
    enabled: () => groups().length > 1,
    onReorder: (arranged) => void saveGroupOrder(arranged),
  });

  const loaded = () => projectsQuery.data() && groupsQuery.data();

  return (
    <Page title={t('Working projects')}>
      <Show
        when={!projectsQuery.error() && !groupsQuery.error()}
        fallback={<ErrorNote message={t('Could not load projects.')} onRetry={() => { projectsQuery.refetch(); groupsQuery.refetch(); }} />}
      >
        <Show when={loaded()} fallback={<Skeleton rows={4} height={28} />}>
          <Show
            when={visible().length > 0}
            fallback={
              <EmptyState icon={<FolderInput size={22} />} title={t('No projects yet')} hint={t('Create a project to see it here.')} />
            }
          >
            <div class={styles.board}>
              <div class={styles.hero}>
                <p class={styles.total}>
                  <span class={styles.totalPart}>
                    <i class={`${styles.key} ${styles.keyOn}`} />
                    {t('{count} working', { count: workingCount() })}
                  </span>
                  <span class={`${styles.totalPart} ${styles.totalWaiting}`}>
                    <i class={styles.key} />
                    {t('{count} waiting', { count: visible().length - workingCount() })}
                  </span>
                </p>
                <p class={styles.hint}>{t('Make a group, move projects into it, then drag to set the order.')}</p>
              </div>

              <form class={styles.create} onSubmit={(event) => void createGroup(event)}>
                <Plus size={14} />
                <input
                  class={styles.createInput}
                  value={draft()}
                  placeholder={t('New group')}
                  aria-label={t('New group')}
                  maxLength={80}
                  onInput={(event) => setDraft(event.currentTarget.value)}
                />
              </form>

              <div class={styles.shelves} ref={groupSortable.setContainer}>
                <For each={groupSortable.items()}>
                  {(group) => (
                    <GroupShelf
                      group={group}
                      projects={inGroup(group.id)}
                      groups={groups()}
                      sortable={groupSortable}
                      onReorder={saveOrder}
                      onToggleWorking={toggleWorking}
                      onMove={moveTo}
                      onRenamed={() => groupsQuery.refetch()}
                      onDeleted={() => {
                        groupsQuery.refetch();
                        projectsQuery.refetch();
                      }}
                    />
                  )}
                </For>
              </div>

              <Show when={ungrouped().length > 0}>
                <ProjectGrid
                  label={t('No group')}
                  projects={ungrouped()}
                  groups={groups()}
                  onReorder={saveOrder}
                  onToggleWorking={toggleWorking}
                  onMove={moveTo}
                />
              </Show>
            </div>
          </Show>
        </Show>
      </Show>
    </Page>
  );
}

function GroupShelf(props: {
  group: WorkGroup;
  projects: Project[];
  groups: WorkGroup[];
  sortable: Sortable<WorkGroup>;
  onReorder: (projects: Project[]) => void;
  onToggleWorking: (project: Project) => void;
  onMove: (project: Project, groupId: ID | null) => void;
  onRenamed: () => void;
  onDeleted: () => void;
}): JSX.Element {
  const [editing, setEditing] = createSignal(false);
  const [name, setName] = createSignal(props.group.name);
  const [confirming, setConfirming] = createSignal(false);
  createEffect(() => setName(props.group.name));

  const rename = async () => {
    const next = name().trim();
    setEditing(false);
    if (!next || next === props.group.name) {
      setName(props.group.name);
      return;
    }
    try {
      await workGroupsApi.rename(props.group.id, next);
      props.onRenamed();
    } catch {
      setName(props.group.name);
      toast(t('Could not save the group.'));
    }
  };

  const remove = async () => {
    try {
      await workGroupsApi.remove(props.group.id);
      setConfirming(false);
      props.onDeleted();
    } catch {
      toast(t('Could not save the group.'));
    }
  };

  return (
    <section
      class={[styles.group, props.sortable.isDragging(props.group) ? styles.groupDragging : ''].filter(Boolean).join(' ')}
      aria-label={props.group.name}
      {...props.sortable.itemProps(props.group)}
      style={props.sortable.itemStyle(props.group)}
    >
      <div class={styles.groupHead}>
        <button
          type="button"
          class={styles.grip}
          {...props.sortable.handleProps(props.group)}
          aria-label={t('Drag to reorder · arrow keys to move')}
          title={t('Drag to reorder · arrow keys to move')}
        >
          <GripVertical size={13} />
        </button>
        <Show
          when={editing()}
          fallback={
            <button type="button" class={styles.groupName} onClick={() => setEditing(true)} title={t('Rename group')}>
              {props.group.name}
            </button>
          }
        >
          <input
            class={styles.rename}
            value={name()}
            autofocus
            maxLength={80}
            aria-label={t('Rename group')}
            onInput={(event) => setName(event.currentTarget.value)}
            onBlur={() => void rename()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void rename();
              if (event.key === 'Escape') {
                setName(props.group.name);
                setEditing(false);
              }
            }}
          />
        </Show>
        <Tally projects={props.projects} />
        <button
          type="button"
          class={styles.iconBtn}
          aria-label={t('Delete group')}
          title={t('Delete group')}
          onClick={() => (props.projects.length ? setConfirming(true) : void remove())}
        >
          <Trash2 size={12} />
        </button>
      </div>
      <ProjectGrid
        projects={props.projects}
        groups={props.groups}
        onReorder={props.onReorder}
        onToggleWorking={props.onToggleWorking}
        onMove={props.onMove}
      />
      <ConfirmDialog
        open={confirming()}
        title={t('Delete group')}
        message={t('Projects in this group go back to No group.')}
        confirmLabel={t('Delete group')}
        destructive
        onCancel={() => setConfirming(false)}
        onConfirm={() => void remove()}
      />
    </section>
  );
}

function ProjectGrid(props: {
  label?: string;
  projects: Project[];
  groups: WorkGroup[];
  onReorder: (projects: Project[]) => void;
  onToggleWorking: (project: Project) => void;
  onMove: (project: Project, groupId: ID | null) => void;
}): JSX.Element {
  const sortable = createSortable<Project>({
    items: () => props.projects,
    key: (project) => project.id,
    flow: () => 'grid',
    enabled: () => props.projects.length > 1 && props.projects.some((project) => project.capabilities.manage_project),
    onReorder: (projects) => props.onReorder(projects),
  });
  return (
    <div>
      <Show when={props.label}>
        <div class={styles.groupHead}>
          <span class={styles.groupNameStatic}>{props.label}</span>
          <Tally projects={props.projects} />
        </div>
      </Show>
      <ul class={styles.list} ref={sortable.setContainer}>
        <For each={sortable.items()}>
          {(project) => (
            <ProjectChip
              project={project}
              groups={props.groups}
              sortable={sortable}
              onToggleWorking={() => props.onToggleWorking(project)}
              onMove={(groupId) => props.onMove(project, groupId)}
            />
          )}
        </For>
      </ul>
    </div>
  );
}

/** Green = in the working process, yellow = waiting. Zero counts are left out. */
function Tally(props: { projects: Project[] }): JSX.Element {
  const working = () => props.projects.filter((project) => project.is_working).length;
  const waiting = () => props.projects.length - working();
  return (
    <span class={styles.tally}>
      <Show when={working()}>
        <span class={styles.tallyPart} title={t('Working')}>
          <i class={`${styles.key} ${styles.keyOn}`} />
          {working()}
        </span>
      </Show>
      <Show when={waiting()}>
        <span class={styles.tallyPart} title={t('Waiting')}>
          <i class={styles.key} />
          {waiting()}
        </span>
      </Show>
    </span>
  );
}

function ProjectChip(props: {
  project: Project;
  groups: WorkGroup[];
  sortable: Sortable<Project>;
  onToggleWorking: () => void;
  onMove: (groupId: ID | null) => void;
}): JSX.Element {
  const name = () => tx('project', props.project.id, 'name', props.project.name);
  const canManage = () => props.project.capabilities.manage_project;
  const moveItems = (): MenuItem[] => [
    ...props.groups.map((group) => ({
      label: group.name,
      checked: props.project.work_group_id === group.id,
      onSelect: () => props.onMove(group.id),
    })),
    {
      label: t('No group'),
      separatorBefore: props.groups.length > 0,
      checked: props.project.work_group_id == null,
      onSelect: () => props.onMove(null),
    },
  ];
  return (
    <li
      class={[
        styles.chip,
        props.project.is_working ? styles.chipOn : styles.chipOff,
        props.sortable.isDragging(props.project) ? styles.chipDragging : '',
      ]
        .filter(Boolean)
        .join(' ')}
      {...props.sortable.itemProps(props.project)}
      style={props.sortable.itemStyle(props.project)}
    >
      <Show when={canManage()}>
        <button
          type="button"
          class={styles.grip}
          {...props.sortable.handleProps(props.project)}
          aria-label={t('Drag to reorder · arrow keys to move')}
          title={t('Drag to reorder · arrow keys to move')}
        >
          <GripVertical size={13} />
        </button>
      </Show>
      <A href={`/projects/${props.project.id}/overview`} class={styles.name} title={name()}>
        {name()}
      </A>
      <Show when={canManage()}>
        <Dropdown
          align="end"
          label={t('Move to…')}
          items={moveItems()}
          trigger={({ toggle }) => (
            <button type="button" class={styles.iconBtn} aria-label={t('Move to…')} title={t('Move to…')} onClick={toggle}>
              <FolderInput size={12} />
            </button>
          )}
        />
      </Show>
      <button
        type="button"
        class={[styles.dot, props.project.is_working ? styles.dotOn : ''].filter(Boolean).join(' ')}
        disabled={!canManage()}
        onClick={() => props.onToggleWorking()}
        aria-pressed={props.project.is_working}
        aria-label={
          props.project.is_working ? t('Set {name} to waiting', { name: name() }) : t('Mark {name} as working', { name: name() })
        }
        title={props.project.is_working ? t('Working — click to set waiting') : t('Waiting — click to mark working')}
      />
    </li>
  );
}
