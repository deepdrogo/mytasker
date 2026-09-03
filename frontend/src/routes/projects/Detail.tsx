import { A, useNavigate, useParams } from '@solidjs/router';
import { ArrowLeft, Clock, Pencil, Plus, UserPlus } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { createMemo, createSignal, For, Match, Show, Switch } from 'solid-js';
import { ApiError } from '~/api/client';
import { Badge, PriorityMark, ProgressBar } from '~/components/shared/Indicators';
import { Card, Page, PageSection } from '~/components/shared/Page';
import { Button } from '~/components/ui/Button';
import { ConfirmDialog, EmptyState, ErrorNote, Skeleton } from '~/components/ui/Feedback';
import { Field, Input, Select } from '~/components/ui/Input';
import { Modal } from '~/components/ui/Modal';
import { PolishButton } from '~/features/ai/PolishButton';
import { ActivityFeed } from '~/features/collab/ActivityFeed';
import { Comments } from '~/features/collab/Comments';
import { projectsApi } from '~/features/projects/api';
import { ProjectEditor } from '~/features/projects/ProjectEditor';
import { promptListKey, promptsApi } from '~/features/prompts/api';
import { PromptList } from '~/features/prompts/PromptList';
import { ShareDialog } from '~/features/sharing/ShareDialog';
import { taskListKey, tasksApi } from '~/features/tasks/api';
import { TaskComposer } from '~/features/tasks/TaskComposer';
import { TaskEditor } from '~/features/tasks/TaskEditor';
import { TaskList } from '~/features/tasks/TaskList';
import { TaskSelectionBar } from '~/features/tasks/TaskSelectionBar';
import { createQuery } from '~/hooks/createQuery';
import { t } from '~/i18n';
import { authStore } from '~/stores/auth';
import { tx } from '~/stores/translations';
import { toast } from '~/stores/ui';
import type { Project, ProjectMember, Role, Task } from '~/types';
import { formatDate, formatDuration, formatRelative } from '~/utils/format';
import styles from './Detail.module.css';

type Tab = 'overview' | 'tasks' | 'prompts' | 'team' | 'activity';
// Tasks lead: a project opens on the work itself, the overview is one tab over.
const TABS: Tab[] = ['tasks', 'overview', 'prompts', 'team', 'activity'];
const DEFAULT_TAB: Tab = 'tasks';

const STATUS_LABEL: Record<Project['status'], string> = {
  planned: 'Planned',
  active: 'Active',
  paused: 'Paused',
  completed: 'Completed',
  archived: 'Archived',
};

export default function ProjectDetail(): JSX.Element {
  const params = useParams<{ id: string; tab?: string }>();
  const navigate = useNavigate();
  const id = () => Number(params.id);
  const tab = (): Tab => {
    const current = (params.tab ?? '').split('/')[0] as Tab;
    return TABS.includes(current) ? current : DEFAULT_TAB;
  };

  const project = createQuery(
    () => `projects:detail:${id()}`,
    () => projectsApi.get(id()),
  );
  const [editing, setEditing] = createSignal(false);

  const tabs = createMemo(() => {
    const p = project.data();
    return [
      { label: t('Tasks'), href: `/projects/${id()}/tasks`, count: p?.open_tasks },
      { label: t('Overview'), href: `/projects/${id()}/overview` },
      { label: t('Prompts'), href: `/projects/${id()}/prompts`, count: p?.prompt_count },
      { label: t('Team'), href: `/projects/${id()}/team`, count: p?.member_count },
      { label: t('Activity'), href: `/projects/${id()}/activity` },
    ];
  });

  return (
    <Show
      when={!project.error()}
      fallback={
        <Page title={t('Project')}>
          <ErrorNote
            message={
              project.error() instanceof ApiError && (project.error() as ApiError).status === 404
                ? t('This project does not exist or you no longer have access.')
                : t('Could not load the project.')
            }
            onRetry={project.refetch}
          />
        </Page>
      }
    >
      <Show when={project.data()} fallback={<Skeleton rows={6} height={40} />}>
        {(p) => (
          <>
            <Page
              title={tx('project', p().id, 'name', p().name)}
              subtitle={tx('project', p().id, 'description', p().description) || undefined}
              tabs={tabs()}
              actions={
                <div class={styles.headActions}>
                  <A
                    href={p().category === 'startup' ? '/projects/startups' : p().kind === 'active' ? '/projects/active' : '/projects/all'}
                    class={styles.back}
                    aria-label={t('Back to projects')}
                  >
                    <ArrowLeft size={15} />
                  </A>
                  <Show when={p().mode !== 'private'}>
                    <Badge variant="outline">{p().mode === 'group_plus' ? t('Group Plus') : t('Group')}</Badge>
                  </Show>
                  <Show when={p().kind === 'active'}>
                    <Badge variant="solid">{t('Active')}</Badge>
                  </Show>
                  <Show when={p().category === 'startup'}>
                    <Badge variant="outline">{t('Startup')}</Badge>
                  </Show>
                  <Show when={p().capabilities.manage_project}>
                    <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                      <Pencil size={13} />
                      {t('Edit')}
                    </Button>
                  </Show>
                </div>
              }
            >
              <Switch>
                <Match when={tab() === 'overview'}>
                  <OverviewTab project={p()} />
                </Match>
                <Match when={tab() === 'tasks'}>
                  <TasksTab project={p()} />
                </Match>
                <Match when={tab() === 'prompts'}>
                  <PromptsTab project={p()} />
                </Match>
                <Match when={tab() === 'team'}>
                  <TeamTab project={p()} onLeft={() => navigate('/projects/all')} />
                </Match>
                <Match when={tab() === 'activity'}>
                  <div class={styles.narrow}>
                    <ActivityFeed project={p().id} />
                  </div>
                </Match>
              </Switch>
            </Page>

            <ProjectEditor
              open={editing()}
              project={p()}
              onClose={() => setEditing(false)}
              onSaved={() => project.refetch()}
              onDeleted={() => navigate('/projects/all')}
            />
          </>
        )}
      </Show>
    </Show>
  );
}

