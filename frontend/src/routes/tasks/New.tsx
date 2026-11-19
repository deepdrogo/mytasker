// MyTasker — Add task: a calm full form. Pick the project (or Personal / Business), the kind of work, the day and
// the priority, write the title, press Enter. The choices stay, so a run of tasks for one project is quick.

import { Briefcase, Check, Flag, Handshake, Megaphone, User } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { createSignal, For, Show } from 'solid-js';
import { ApiError } from '~/api/client';
import { Page } from '~/components/shared/Page';
import { Button } from '~/components/ui/Button';
import { Input, Textarea } from '~/components/ui/Input';
import { ProjectAvatar } from '~/features/projects/ProjectAvatar';
import { tasksApi } from '~/features/tasks/api';
import { addDays, isoDay } from '~/features/tasks/span';
import { TaskEditor } from '~/features/tasks/TaskEditor';
import { TaskList } from '~/features/tasks/TaskList';
import { targetPayload, useOpenProjects, type TaskTarget, type TaskType } from '~/features/tasks/TaskTarget';
import { t } from '~/i18n';
import { tx } from '~/stores/translations';
import { toast } from '~/stores/ui';
import type { Priority, Task } from '~/types';
import { cx } from '~/utils/cx';
import styles from './New.module.css';

type When = 'today' | 'tomorrow' | 'date' | 'none';

const PRIORITIES: Array<{ value: Priority; label: string; tone?: string }> = [
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High', tone: styles.warn },
  { value: 'critical', label: 'Critical', tone: styles.urgent },
];

/** 23:59 local on a `YYYY-MM-DD` day: "due that day, no time", like Today / Tomorrow. */
function endOfIsoDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1, 23, 59).toISOString();
}

