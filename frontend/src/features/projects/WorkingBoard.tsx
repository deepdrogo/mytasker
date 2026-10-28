// MyTasker — Working projects board. A dense board of the projects in progress, sorted into groups you name.
// The Working page shows every live project and manages the groups; the Dashboard shows only those in work.

import { A } from '@solidjs/router';
import { FolderInput, GripVertical, Plus, Trash2 } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { createEffect, createMemo, createSignal, For, Show } from 'solid-js';
import { Dropdown, type MenuItem } from '~/components/ui/Dropdown';
import { ConfirmDialog, EmptyState, ErrorNote, Skeleton } from '~/components/ui/Feedback';
import { projectsApi, workGroupsApi, type WorkGroup } from '~/features/projects/api';
import { createQuery } from '~/hooks/createQuery';
import { createSortable, type Sortable } from '~/hooks/createSortable';
import { t } from '~/i18n';
import { tx } from '~/stores/translations';
import { toast } from '~/stores/ui';
import type { ID, Project, WorkState } from '~/types';
import styles from './WorkingBoard.module.css';

/** Tapping the dot walks the cycle: waiting (yellow) → active (orange) → working (green) → waiting. */
const NEXT_STATE: Record<WorkState, WorkState> = { waiting: 'active', active: 'working', working: 'waiting' };
const STATE_ORDER: WorkState[] = ['working', 'active', 'waiting'];
const STATE_LABEL: Record<WorkState, string> = { working: 'Working', active: 'Active', waiting: 'Waiting' };
const STATE_COUNT: Record<WorkState, string> = { working: '{count} working', active: '{count} active', waiting: '{count} waiting' };
const STATE_KEY: Record<WorkState, string> = { working: styles.keyWorking!, active: styles.keyActive!, waiting: '' };
const STATE_CHIP: Record<WorkState, string> = { working: styles.chipWorking!, active: styles.chipActive!, waiting: styles.chipWaiting! };
const STATE_DOT: Record<WorkState, string> = { working: styles.dotWorking!, active: styles.dotActive!, waiting: '' };
const STATE_TITLE: Record<WorkState, string> = {
  waiting: 'Waiting — click for Active',
  active: 'Active — click for Working',
  working: 'Working — click for Waiting',
};

const countIn = (projects: Project[], state: WorkState) => projects.filter((project) => project.work_state === state).length;

