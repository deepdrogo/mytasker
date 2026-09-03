import { CalendarDays, CalendarX, Check, X } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { createSignal, Show } from 'solid-js';
import { ApiError } from '~/api/client';
import { Button } from '~/components/ui/Button';
import { Dropdown, type MenuItem } from '~/components/ui/Dropdown';
import { Input } from '~/components/ui/Input';
import { tasksApi } from '~/features/tasks/api';
import { t, tn } from '~/i18n';
import { toast } from '~/stores/ui';
import type { Task } from '~/types';
import { formatDate, fromLocalInputValue, toDateInputValue } from '~/utils/format';
import styles from './BulkDueDate.module.css';

interface BulkDueDateProps {
  /** Tasks the deadline applies to; only editable ones are sent. */
  tasks: () => Task[];
  onChanged?: () => void;
}

const END_OF_DAY = 'T23:59';

function plusDays(days: number): Date {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d;
}

function nextMonday(): Date {
  const d = plusDays(1);
  while (d.getDay() !== 1) d.setDate(d.getDate() + 1);
  return d;
}

/**
 * One deadline for a whole selection. Quick picks cover the common cases; "Pick a date" opens an inline
 * date field. Every change is a single request and comes with an Undo that restores each task's old date.
 */
export function BulkDueDate(props: BulkDueDateProps): JSX.Element {
  const [picking, setPicking] = createSignal(false);
  const [value, setValue] = createSignal('');
  const [busy, setBusy] = createSignal(false);

  const editable = () => props.tasks().filter((task) => task.can_edit && task.status !== 'done');

  const apply = async (dueAt: string | null) => {
    const targets = editable();
    if (busy() || !targets.length) return;
    setBusy(true);
    try {
      const result = await tasksApi.bulkReschedule(
        targets.map((task) => task.id),
        dueAt,
        false,
      );
      setPicking(false);
      props.onChanged?.();
      const changed = result.updated.length;
      if (!changed) {
        toast(t('These tasks cannot be edited.'));
        return;
      }
      const message = dueAt
        ? t('{count} moved to {date}', { count: tn(changed, 'task'), date: formatDate(dueAt) })
        : t('Deadline cleared for {count}', { count: tn(changed, 'task') });
      const previous = targets.filter((task) => result.updated.includes(task.id));
      toast(message, {
        action: {
          label: t('Undo'),
          run: () => {
            void Promise.all(
              previous.map((task) => tasksApi.update(task.id, { due_at: task.due_at, due_has_time: task.due_has_time })),
            )
              .then(() => {
                props.onChanged?.();
                toast(t('Restored'));
              })
              .catch(() => toast(t('Could not restore the previous deadlines.')));
          },
        },
      });
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('Could not change the deadline.'));
    } finally {
      setBusy(false);
    }
  };

  const applyDay = (day: Date) => void apply(fromLocalInputValue(`${toDateInputValue(day.toISOString())}${END_OF_DAY}`));

  const items = (): MenuItem[] => [
    { label: t('Today'), onSelect: () => applyDay(plusDays(0)) },
    { label: t('Tomorrow'), onSelect: () => applyDay(plusDays(1)) },
    { label: t('Next Monday'), onSelect: () => applyDay(nextMonday()) },
    { label: t('In a week'), onSelect: () => applyDay(plusDays(7)) },
    {
      label: t('Pick a date…'),
      onSelect: () => {
        setValue(toDateInputValue(plusDays(1).toISOString()));
        setPicking(true);
      },
    },
    {
      label: t('Clear deadline'),
      icon: <CalendarX size={14} />,
      separatorBefore: true,
      danger: true,
      onSelect: () => void apply(null),
    },
  ];

  return (
    <Show when={editable().length > 0}>
      <Show
        when={picking()}
        fallback={
          <Dropdown
            items={items()}
            label={t('Set deadline for selected tasks')}
            trigger={({ toggle }) => (
              <Button variant="secondary" size="sm" loading={busy()} onClick={toggle}>
                <CalendarDays size={13} />
                {t('Set date')}
              </Button>
            )}
          />
        }
      >
        <form
          class={styles.picker}
          onSubmit={(e) => {
            e.preventDefault();
            if (value()) void apply(fromLocalInputValue(`${value()}${END_OF_DAY}`));
          }}
        >
          <Input
            type="date"
            sizeVariant="sm"
            value={value()}
            onInput={(e) => setValue(e.currentTarget.value)}
            aria-label={t('Deadline')}
            autofocus
          />
          <Button type="submit" size="sm" loading={busy()} disabled={!value()} aria-label={t('Apply')}>
            <Check size={13} />
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setPicking(false)} aria-label={t('Cancel')}>
            <X size={13} />
          </Button>
        </form>
      </Show>
    </Show>
  );
}