export default function NewTask(): JSX.Element {
  const today = isoDay(new Date());
  const projects = useOpenProjects();
  const live = () => projects().filter((project) => project.status !== 'archived' && project.status !== 'completed');

  const [title, setTitle] = createSignal('');
  const [notes, setNotes] = createSignal('');
  const [target, setTarget] = createSignal<TaskTarget>({ kind: 'business' });
  const [type, setType] = createSignal<TaskType>({ client: false, ad: false });
  const [when, setWhen] = createSignal<When>('today');
  const [date, setDate] = createSignal(addDays(today, 2));
  const [priority, setPriority] = createSignal<Priority>('normal');
  const [busy, setBusy] = createSignal(false);
  const [added, setAdded] = createSignal<Task[]>([]);
  const [active, setActive] = createSignal<Task | null>(null);
  let titleInput: HTMLInputElement | undefined;

  const dueDay = (): string | null => {
    if (when() === 'today') return today;
    if (when() === 'tomorrow') return addDays(today, 1);
    if (when() === 'date') return date() || null;
    return null;
  };
  const chosenProject = () => {
    const current = target();
    return current.projectId !== undefined ? live().find((project) => project.id === current.projectId) ?? null : null;
  };

  const submit = async (event?: Event) => {
    event?.preventDefault();
    const value = title().trim();
    if (!value || busy()) {
      titleInput?.focus();
      return;
    }
    setBusy(true);
    try {
      const day = dueDay();
      const task = await tasksApi.create({
        title: value,
        description: notes().trim() || undefined,
        priority: priority(),
        ...(day ? { due_at: endOfIsoDay(day), due_has_time: false } : {}),
        ...targetPayload(target(), type()),
      });
      setAdded((list) => [task, ...list].slice(0, 20));
      setTitle('');
      setNotes('');
      toast(t('Task added'));
      titleInput?.focus();
    } catch (err) {
      toast(err instanceof ApiError ? (err.fieldError('title') ?? err.message) : t('Could not create the task.'));
    } finally {
      setBusy(false);
    }
  };

  const refreshAdded = async () => {
    const fresh = await Promise.all(added().map((task) => tasksApi.get(task.id).catch(() => null)));
    setAdded(fresh.filter((task): task is Task => task !== null));
  };

  return (
    <Page title={t('Add task')} subtitle={t('Choose where it goes, the day and the priority - then write it down.')}>
      <form class={styles.form} onSubmit={(event) => void submit(event)}>
        {/* Where */}
        <section class={styles.block}>
          <h3 class={styles.label}>{t('Where')}</h3>
          <div class={styles.lists}>
            <button
              type="button"
              class={cx(styles.list, target().kind === 'personal' && styles.on)}
              onClick={() => setTarget({ kind: 'personal' })}
              aria-pressed={target().kind === 'personal'}
            >
              <User size={15} /> {t('Personal')}
            </button>
            <button
              type="button"
              class={cx(styles.list, target().kind === 'business' && styles.on)}
              onClick={() => setTarget({ kind: 'business' })}
              aria-pressed={target().kind === 'business'}
            >
              <Briefcase size={15} /> {t('Business')}
            </button>
          </div>
          <Show when={live().length > 0}>
            <div class={styles.projects} role="listbox" aria-label={t('Projects')}>
              <For each={live()}>
                {(project) => {
                  const selected = () => target().projectId === project.id;
                  return (
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected()}
                      class={cx(styles.project, selected() && styles.on, project.is_ad && styles.adProject)}
                      onClick={() => setTarget(selected() ? { kind: 'business' } : { projectId: project.id })}
                      title={project.name}
                    >
                      <ProjectAvatar project={project} size={24} />
                      <span class={styles.projectName}>{tx('project', project.id, 'name', project.name)}</span>
                      <Show when={selected()}>
                        <Check size={13} class={styles.tick} />
                      </Show>
                    </button>
                  );
                }}
              </For>
            </div>
          </Show>
        </section>

        {/* Kind of work */}
        <section class={styles.block}>
          <h3 class={styles.label}>{t('Kind of work')}</h3>
          <div class={styles.lists}>
            <button
              type="button"
              class={cx(styles.list, type().client && styles.on)}
              onClick={() => setType({ ...type(), client: !type().client })}
              aria-pressed={type().client}
            >
              <Handshake size={15} /> {t('Client task')}
            </button>
            <button
              type="button"
              class={cx(styles.list, type().ad && styles.adOn)}
              onClick={() => setType({ ...type(), ad: !type().ad })}
              aria-pressed={type().ad}
            >
              <Megaphone size={15} /> {t('Advertising task')}
            </button>
          </div>
        </section>

        {/* When + priority */}
        <div class={styles.row}>
          <section class={styles.block}>
            <h3 class={styles.label}>{t('When')}</h3>
            <div class={styles.lists}>
              <For each={['today', 'tomorrow', 'date', 'none'] as When[]}>
                {(value) => (
                  <button
                    type="button"
                    class={cx(styles.list, when() === value && styles.on)}
                    onClick={() => setWhen(value)}
                    aria-pressed={when() === value}
                  >
                    {t({ today: 'Today', tomorrow: 'Tomorrow', date: 'Pick a day', none: 'No date' }[value])}
                  </button>
                )}
              </For>
              <Show when={when() === 'date'}>
                <Input
                  type="date"
                  sizeVariant="sm"
                  class={styles.date}
                  value={date()}
                  min={today}
                  onInput={(e) => setDate(e.currentTarget.value)}
                  aria-label={t('Pick a day')}
                />
              </Show>
            </div>
          </section>

          <section class={styles.block}>
            <h3 class={styles.label}>{t('Priority')}</h3>
            <div class={styles.lists}>
              <For each={PRIORITIES}>
                {(item) => (
                  <button
                    type="button"
                    class={cx(styles.list, priority() === item.value && styles.on, priority() === item.value && item.tone)}
                    onClick={() => setPriority(item.value)}
                    aria-pressed={priority() === item.value}
                  >
                    <Show when={item.tone}>
                      <Flag size={13} />
                    </Show>
                    {t(item.label)}
                  </button>
                )}
              </For>
            </div>
          </section>
        </div>

        {/* The task itself */}
        <section class={styles.block}>
          <h3 class={styles.label}>
            {t('Task')}
            <span class={styles.summary}>
              {chosenProject() ? tx('project', chosenProject()!.id, 'name', chosenProject()!.name) : t(target().kind === 'personal' ? 'Personal' : 'Business')}
              {type().client ? ` · ${t('Client')}` : ''}
              {type().ad ? ` · ${t('Ad')}` : ''}
            </span>
          </h3>
          <Input
            ref={titleInput}
            class={styles.title}
            value={title()}
            onInput={(e) => setTitle(e.currentTarget.value)}
            placeholder={t('What needs doing?')}
            aria-label={t('Task title')}
            maxLength={300}
            autofocus
          />
          <Textarea
            value={notes()}
            onInput={(e) => setNotes(e.currentTarget.value)}
            placeholder={t('Notes (optional)')}
            aria-label={t('Notes')}
            rows={3}
          />
          <div class={styles.actions}>
            <Button type="submit" variant="primary" loading={busy()} disabled={!title().trim()}>
              {t('Add task')}
            </Button>
            <span class={styles.hint}>{t('Enter adds it. Your choices stay for the next one.')}</span>
          </div>
        </section>
      </form>

      <Show when={added().length > 0}>
        <section class={styles.added}>
          <h3 class={styles.label}>
            {t('Just added')} <span class={styles.count}>{added().length}</span>
          </h3>
          <TaskList tasks={added()} compact showProject showKind onOpen={setActive} onChanged={() => void refreshAdded()} />
        </section>
      </Show>

      <TaskEditor
        task={active()}
        open={active() !== null}
        onClose={() => setActive(null)}
        onChanged={() => void refreshAdded()}
        onOpenTask={(task) => void tasksApi.get(task.id).then(setActive).catch(() => setActive(task))}
      />
    </Page>
  );
}
