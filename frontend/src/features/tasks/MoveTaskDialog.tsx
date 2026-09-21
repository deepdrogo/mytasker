// MyTasker — "Move to…": send one or many tasks to another list or into a project.
// Built by drogoz · https://github.com/deepdrogo/mytasker

import { Bitcoin, Briefcase, FolderKanban, User } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { createEffect, createSignal, For, Show } from 'solid-js';
import { ApiError } from '~/api/client';
import { Button } from '~/components/ui/Button';
import { Modal } from '~/components/ui/Modal';
import { ProjectSelector } from '~/features/projects/ProjectSelector';
import { tasksApi, type MoveDestination } from '~/features/tasks/api';
import { t, tn } from '~/i18n';
import { tx } from '~/stores/translations';
import { toast } from '~/stores/ui';
import type { ID, Task, TaskKind } from '~/types';
import { cx } from '~/utils/cx';
import styles from './MoveTaskDialog.module.css';

interface MoveTaskDialogProps {
  tasks: Task[];
  open: boolean;
  onClose: () => void;
  /** Called after a successful move with the ids that actually moved. */
  onMoved?: (movedIds: ID[]) => void;
}

type Choice = TaskKind | 'project';

const LISTS: Array<{ kind: TaskKind; label: string; hint: string; icon: () => JSX.Element }> = [
  { kind: 'personal', label: 'Personal', hint: 'Life tasks, no project.', icon: () => <User size={14} /> },
  { kind: 'business', label: 'Business', hint: 'Work list, outside any project.', icon: () => <Briefcase size={14} /> },
  { kind: 'crypto', label: 'Crypto world', hint: 'Kept off the Dashboard and Today.', icon: () => <Bitcoin size={14} /> },
];

/** Where a task lives right now, for the "current" marker. */
function locationOf(task: Task): { choice: Choice; projectId: ID | null } {
  if (task.project) return { choice: 'project', projectId: task.project.id };
  return { choice: task.kind, projectId: null };
}

export function MoveTaskDialog(props: MoveTaskDialogProps): JSX.Element {
  const [choice, setChoice] = createSignal<Choice>('personal');
  const [projectId, setProjectId] = createSignal<ID | null>(null);
  const [busy, setBusy] = createSignal(false);

  // Start from where the (first) task is, so "Move" with no change is a no-op rather than a surprise.
  createEffect(() => {
    if (!props.open) return;
    const first = props.tasks[0];
    const current = first ? locationOf(first) : { choice: 'personal' as Choice, projectId: null };
    setChoice(current.choice);
    setProjectId(current.projectId);
  });

  const single = () => (props.tasks.length === 1 ? props.tasks[0] : undefined);
  const isCurrent = (candidate: Choice, project: ID | null = null) => {
    const task = single();
    if (!task) return false;
    const current = locationOf(task);
    return current.choice === candidate && (candidate !== 'project' || current.projectId === project);
  };

  const destination = (): MoveDestination | null => {
    const picked = choice();
    if (picked === 'project') return projectId() === null ? null : { project_id: projectId()! };
    return { kind: picked };
  };

  const canMove = () => {
    const target = destination();
    if (!target || busy() || props.tasks.length === 0) return false;
    if (target.kind) return !isCurrent(target.kind);
    return !isCurrent('project', target.project_id ?? null);
  };

  const move = async () => {
    const target = destination();
    if (!target || !canMove()) return;
    setBusy(true);
    try {
      let moved: ID[];
      let skipped = 0;
      const task = single();
      if (task) {
        await tasksApi.move(task.id, target);
        moved = [task.id];
      } else {
        const result = await tasksApi.bulkMove(
          props.tasks.map((item) => item.id),
          target,
        );
        moved = result.moved;
        skipped = result.skipped.length;
      }
      toast(
        skipped > 0
          ? t('{count} moved, {skipped} skipped', { count: moved.length, skipped })
          : t('Moved {count}', { count: tn(moved.length, 'task') }),
      );
      props.onMoved?.(moved);
      props.onClose();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('Could not move the task.'));
    } finally {
      setBusy(false);
    }
  };

  const title = () => {
    const task = single();
    return task ? t('Move “{title}”', { title: tx('task', task.id, 'title', task.title) }) : t('Move {count}', { count: tn(props.tasks.length, 'task') });
  };

  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title={title()}
      description={t('Subtasks come along. A task moved into a project leaves the list it was in.')}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={props.onClose}>
            {t('Cancel')}
          </Button>
          <Button variant="primary" onClick={() => void move()} loading={busy()} disabled={!canMove()}>
            {t('Move')}
          </Button>
        </>
      }
    >
      <div class={styles.options} role="radiogroup" aria-label={t('Destination')}>
        <For each={LISTS}>
          {(list) => (
            <button
              type="button"
              role="radio"
              aria-checked={choice() === list.kind}
              class={cx(styles.option, choice() === list.kind && styles.optionActive)}
              onClick={() => setChoice(list.kind)}
            >
              <span class={styles.optionIcon}>{list.icon()}</span>
              <span class={styles.optionText}>
                <span class={styles.optionLabel}>
                  {t(list.label)}
                  <Show when={isCurrent(list.kind)}>
                    <span class={styles.current}>{t('current')}</span>
                  </Show>
                </span>
                <span class={styles.optionHint}>{t(list.hint)}</span>
              </span>
            </button>
          )}
        </For>

        <button
          type="button"
          role="radio"
          aria-checked={choice() === 'project'}
          class={cx(styles.option, choice() === 'project' && styles.optionActive)}
          onClick={() => setChoice('project')}
        >
          <span class={styles.optionIcon}>
            <FolderKanban size={14} />
          </span>
          <span class={styles.optionText}>
            <span class={styles.optionLabel}>
              {t('Project')}
              <Show when={isCurrent('project', projectId())}>
                <span class={styles.current}>{t('current')}</span>
              </Show>
            </span>
            <span class={styles.optionHint}>{t('Files the task inside the project.')}</span>
          </span>
        </button>
        <Show when={choice() === 'project'}>
          <div class={styles.projectPicker} onClick={(event) => event.stopPropagation()}>
            <ProjectSelector value={projectId()} onChange={setProjectId} />
          </div>
        </Show>
      </div>
    </Modal>
  );
}
