import { A } from '@solidjs/router';
import { Maximize2, Plus } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { createSignal, Show } from 'solid-js';
import { ApiError } from '~/api/client';
import { Button } from '~/components/ui/Button';
import { Input } from '~/components/ui/Input';
import { PeoplePicker } from '~/features/people/PeoplePicker';
import { ProjectSelector } from '~/features/projects/ProjectSelector';
import { tasksApi, type TaskInput } from '~/features/tasks/api';
import { TargetSelect, targetPayload, TypeToggles, type TaskTarget, type TaskType } from '~/features/tasks/TaskTarget';
import { t } from '~/i18n';
import { toast } from '~/stores/ui';
import type { ID, Task } from '~/types';
import styles from './TaskComposer.module.css';

interface TaskComposerProps {
  defaults?: TaskInput;
  placeholder?: string;
  parentId?: number;
  onCreated?: (task: Task) => void;
  autofocus?: boolean;
  /** Show an optional project dropdown; the chosen project sticks between entries. */
  projectPicker?: boolean;
  /** Administrators: hand the new task to someone on the People list (sticks between entries). */
  personPicker?: boolean;
  /** Where the task goes: Personal / Business / a project (sticks between entries). Replaces projectPicker. */
  targetPicker?: boolean;
  /** Client / advertising toggles (stick between entries). */
  typePicker?: boolean;
  /** Link to the full Add task page. */
  moreHref?: string;
}

/**
 * One-line task creation. Enter saves and keeps focus so several tasks can be added in a row.
 */
export function TaskComposer(props: TaskComposerProps): JSX.Element {
  const [title, setTitle] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const [projectId, setProjectId] = createSignal<ID | null>(null);
  const [personIds, setPersonIds] = createSignal<ID[]>([]);
  // eslint-disable-next-line solid/reactivity -- initial value only
  const [target, setTarget] = createSignal<TaskTarget>({ kind: props.defaults?.kind === 'personal' ? 'personal' : 'business' });
  // eslint-disable-next-line solid/reactivity -- initial value only
  const [type, setType] = createSignal<TaskType>({ client: !!props.defaults?.is_client, ad: !!props.defaults?.is_ad });
  let input: HTMLInputElement | undefined;

  const payload = (value: string): TaskInput => {
    const base: TaskInput = { ...props.defaults, title: value };
    if (props.targetPicker) Object.assign(base, targetPayload(target(), type()));
    else if (props.typePicker) Object.assign(base, { is_client: type().client, is_ad: type().ad });
    if (props.projectPicker && !props.targetPicker && projectId() !== null) base.project_id = projectId();
    if (props.personPicker && personIds().length > 0) base.assignee_ids = personIds();
    return base;
  };

  const submit = async (event?: Event) => {
    event?.preventDefault();
    const value = title().trim();
    if (!value || busy()) return;
    setBusy(true);
    setError('');
    try {
      const task = props.parentId
        ? await tasksApi.addSubtask(props.parentId, payload(value))
        : await tasksApi.create(payload(value));
      setTitle('');
      props.onCreated?.(task);
      input?.focus();
    } catch (err) {
      const message = err instanceof ApiError ? (err.fieldError('title') ?? err.message) : t('Could not create the task.');
      setError(message);
      toast(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form class={styles.composer} onSubmit={submit}>
      <span class={styles.icon} aria-hidden="true">
        <Plus size={14} />
      </span>
      <Input
        ref={input}
        class={styles.input}
        value={title()}
        onInput={(e) => setTitle(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setTitle('');
            (e.currentTarget as HTMLInputElement).blur();
          }
        }}
        placeholder={props.placeholder ?? t('Add a task…')}
        aria-label={props.placeholder ?? t('Add a task')}
        autofocus={props.autofocus}
        invalid={!!error()}
        maxLength={300}
      />
      <Show when={props.targetPicker}>
        <div class={styles.project}>
          <TargetSelect value={target()} onChange={setTarget} />
        </div>
      </Show>
      <Show when={props.typePicker || props.targetPicker}>
        <TypeToggles value={type()} onChange={setType} />
      </Show>
      <Show when={props.projectPicker && !props.targetPicker}>
        <div class={styles.project} title={t('Also file this task under a project')}>
          <ProjectSelector value={projectId()} onChange={setProjectId} />
        </div>
      </Show>
      <Show when={props.personPicker}>
        <div class={styles.people} title={t('Hand this task to someone on People')}>
          <PeoplePicker value={personIds()} onChange={setPersonIds} compact />
        </div>
      </Show>
      <Show when={title().trim()}>
        <Button type="submit" variant="primary" size="sm" loading={busy()}>
          {t('Add')}
        </Button>
      </Show>
      <Show when={props.moreHref && !title().trim()}>
        <A href={props.moreHref ?? '/tasks/new'} class={styles.more} title={t('Open the full Add task page')} aria-label={t('Open the full Add task page')}>
          <Maximize2 size={13} />
        </A>
      </Show>
    </form>
  );
}
