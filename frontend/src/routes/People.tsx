// MyTasker — People: hand work to other accounts and see, per person, what is open and what got done.
// Built by drogoz · https://github.com/deepdrogo/mytasker

import { Navigate } from '@solidjs/router';
import { Check, Handshake, Pencil, Plus, Search, Trash2, UserPlus, Users, X } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { createEffect, createMemo, createSignal, For, on, Show } from 'solid-js';
import { ApiError } from '~/api/client';
import { Page } from '~/components/shared/Page';
import { Button } from '~/components/ui/Button';
import { DateTimeInput } from '~/components/ui/DateTimeInput';
import { ConfirmDialog, EmptyState, ErrorNote, Skeleton } from '~/components/ui/Feedback';
import { Input, Select } from '~/components/ui/Input';
import { peopleApi, type PersonCandidate } from '~/features/people/api';
import { ProjectSelector } from '~/features/projects/ProjectSelector';
import { ShareDialog } from '~/features/sharing/ShareDialog';
import { tasksApi, taskListKey, type TaskListParams } from '~/features/tasks/api';
import { TaskEditor } from '~/features/tasks/TaskEditor';
import { TaskList } from '~/features/tasks/TaskList';
import { TaskSelectionBar } from '~/features/tasks/TaskSelectionBar';
import { createQuery } from '~/hooks/createQuery';
import { t } from '~/i18n';
import { authStore } from '~/stores/auth';
import { toast } from '~/stores/ui';
import type { ID, Person, Task, TaskKind } from '~/types';
import { cx } from '~/utils/cx';
import { formatDate, fromLocalInputValue } from '~/utils/format';
import styles from './People.module.css';

type Filter = 'open' | 'done';

export default function People(): JSX.Element {
  if (!authStore.isAdmin()) return <Navigate href="/dashboard" />;

  const people = createQuery(() => 'people:list', () => peopleApi.list());
  const [selectedId, setSelectedId] = createSignal<ID | null>(null);
  const [adding, setAdding] = createSignal(false);

  const list = () => people.data() ?? [];
  const selected = createMemo(() => list().find((person) => person.id === selectedId()) ?? list()[0] ?? null);

  return (
    <Page
      title={t('People')}
      subtitle={t('Hand tasks to other accounts. They see them at once - on their Dashboard and on a page named after you.')}
      actions={
        <Button variant="primary" size="sm" onClick={() => setAdding(true)}>
          <UserPlus size={14} />
          {t('Add person')}
        </Button>
      }
    >
      <Show when={!people.error()} fallback={<ErrorNote message={t('Could not load people.')} onRetry={people.refetch} />}>
        <Show when={people.data()} fallback={<Skeleton rows={4} height={48} />}>
          <Show
            when={list().length > 0 || adding()}
            fallback={
              <EmptyState
                icon={<Users size={20} />}
                title={t('Nobody here yet.')}
                hint={t('Add an account by e-mail, then hand them tasks. Only you can do this.')}
                action={
                  <Button variant="primary" size="sm" onClick={() => setAdding(true)}>
                    <UserPlus size={14} />
                    {t('Add person')}
                  </Button>
                }
              />
            }
          >
            <div class={styles.layout}>
              <aside class={styles.side}>
                <Show when={adding()}>
                  <AddPersonCard
                    onClose={() => setAdding(false)}
                    onAdded={(person) => {
                      setSelectedId(person.id);
                      setAdding(false);
                    }}
                  />
                </Show>
                <ul class={styles.people} role="list">
                  <For each={list()}>
                    {(person) => (
                      <li>
                        <button
                          type="button"
                          class={cx(styles.person, selected()?.id === person.id && styles.personActive)}
                          onClick={() => setSelectedId(person.id)}
                          aria-current={selected()?.id === person.id ? 'true' : undefined}
                        >
                          <span class={styles.avatar} aria-hidden="true">
                            {person.user.display_name.charAt(0).toUpperCase()}
                          </span>
                          <span class={styles.personText}>
                            <span class={styles.personName}>{person.user.display_name}</span>
                            <span class={styles.personNote}>{person.note || person.user.email}</span>
                          </span>
                          <span class={styles.personCounts}>
                            <span class={styles.countOpen} title={t('Open')}>
                              {person.open_count}
                            </span>
                            <span class={styles.countDone} title={t('Completed')}>
                              <Check size={9} /> {person.done_count}
                            </span>
                          </span>
                        </button>
                      </li>
                    )}
                  </For>
                </ul>
              </aside>

              <Show when={selected()} fallback={<p class={styles.dim}>{t('Pick a person on the left.')}</p>}>
                {(person) => <PersonDetail person={person()} onRemoved={() => setSelectedId(null)} />}
              </Show>
            </div>
          </Show>
        </Show>
      </Show>
    </Page>
  );
}

