// MyTasker — "Hand over": give one or many tasks to one or more People (or take them back).
// Built by drogoz · https://github.com/deepdrogo/mytasker

import type { JSX } from 'solid-js';
import { createEffect, createSignal, Show } from 'solid-js';
import { ApiError } from '~/api/client';
import { Button } from '~/components/ui/Button';
import { Modal } from '~/components/ui/Modal';
import { PeoplePicker } from '~/features/people/PeoplePicker';
import { tasksApi } from '~/features/tasks/api';
import { t, tn } from '~/i18n';
import { tx } from '~/stores/translations';
import { toast } from '~/stores/ui';
import type { ID, Task, UserRef } from '~/types';
import styles from './MoveTaskDialog.module.css';

interface HandOverDialogProps {
  tasks: Task[];
  open: boolean;
  onClose: () => void;
  onChanged?: () => void;
}

const sameSet = (a: ID[], b: ID[]) => a.length === b.length && [...a].sort().join(',') === [...b].sort().join(',');

export function HandOverDialog(props: HandOverDialogProps): JSX.Element {
  const [ids, setIds] = createSignal<ID[]>([]);
  const [busy, setBusy] = createSignal(false);

  const single = () => (props.tasks.length === 1 ? props.tasks[0] : undefined);
  const current = (): ID[] => {
    const task = single();
    if (!task) return [];
    return task.assignees?.length ? task.assignees.map((user) => user.id) : task.assignee ? [task.assignee.id] : [];
  };
  const extra = (): UserRef[] => single()?.assignees ?? (single()?.assignee ? [single()!.assignee!] : []);

  createEffect(() => {
    if (props.open) setIds(current());
  });

  const unchanged = () => single() !== undefined && sameSet(ids(), current());

  const save = async () => {
    if (busy() || unchanged() || props.tasks.length === 0) return;
    setBusy(true);
    try {
      const task = single();
      let count = 1;
      let skipped = 0;
      if (task) {
        await tasksApi.update(task.id, { assignee_ids: ids() });
      } else {
        const result = await tasksApi.bulkAssign(
          props.tasks.map((item) => item.id),
          ids(),
        );
        count = result.updated.length;
        skipped = result.skipped.length;
      }
      if (ids().length === 0) toast(t('Taken back - {count} yours again', { count: tn(count, 'task') }));
      else if (skipped > 0) toast(t('{count} handed over, {skipped} skipped', { count, skipped }));
      else toast(t('Handed over {count} to {people}', { count: tn(count, 'task'), people: tn(ids().length, 'person', 'people') }));
      props.onChanged?.();
      props.onClose();
    } catch (err) {
      toast(err instanceof ApiError ? (err.fieldError('assignee') ?? err.message) : t('Could not update the task.'));
    } finally {
      setBusy(false);
    }
  };

  const title = () => {
    const task = single();
    return task ? t('Hand over “{title}”', { title: tx('task', task.id, 'title', task.title) }) : t('Hand over {count}', { count: tn(props.tasks.length, 'task') });
  };

  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title={title()}
      description={t('Pick one or several people. They see it at once on their Dashboard and on a page named after you. Pick nobody to take it back.')}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={props.onClose}>
            {t('Cancel')}
          </Button>
          <Button variant="primary" onClick={() => void save()} loading={busy()} disabled={unchanged()}>
            <Show when={ids().length > 0} fallback={t('Take back')}>
              {t('Hand over')}
            </Show>
          </Button>
        </>
      }
    >
      <div class={styles.options}>
        <PeoplePicker value={ids()} onChange={setIds} extra={extra()} />
        <Show when={ids().length > 1}>
          <p class={styles.optionHint}>{t('Everyone picked gets the same task and can work on it together.')}</p>
        </Show>
      </div>
    </Modal>
  );
}