/* ------------------------------------------------------------------ Overview */

function OverviewTab(props: { project: Project }): JSX.Element {
  const overview = createQuery(
    () => `projects:overview:${props.project.id}`,
    () => projectsApi.overview(props.project.id),
  );
  const [activeTask, setActiveTask] = createSignal<Task | null>(null);

  return (
    <div class={styles.overview}>
      <div class={styles.statGrid}>
        <Card>
          <p class={styles.statLabel}>{t('Progress')}</p>
          {/* No tasks → nothing to measure, so no percentage or bar rather than a misleading 0%. */}
          <Show
            when={props.project.task_total > 0}
            fallback={
              <>
                <p class={[styles.statValue, 'mt-dim'].join(' ')}>–</p>
                <p class={styles.statHint}>{t('No tasks yet. Progress appears once you add one.')}</p>
              </>
            }
          >
            <p class={styles.statValue}>{props.project.progress}%</p>
            <ProgressBar value={props.project.task_done} max={props.project.task_total} />
            <p class={styles.statHint}>{t('{done} of {total} tasks done', { done: props.project.task_done, total: props.project.task_total })}</p>
          </Show>
        </Card>
        <Card>
          <p class={styles.statLabel}>{t('Open')}</p>
          <p class={styles.statValue}>{overview.data()?.stats.total !== undefined ? overview.data()!.stats.total - overview.data()!.stats.done : '–'}</p>
          <p class={styles.statHint}>
            {t('{active} in progress · {overdue} overdue', {
              active: overview.data()?.stats.in_progress ?? 0,
              overdue: overview.data()?.stats.overdue ?? 0,
            })}
          </p>
        </Card>
        <Card>
          <p class={styles.statLabel}>{t('Time tracked')}</p>
          <p class={[styles.statValue, 'mt-mono'].join(' ')}>{formatDuration(overview.data()?.tracked_seconds ?? props.project.tracked_seconds)}</p>
          <Show when={(overview.data()?.time_by_member.length ?? 0) > 1}>
            <ul class={styles.memberTime}>
              <For each={overview.data()?.time_by_member}>
                {(row) => (
                  <li>
                    <span>{row.display_name}</span>
                    <span class="mt-mono">{formatDuration(row.seconds)}</span>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </Card>
        <Card>
          <p class={styles.statLabel}>{t('Details')}</p>
          <dl class={styles.details}>
            <div>
              <dt>{t('Priority')}</dt>
              <dd>
                <PriorityMark priority={props.project.priority} withLabel />
              </dd>
            </div>
            <div>
              <dt>{t('Status')}</dt>
              <dd class={styles.capitalize}>{t(STATUS_LABEL[props.project.status])}</dd>
            </div>
            <Show when={props.project.start_date}>
              <div>
                <dt>{t('Start')}</dt>
                <dd>{formatDate(props.project.start_date)}</dd>
              </div>
            </Show>
            <Show when={props.project.deadline}>
              <div>
                <dt>{t('Deadline')}</dt>
                <dd>{formatDate(props.project.deadline)}</dd>
              </div>
            </Show>
            <div>
              <dt>{t('Owner')}</dt>
              <dd>{props.project.owner.display_name}</dd>
            </div>
          </dl>
        </Card>
      </div>

      <div class={styles.twoCol}>
        <PageSection title={t('Upcoming deadlines')}>
          <Show when={overview.data()} fallback={<Skeleton rows={3} />}>
            <TaskList
              tasks={overview.data()?.upcoming}
              compact
              onOpen={setActiveTask}
              emptyTitle={t('Nothing due soon')}
            />
          </Show>
        </PageSection>
        <PageSection title={t('Recent activity')}>
          <ActivityFeed project={props.project.id} compact limit={8} />
        </PageSection>
      </div>

      <Show when={props.project.notes}>
        <PageSection title={t('Notes')}>
          <Card>
            <p class={styles.notes}>{tx('project', props.project.id, 'notes', props.project.notes)}</p>
          </Card>
        </PageSection>
      </Show>

      <PageSection title={t('Discussion')}>
        <Comments project={props.project.id} canComment={props.project.capabilities.comment} />
      </PageSection>

      <TaskEditor task={activeTask()} open={activeTask() !== null} onClose={() => setActiveTask(null)} onChanged={() => overview.refetch()} />
    </div>
  );
}

/* --------------------------------------------------------------------- Tasks */

function TasksTab(props: { project: Project }): JSX.Element {
  const [filter, setFilter] = createSignal<'open' | 'all' | 'done'>('open');
  const [activeTask, setActiveTask] = createSignal<Task | null>(null);
  const [shareTasks, setShareTasks] = createSignal<Task[] | null>(null);
  const [selected, setSelected] = createSignal<Set<number>>(new Set());

  const params = () => ({
    project: props.project.id,
    top_level: true,
    status: filter() === 'open' ? 'todo,in_progress' : filter() === 'done' ? 'done' : undefined,
    ordering: filter() === 'done' ? '-completed' : 'manual',
    page_size: 200,
  });
  const query = createQuery(
    () => taskListKey(`project-${props.project.id}`, params()),
    () => tasksApi.list(params()),
  );

  const clearSelection = () => setSelected(new Set<number>());
  const toggleSelect = (task: Task) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(task.id)) next.delete(task.id);
      else next.add(task.id);
      return next;
    });
  const selectedTasks = () => (query.data()?.results ?? []).filter((task) => selected().has(task.id));

  return (
    <div class={styles.narrow}>
      <Show when={props.project.capabilities.create_task}>
        <TaskComposer
          defaults={{ project_id: props.project.id, kind: 'business', origin: 'project' }}
          placeholder={t('Add a task to {project}…', { project: tx('project', props.project.id, 'name', props.project.name) })}
          onCreated={() => query.refetch()}
        />
      </Show>
      <div class={styles.filterRow}>
        <For each={['open', 'all', 'done'] as const}>
          {(value) => (
            <button
              type="button"
              class={[styles.chip, filter() === value ? styles.chipActive : ''].join(' ')}
              onClick={() => setFilter(value)}
            >
              {value === 'open' ? t('Open') : value === 'all' ? t('All') : t('Completed')}
            </button>
          )}
        </For>
        <Show when={filter() !== 'done'}>
          <div class={styles.filterSpacer} />
          <PolishButton
            variant="ghost"
            taskIds={() => (query.data()?.results ?? []).filter((task) => task.can_edit && task.status !== 'done').map((task) => task.id)}
            label={t('Polish all with AI')}
            onChanged={() => query.refetch()}
          />
        </Show>
      </div>
      <TaskSelectionBar
        tasks={selectedTasks}
        onChanged={() => query.refetch()}
        onClear={clearSelection}
        onShare={setShareTasks}
      />
      <TaskList
        tasks={query.data()?.results}
        loading={query.loading()}
        error={query.error()}
        onRetry={query.refetch}
        onOpen={setActiveTask}
        onShare={(task) => setShareTasks([task])}
        onChanged={query.refetch}
        selectable
        selectedIds={selected()}
        onToggleSelect={toggleSelect}
        emptyTitle={filter() === 'done' ? t('Nothing completed yet') : t('No open tasks')}
        emptyHint={filter() === 'done' ? undefined : t('Add the next concrete step above.')}
      />
      <TaskEditor
        task={activeTask()}
        open={activeTask() !== null}
        onClose={() => setActiveTask(null)}
        onChanged={() => {
          query.refetch();
          const current = activeTask();
          if (current) void tasksApi.get(current.id).then(setActiveTask).catch(() => setActiveTask(null));
        }}
        onShare={(task) => setShareTasks([task])}
      />
      <ShareDialog
        tasks={shareTasks()}
        open={shareTasks() !== null}
        onClose={() => {
          setShareTasks(null);
          clearSelection();
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------- Prompts */

function PromptsTab(props: { project: Project }): JSX.Element {
  const navigate = useNavigate();
  const params = () => ({ project: props.project.id, page_size: 100, ordering: '-updated' });
  const query = createQuery(
    () => promptListKey(`project-${props.project.id}`, params()),
    () => promptsApi.list(params()),
  );

  return (
    <div class={styles.narrow}>
      <div class={styles.sectionBar}>
        <p class="mt-dim">
          {t('Prompts linked to this project.')}{' '}
          <Show when={props.project.mode === 'group_plus'}>{t('Private prompts stay visible only to their owner.')}</Show>
        </p>
        <Show when={props.project.capabilities.edit_shared_prompts}>
          <Button size="sm" onClick={() => navigate(`/prompts/new?project=${props.project.id}`)}>
            <Plus size={14} />
            {t('New prompt')}
          </Button>
        </Show>
      </div>
      <PromptList
        prompts={query.data()?.results}
        loading={query.loading()}
        error={query.error()}
        onRetry={query.refetch}
        onChanged={query.refetch}
        showProject={false}
        emptyTitle={t('No prompts here yet')}
        emptyHint={t('Prompts created from this tab are linked to the project automatically.')}
      />
    </div>
  );
}

/* ---------------------------------------------------------------------- Team */

const ROLE_LABEL: Record<Role, string> = { owner: 'Owner', admin: 'Admin', member: 'Member', viewer: 'Viewer' };

function TeamTab(props: { project: Project; onLeft: () => void }): JSX.Element {
  const members = createQuery(
    () => `projects:members:${props.project.id}`,
    () => projectsApi.members(props.project.id),
  );
  const [inviting, setInviting] = createSignal(false);
  const [email, setEmail] = createSignal('');
  const [role, setRole] = createSignal<Role>('member');
  const [inviteUrl, setInviteUrl] = createSignal('');
  const [error, setError] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [removing, setRemoving] = createSignal<ProjectMember | null>(null);
  const [leaving, setLeaving] = createSignal(false);

  const canManage = () => props.project.capabilities.manage_members;
  const me = () => authStore.user()?.id;

  const roleHint = () => {
    if (role() === 'admin') return t('Can manage members and the project.');
    if (role() === 'viewer') return t('Read only.');
    return t('Can add and edit tasks, prompts and comments.');
  };

  const invite = async (event: Event) => {
    event.preventDefault();
    if (busy()) return;
    setBusy(true);
    setError('');
    try {
      const result = await projectsApi.invite(props.project.id, email().trim(), role());
      setInviteUrl(result.invite_url);
      setEmail('');
      members.refetch();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('Could not send the invitation.'));
    } finally {
      setBusy(false);
    }
  };

  const changeRole = async (member: ProjectMember, next: Role) => {
    try {
      await projectsApi.changeRole(props.project.id, member.id, next);
      members.refetch();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('Could not change the role.'));
    }
  };

  const remove = async () => {
    const member = removing();
    if (!member) return;
    try {
      await projectsApi.removeMember(props.project.id, member.id);
      members.refetch();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('Could not remove the member.'));
    } finally {
      setRemoving(null);
    }
  };

  const leave = async () => {
    try {
      await projectsApi.leave(props.project.id);
      toast(t('You left the project'));
      props.onLeft();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('Could not leave.'));
    } finally {
      setLeaving(false);
    }
  };

  return (
    <div class={styles.narrow}>
      <Show
        when={props.project.mode !== 'private'}
        fallback={
          <EmptyState
            title={t('This is a private project')}
            hint={t('Switch it to Group or Group Plus in the project settings to invite people.')}
          />
        }
      >
        <div class={styles.sectionBar}>
          <p class="mt-dim">
            {props.project.mode === 'group_plus'
              ? t('Group Plus: shared workspace where members may also keep private items.')
              : t('Group: everything in the project is visible to all members.')}
          </p>
          <Show when={canManage()}>
            <Button size="sm" onClick={() => setInviting(true)}>
              <UserPlus size={14} />
              {t('Invite')}
            </Button>
          </Show>
        </div>

        <Show when={!members.error()} fallback={<ErrorNote message={t('Could not load members.')} onRetry={members.refetch} />}>
          <Show when={members.data()} fallback={<Skeleton rows={3} height={48} />}>
            {(list) => (
              <ul class={styles.members}>
                <For each={list()}>
                  {(member) => (
                    <li class={styles.member}>
                      <div class={styles.memberMain}>
                        <span class={styles.memberName}>
                          {member.user?.display_name ?? member.invited_email}
                          <Show when={member.user?.id === me()}>
                            <span class="mt-dim"> ({t('you')})</span>
                          </Show>
                        </span>
                        <span class={styles.memberSub}>
                          <Show when={member.accepted_at} fallback={<Badge variant="dashed">{t('Invited · pending')}</Badge>}>
                            {t('{email} · joined {time}', {
                              email: member.user?.email ?? member.invited_email,
                              time: formatRelative(member.accepted_at),
                            })}
                          </Show>
                        </span>
                      </div>
                      <Show
                        when={canManage() && member.role !== 'owner' && member.user?.id !== me()}
                        fallback={<Badge variant="outline">{t(ROLE_LABEL[member.role])}</Badge>}
                      >
                        <Select
                          sizeVariant="sm"
                          value={member.role}
                          onChange={(e) => void changeRole(member, e.currentTarget.value as Role)}
                          aria-label={t('Role')}
                        >
                          <option value="admin">{t('Admin')}</option>
                          <option value="member">{t('Member')}</option>
                          <option value="viewer">{t('Viewer')}</option>
                        </Select>
                        <Button variant="ghost" size="sm" onClick={() => setRemoving(member)}>
                          {t('Remove')}
                        </Button>
                      </Show>
                    </li>
                  )}
                </For>
              </ul>
            )}
          </Show>
        </Show>

        <Show when={props.project.role && props.project.role !== 'owner'}>
          <div class={styles.leaveRow}>
            <Button variant="ghost" size="sm" onClick={() => setLeaving(true)}>
              {t('Leave project')}
            </Button>
          </div>
        </Show>
      </Show>

      <Modal
        open={inviting()}
        onClose={() => {
          setInviting(false);
          setInviteUrl('');
          setError('');
        }}
        title={t('Invite to project')}
        description={t('They will receive an email. You can also copy the link below and send it yourself.')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setInviting(false)}>
              {t('Close')}
            </Button>
            <Button onClick={invite} loading={busy()} disabled={!email().trim()}>
              {t('Send invitation')}
            </Button>
          </>
        }
      >
        <form class={styles.inviteForm} onSubmit={invite}>
          <Field label={t('Email')} error={error()} required>
            <Input type="email" value={email()} onInput={(e) => setEmail(e.currentTarget.value)} autofocus />
          </Field>
          <Field label={t('Role')} hint={roleHint()}>
            <Select value={role()} onChange={(e) => setRole(e.currentTarget.value as Role)}>
              <option value="admin">{t('Admin')}</option>
              <option value="member">{t('Member')}</option>
              <option value="viewer">{t('Viewer')}</option>
            </Select>
          </Field>
          <Show when={inviteUrl()}>
            <Field label={t('Invitation link')} hint={t('Valid for 7 days. Single use.')}>
              <Input readOnly value={inviteUrl()} onFocus={(e) => e.currentTarget.select()} />
            </Field>
          </Show>
        </form>
      </Modal>

      <ConfirmDialog
        open={removing() !== null}
        title={t('Remove this member?')}
        message={t('They lose access immediately. Tasks they created stay in the project.')}
        confirmLabel={t('Remove')}
        destructive
        onConfirm={remove}
        onCancel={() => setRemoving(null)}
      />
      <ConfirmDialog
        open={leaving()}
        title={t('Leave this project?')}
        message={t('You will need a new invitation to come back.')}
        confirmLabel={t('Leave')}
        destructive
        onConfirm={leave}
        onCancel={() => setLeaving(false)}
      />
    </div>
  );
}

export function TrackedTime(props: { seconds: number }): JSX.Element {
  return (
    <span class={styles.tracked}>
      <Clock size={12} />
      <span class="mt-mono">{formatDuration(props.seconds)}</span>
    </span>
  );
}
