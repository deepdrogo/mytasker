import { Plus } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { createSignal, Show } from 'solid-js';
import { ApiError } from '~/api/client';
import { Button } from '~/components/ui/Button';
import { Input } from '~/components/ui/Input';
import { tasksApi, type TaskInput } from '~/features/tasks/api';
import { toast } from '~/stores/ui';
import type { Task } from '~/types';
import styles from './TaskComposer.module.css';

interface TaskComposerProps {
  defaults?: TaskInput;
  placeholder?: string;
  parentId?: number;
  onCreated?: (task: Task) => void;
  autofocus?: boolean;
}

/**
 * One-line task creation. Enter saves and keeps focus so several tasks can be added in a row.
 */
export function TaskComposer(props: TaskComposerProps): JSX.Element {
  const [title, setTitle] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  let input: HTMLInputElement | undefined;

  const submit = async (event?: Event) => {
    event?.preventDefault();
    const value = title().trim();
    if (!value || busy()) return;
    setBusy(true);
    setError('');
    try {
      const task = props.parentId
        ? await tasksApi.addSubtask(props.parentId, { ...props.defaults, title: value })
        : await tasksApi.create({ ...props.defaults, title: value });
      setTitle('');
      props.onCreated?.(task);
      input?.focus();
    } catch (err) {
      const message = err instanceof ApiError ? (err.fieldError('title') ?? err.message) : 'Could not create the task.';
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
        placeholder={props.placeholder ?? 'Add a task…'}
        aria-label={props.placeholder ?? 'Add a task'}
        autofocus={props.autofocus}
        invalid={!!error()}
        maxLength={300}
      />
      <Show when={title().trim()}>
        <Button type="submit" variant="primary" size="sm" loading={busy()}>
          Add
        </Button>
      </Show>
    </form>
  );
}