export function WorkingBoard(props: {
  /** Show only projects in this state. Groups are then read-only and empty groups are hidden. */
  only?: WorkState;
  /** Reports how many projects the board shows, for a heading outside it. */
  onCount?: (count: number) => void;
}): JSX.Element {
  const projectsQuery = createQuery(
    () => 'projects:working-catalog',
    () => projectsApi.list({ page_size: 200, ordering: 'manual' }),
  );
  const groupsQuery = createQuery(() => 'work-groups', () => workGroupsApi.list());

  const manageGroups = () => !props.only;
  const projects = () => projectsQuery.data()?.results ?? [];
  /** Archived and finished projects stay on All. This board is the live shelf. */
  const visible = createMemo(() =>
    projects().filter(
      (project) => project.status !== 'archived' && project.status !== 'completed' && (!props.only || project.work_state === props.only),
    ),
  );
  createEffect(() => props.onCount?.(visible().length));
  const groups = () => groupsQuery.data() ?? [];
  const inGroup = (id: ID) => visible().filter((project) => project.work_group_id === id);
  const ungrouped = createMemo(() => visible().filter((project) => project.work_group_id == null));
  const filledGroups = createMemo(() => groups().filter((group) => inGroup(group.id).length > 0));

  const [draft, setDraft] = createSignal('');
  const [creating, setCreating] = createSignal(false);

  const patch = (id: ID, partial: Partial<Project>) => {
    projectsQuery.mutate((prev) =>
      prev ? { ...prev, results: prev.results.map((project) => (project.id === id ? { ...project, ...partial } : project)) } : prev,
    );
  };

  const cycleState = async (project: Project) => {
    if (!project.capabilities.manage_project) return;
    const previous = project.work_state;
    const next = NEXT_STATE[previous];
    patch(project.id, { work_state: next, is_working: next === 'working' });
    try {
      await projectsApi.setWorkState(project.id, next);
    } catch {
      patch(project.id, { work_state: previous, is_working: previous === 'working' });
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
    enabled: () => manageGroups() && groups().length > 1,
    onReorder: (arranged) => void saveGroupOrder(arranged),
  });

  const loaded = () => projectsQuery.data() && groupsQuery.data();

  return (
    <Show
      when={!projectsQuery.error() && !groupsQuery.error()}
      fallback={<ErrorNote message={t('Could not load projects.')} onRetry={() => { projectsQuery.refetch(); groupsQuery.refetch(); }} />}
    >
      <Show when={loaded()} fallback={<Skeleton rows={4} height={28} />}>
        <Show
          when={visible().length > 0}
          fallback={
            <Show
              when={props.only}
              fallback={<EmptyState icon={<FolderInput size={22} />} title={t('No projects yet')} hint={t('Create a project to see it here.')} />}
            >
              <p class={styles.empty}>{t('No project is in work right now. Turn a dot green on Working projects.')}</p>
            </Show>
          }
        >
          <div class={styles.board}>
            <Show when={manageGroups()}>
              <div class={styles.hero}>
                <p class={styles.total}>
                  <For each={STATE_ORDER}>
                    {(state) => (
                      <span class={[styles.totalPart, state === 'working' ? '' : styles.totalQuiet].filter(Boolean).join(' ')}>
                        <i class={[styles.key, STATE_KEY[state]].filter(Boolean).join(' ')} />
                        {t(STATE_COUNT[state], { count: countIn(visible(), state) })}
                      </span>
                    )}
                  </For>
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
            </Show>

            <Show
              when={manageGroups()}
              fallback={
                <div class={styles.shelves}>
                  <For each={filledGroups()}>
                    {(group) => (
                      <ProjectGrid
                        label={group.name}
                        projects={inGroup(group.id)}
                        groups={groups()}
                        onReorder={saveOrder}
                        onCycleState={cycleState}
                        onMove={moveTo}
                      />
                    )}
                  </For>
                </div>
              }
            >
              <div class={styles.shelves} ref={groupSortable.setContainer}>
                <For each={groupSortable.items()}>
                  {(group) => (
                    <GroupShelf
                      group={group}
                      projects={inGroup(group.id)}
                      groups={groups()}
                      sortable={groupSortable}
                      onReorder={saveOrder}
                      onCycleState={cycleState}
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
            </Show>

            <Show when={ungrouped().length > 0}>
              <ProjectGrid
                label={manageGroups() || filledGroups().length > 0 ? t('No group') : undefined}
                projects={ungrouped()}
                groups={groups()}
                onReorder={saveOrder}
                onCycleState={cycleState}
                onMove={moveTo}
              />
            </Show>
          </div>
        </Show>
      </Show>
    </Show>
  );
}

function GroupShelf(props: {
  group: WorkGroup;
  projects: Project[];
  groups: WorkGroup[];
  sortable: Sortable<WorkGroup>;
  onReorder: (projects: Project[]) => void;
  onCycleState: (project: Project) => void;
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
        onCycleState={props.onCycleState}
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
  onCycleState: (project: Project) => void;
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
              onCycleState={() => props.onCycleState(project)}
              onMove={(groupId) => props.onMove(project, groupId)}
            />
          )}
        </For>
      </ul>
    </div>
  );
}

/** Green working, orange active, yellow waiting. Zero counts are left out. */
function Tally(props: { projects: Project[] }): JSX.Element {
  return (
    <span class={styles.tally}>
      <For each={STATE_ORDER}>
        {(state) => (
          <Show when={countIn(props.projects, state)}>
            <span class={styles.tallyPart} title={t(STATE_LABEL[state])}>
              <i class={[styles.key, STATE_KEY[state]].filter(Boolean).join(' ')} />
              {countIn(props.projects, state)}
            </span>
          </Show>
        )}
      </For>
    </span>
  );
}

function ProjectChip(props: {
  project: Project;
  groups: WorkGroup[];
  sortable: Sortable<Project>;
  onCycleState: () => void;
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
        STATE_CHIP[props.project.work_state],
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
        class={[styles.dot, STATE_DOT[props.project.work_state]].filter(Boolean).join(' ')}
        disabled={!canManage()}
        onClick={() => props.onCycleState()}
        aria-label={t('{name}: {state}. Click to switch to {next}.', {
          name: name(),
          state: t(STATE_LABEL[props.project.work_state]),
          next: t(STATE_LABEL[NEXT_STATE[props.project.work_state]]),
        })}
        title={t(STATE_TITLE[props.project.work_state])}
      />
    </li>
  );
}