/** Search accounts by e-mail / name and add one with an optional note ("assistant", "PC builds", ...). */
function AddPersonCard(props: { onClose: () => void; onAdded: (person: Person) => void }): JSX.Element {
  const [query, setQuery] = createSignal('');
  const [note, setNote] = createSignal('');
  const [results, setResults] = createSignal<PersonCandidate[]>([]);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  let debounce: number | undefined;
  let abort: AbortController | undefined;

  createEffect(
    on(query, (q) => {
      window.clearTimeout(debounce);
      abort?.abort();
      const term = q.trim();
      if (term.length < 2) {
        setResults([]);
        return;
      }
      debounce = window.setTimeout(async () => {
        abort = new AbortController();
        try {
          setResults(await peopleApi.search(term, abort.signal));
        } catch {
          /* aborted */
        }
      }, 120);
    }),
  );

  const add = async (candidate?: PersonCandidate) => {
    if (busy()) return;
    const input = candidate ? { user_id: candidate.id, note: note().trim() } : { email: query().trim(), note: note().trim() };
    if (!candidate && !input.email) return;
    setBusy(true);
    setError('');
    try {
      const person = await peopleApi.add(input);
      toast(t('{name} added to People', { name: person.user.display_name }));
      props.onAdded(person);
    } catch (err) {
      setError(err instanceof ApiError ? (err.fieldError('email') ?? err.message) : t('Could not add this person.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      class={styles.addCard}
      onSubmit={(event) => {
        event.preventDefault();
        void add(results()[0]);
      }}
    >
      <div class={styles.addHead}>
        <span>{t('Add person')}</span>
        <button type="button" class={styles.iconBtn} onClick={props.onClose} aria-label={t('Close')}>
          <X size={14} />
        </button>
      </div>
      <div class={styles.searchField}>
        <Search size={13} />
        <Input
          sizeVariant="sm"
          value={query()}
          onInput={(event) => setQuery(event.currentTarget.value)}
          placeholder={t('E-mail or name of an existing account')}
          autofocus
          autocomplete="off"
        />
      </div>
      <Input
        sizeVariant="sm"
        value={note()}
        onInput={(event) => setNote(event.currentTarget.value)}
        placeholder={t('Note, e.g. “Nino - assistant”')}
        maxLength={120}
      />
      <Show when={error()}>
        <p class={styles.error}>{error()}</p>
      </Show>
      <Show when={results().length > 0}>
        <ul class={styles.candidates} role="listbox">
          <For each={results()}>
            {(candidate) => (
              <li>
                <button type="button" class={styles.candidate} onClick={() => void add(candidate)} disabled={busy()}>
                  <span class={styles.avatar} aria-hidden="true">
                    {candidate.display_name.charAt(0).toUpperCase()}
                  </span>
                  <span class={styles.personText}>
                    <span class={styles.personName}>{candidate.display_name}</span>
                    <span class={styles.personNote}>{candidate.email}</span>
                  </span>
                  <Plus size={13} />
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <Show when={results().length === 0 && query().trim().length >= 2}>
        <p class={styles.dim}>{t('No account matches. Type the exact e-mail and press Enter.')}</p>
      </Show>
      <Show when={results().length === 0 && query().includes('@')}>
        <Button type="submit" variant="secondary" size="sm" loading={busy()}>
          {t('Add {email}', { email: query().trim() })}
        </Button>
      </Show>
    </form>
  );
}

function PersonDetail(props: { person: Person; onRemoved: () => void }): JSX.Element {
  const [filter, setFilter] = createSignal<Filter>('open');
  const [selected, setSelected] = createSignal<Set<number>>(new Set());
  const [activeTask, setActiveTask] = createSignal<Task | null>(null);
  const [shareTasks, setShareTasks] = createSignal<Task[] | null>(null);
  const [editingNote, setEditingNote] = createSignal(false);
  const [noteDraft, setNoteDraft] = createSignal('');
  const [confirmRemove, setConfirmRemove] = createSignal(false);

  const params = (): TaskListParams => ({
    assignee: props.person.user.id,
    mine: true,
    top_level: true,
    completed: filter() === 'done',
    ordering: filter() === 'done' ? '-completed' : 'priority',
    include_subtasks: '1',
    page_size: 200,
  });
  const query = createQuery(
    () => taskListKey(`person-${props.person.user.id}`, params()),
    () => tasksApi.list(params()),
  );
  const tasks = () => query.data()?.results ?? [];
  const refresh = () => query.refetch();

  const toggleSelect = (task: Task) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(task.id)) next.delete(task.id);
      else next.add(task.id);
      return next;
    });

  const saveNote = async () => {
    try {
      await peopleApi.update(props.person.id, noteDraft().trim());
      setEditingNote(false);
    } catch {
      toast(t('Could not save the note.'));
    }
  };

  const remove = async () => {
    try {
      await peopleApi.remove(props.person.id);
      toast(t('{name} removed. Open tasks are yours again.', { name: props.person.user.display_name }));
      props.onRemoved();
    } catch {
      toast(t('Could not remove this person.'));
    } finally {
      setConfirmRemove(false);
    }
  };

  return (
    <section class={styles.detail} aria-label={props.person.user.display_name}>
      <header class={styles.detailHead}>
        <span class={cx(styles.avatar, styles.avatarLg)} aria-hidden="true">
          {props.person.user.display_name.charAt(0).toUpperCase()}
        </span>
        <div class={styles.detailText}>
          <h2 class={styles.detailName}>{props.person.user.display_name}</h2>
          <Show
            when={editingNote()}
            fallback={
              <button
                type="button"
                class={styles.noteBtn}
                onClick={() => {
                  setNoteDraft(props.person.note);
                  setEditingNote(true);
                }}
                title={t('Edit note')}
              >
                <span>{props.person.note || props.person.user.email}</span>
                <Pencil size={11} />
              </button>
            }
          >
            <form
              class={styles.noteForm}
              onSubmit={(event) => {
                event.preventDefault();
                void saveNote();
              }}
            >
              <Input
                sizeVariant="sm"
                value={noteDraft()}
                onInput={(event) => setNoteDraft(event.currentTarget.value)}
                maxLength={120}
                autofocus
                onKeyDown={(event) => event.key === 'Escape' && setEditingNote(false)}
              />
              <Button type="submit" variant="secondary" size="sm">
                {t('Save')}
              </Button>
            </form>
          </Show>
          <p class={styles.detailMeta}>
            {props.person.user.email}
            <Show when={props.person.last_assigned_at}>
              {(at) => <> · {t('last handed {date}', { date: formatDate(at()) })}</>}
            </Show>
          </p>
        </div>
        <div class={styles.detailActions}>
          <div class={styles.filters} role="tablist" aria-label={t('Show')}>
            <For each={['open', 'done'] as const}>
              {(value) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={filter() === value}
                  class={cx(styles.chip, filter() === value && styles.chipActive)}
                  onClick={() => {
                    setFilter(value);
                    setSelected(new Set<number>());
                  }}
                >
                  {value === 'open' ? `${t('Open')} · ${props.person.open_count}` : `${t('Completed')} · ${props.person.done_count}`}
                </button>
              )}
            </For>
          </div>
          <Button variant="ghost" size="icon" onClick={() => setConfirmRemove(true)} aria-label={t('Remove person')} title={t('Remove person')}>
            <Trash2 size={14} />
          </Button>
        </div>
      </header>

      <DelegateComposer person={props.person} onCreated={refresh} />

      <TaskSelectionBar
        tasks={() => tasks().filter((task) => selected().has(task.id))}
        total={() => tasks().length}
        onSelectAll={() => setSelected(new Set(tasks().map((task) => task.id)))}
        onChanged={refresh}
        onClear={() => setSelected(new Set<number>())}
        onShare={setShareTasks}
      />

      <TaskList
        tasks={query.data()?.results}
        loading={query.loading()}
        error={query.error()}
        onRetry={refresh}
        onOpen={setActiveTask}
        onShare={(task) => setShareTasks([task])}
        onChanged={refresh}
        showProject
        showKind
        showCreated
        selectable
        selectedIds={selected()}
        onToggleSelect={toggleSelect}
        emptyTitle={filter() === 'done' ? t('Nothing completed yet.') : t('Nothing handed to {name} yet.', { name: props.person.user.display_name })}
        emptyHint={filter() === 'done' ? undefined : t('Type a task above. It shows up for them right away.')}
      />

      <TaskEditor
        task={activeTask()}
        open={activeTask() !== null}
        onClose={() => setActiveTask(null)}
        onChanged={() => {
          refresh();
          const current = activeTask();
          if (current) void tasksApi.get(current.id).then(setActiveTask).catch(() => setActiveTask(null));
        }}
        onShare={(task) => setShareTasks([task])}
        onOpenTask={(task) => void tasksApi.get(task.id).then(setActiveTask).catch(() => setActiveTask(task))}
      />
      <ShareDialog
        tasks={shareTasks()}
        open={shareTasks() !== null}
        onClose={() => {
          setShareTasks(null);
          setSelected(new Set<number>());
        }}
      />
      <ConfirmDialog
        open={confirmRemove()}
        title={t('Remove {name} from People?', { name: props.person.user.display_name })}
        message={t('Open tasks come back to you unassigned; completed ones keep their history. Their account is untouched.')}
        confirmLabel={t('Remove')}
        destructive
        onConfirm={() => void remove()}
        onCancel={() => setConfirmRemove(false)}
      />
    </section>
  );
}

const KINDS: Array<{ value: TaskKind; label: string }> = [
  { value: 'business', label: 'Business' },
  { value: 'personal', label: 'Personal' },
];

/** One line to hand a task over: title, category, optional project / deadline, client flag. Enter keeps focus. */
function DelegateComposer(props: { person: Person; onCreated: () => void }): JSX.Element {
  const [title, setTitle] = createSignal('');
  const [kind, setKind] = createSignal<TaskKind>('business');
  const [projectId, setProjectId] = createSignal<ID | null>(null);
  const [dueAt, setDueAt] = createSignal('');
  const [isClient, setIsClient] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  let input: HTMLInputElement | undefined;

  const submit = async (event?: Event) => {
    event?.preventDefault();
    const value = title().trim();
    if (!value || busy()) return;
    setBusy(true);
    try {
      await tasksApi.create({
        title: value,
        kind: kind(),
        project_id: projectId(),
        assignee_id: props.person.user.id,
        is_client: isClient(),
        due_at: fromLocalInputValue(dueAt()),
        due_has_time: false,
      });
      setTitle('');
      toast(t('Handed to {name}', { name: props.person.user.display_name }));
      props.onCreated();
      input?.focus();
    } catch (err) {
      toast(err instanceof ApiError ? (err.fieldError('assignee') ?? err.fieldError('title') ?? err.message) : t('Could not create the task.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form class={styles.composer} onSubmit={submit}>
      <div class={styles.composerRow}>
        <span class={styles.composerIcon} aria-hidden="true">
          <Plus size={14} />
        </span>
        <Input
          ref={input}
          class={styles.composerInput}
          value={title()}
          onInput={(event) => setTitle(event.currentTarget.value)}
          placeholder={t('Hand a task to {name}…', { name: props.person.user.display_name })}
          aria-label={t('Hand a task to {name}…', { name: props.person.user.display_name })}
          maxLength={300}
        />
        <Show when={title().trim()}>
          <Button type="submit" variant="primary" size="sm" loading={busy()}>
            {t('Hand over')}
          </Button>
        </Show>
      </div>
      <div class={styles.composerOptions}>
        <Select sizeVariant="sm" value={kind()} onChange={(event) => setKind(event.currentTarget.value as TaskKind)} aria-label={t('Category')}>
          <For each={KINDS}>{(option) => <option value={option.value}>{t(option.label)}</option>}</For>
        </Select>
        <ProjectSelector value={projectId()} onChange={setProjectId} />
        <DateTimeInput value={dueAt()} onChange={setDueAt} dateOnly sizeVariant="sm" defaultTime="23:59" />
        <button
          type="button"
          class={cx(styles.toggle, isClient() && styles.toggleOn)}
          onClick={() => setIsClient((value) => !value)}
          aria-pressed={isClient()}
          title={t('Client task - pinned to the top, listed on Clients')}
        >
          <Handshake size={12} />
          {t('Client')}
        </button>
      </div>
    </form>
  );
}
