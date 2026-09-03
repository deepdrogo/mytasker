import { Check, ChevronDown, ChevronUp, Clock, ListChecks, MoreHorizontal, Pause, Play, Plus } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { batch, createEffect, createSignal, For, Show } from 'solid-js';
import { ApiError } from '~/api/client';
import { Badge } from '~/components/shared/Indicators';
import { Page } from '~/components/shared/Page';
import { Button } from '~/components/ui/Button';
import { Drawer } from '~/components/ui/Drawer';
import { Dropdown } from '~/components/ui/Dropdown';
import { EmptyState, ErrorNote, Skeleton } from '~/components/ui/Feedback';
import { Checkbox, Field, Input, Textarea } from '~/components/ui/Input';
import { routinesApi, toggleWeekday, WEEKDAYS, weekdayEnabled, type RoutineItemInput } from '~/features/routines/api';
import { createQuery } from '~/hooks/createQuery';
import { t } from '~/i18n';
import { startTimer, stopTimer, timerStore } from '~/stores/timer';
import { tx } from '~/stores/translations';
import { toast } from '~/stores/ui';
import type { RoutineItem, RoutineKind } from '~/types';
import { formatClock, formatMinutes } from '~/utils/format';
import styles from './RoutinePage.module.css';

const ROUTINE_TAB_DEFS = [
  { label: 'Personal', href: '/routine/personal' },
  { label: 'Business', href: '/routine/business' },
  { label: 'Rules', href: '/routine/rules' },
];

/** Tabs shared by the routine pages. Call inside JSX so labels follow the UI language. */
export function routineTabs(): Array<{ label: string; href: string }> {
  return ROUTINE_TAB_DEFS.map((tab) => ({ label: t(tab.label), href: tab.href }));
}

interface RoutinePageProps {
  kind: RoutineKind;
  title: string;
  subtitle: string;
}

function formatTimeRange(item: RoutineItem): string {
  if (!item.start_time && !item.end_time) return '';
  const trim = (value: string | null) => (value ? value.slice(0, 5) : '');
  return `${trim(item.start_time)}${item.end_time ? ` – ${trim(item.end_time)}` : ''}`;
}

/** Localised counterpart of `describeRepeat` - weekday abbreviations go through t() one by one. */
function describeRepeatLabel(mask: number): string {
  if (mask === 127) return t('Every day');
  if (mask === 31) return t('Weekdays');
  if (mask === 96) return t('Weekends');
  const days = WEEKDAYS.filter((_, i) => weekdayEnabled(mask, i)).map((day) => t(day));
  return days.join(', ') || t('Never');
}

export function RoutinePage(props: RoutinePageProps): JSX.Element {
  const [editing, setEditing] = createSignal<RoutineItem | null | 'new'>(null);
  const [showAll, setShowAll] = createSignal(false);

  const query = createQuery(
    () => `routines:${props.kind}:${showAll() ? 'all' : 'today'}`,
    () => routinesApi.items(props.kind, showAll() ? {} : { today: '1' }),
  );

  const items = () => query.data()?.items ?? [];
  const completedCount = () => items().filter((i) => i.today_completed).length;
  const totalTarget = () => items().reduce((sum, i) => sum + i.target_minutes, 0);
  const totalDone = () => items().reduce((sum, i) => sum + i.today_minutes, 0);

  const toggle = async (item: RoutineItem) => {
    try {
      await routinesApi.complete(item.id, !item.today_completed);
      query.refetch();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('Could not update.'));
    }
  };

  const isTracking = (item: RoutineItem) => timerStore.running()?.routine_item?.id === item.id;

  const track = async (item: RoutineItem) => {
    try {
      if (isTracking(item)) await stopTimer();
      else await startTimer({ routine_item_id: item.id, category: item.counts_as_business ? 'business' : 'personal' });
    } catch {
      toast(t('Could not change the timer.'));
    }
  };

  const move = async (item: RoutineItem, direction: -1 | 1) => {
    const ids = items().map((i) => i.id);
    const index = ids.indexOf(item.id);
    const target = index + direction;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target] as number, ids[index] as number];
    await routinesApi.reorder(props.kind, ids);
    query.refetch();
  };

  const remove = async (item: RoutineItem) => {
    try {
      await routinesApi.remove(item.id);
      query.refetch();
    } catch {
      toast(t('Could not delete.'));
    }
  };

  return (
    <>
      <Page
        title={props.title}
        subtitle={props.subtitle}
        tabs={routineTabs()}
        actions={
          <div class={styles.actions}>
            <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)}>
              {showAll() ? t('Today only') : t('All items')}
            </Button>
            <Button size="sm" onClick={() => setEditing('new')}>
              <Plus size={14} />
              {t('Add')}
            </Button>
          </div>
        }
      >
        <div class={styles.wrap}>
          <Show when={items().length > 0}>
            <div class={styles.summary}>
              <span>
                <strong>{completedCount()}</strong> / {t('{total} done today', { total: items().length })}
              </span>
              <span class="mt-mono">
                {formatMinutes(totalDone())} / {formatMinutes(totalTarget())}
              </span>
            </div>
          </Show>

          <Show when={!query.error()} fallback={<ErrorNote message={t('Could not load the routine.')} onRetry={query.refetch} />}>
            <Show when={query.data()} fallback={<Skeleton rows={5} height={56} />}>
              <Show
                when={items().length > 0}
                fallback={
                  <EmptyState
                    icon={<ListChecks size={22} />}
                    title={showAll() ? t('No routine items yet') : t('Nothing scheduled today')}
                    hint={t('A routine is the shape of your day: blocks with a time window and a target.')}
                    action={
                      <Button size="sm" onClick={() => setEditing('new')}>
                        {t('Add the first block')}
                      </Button>
                    }
                  />
                }
              >
                <ul class={styles.list}>
                  <For each={items()}>
                    {(item, index) => (
                      <li
                        class={[
                          styles.row,
                          item.today_completed ? styles.done : '',
                          query.data()?.current_item_id === item.id ? styles.current : '',
                          !item.is_active ? styles.inactive : '',
                        ].join(' ')}
                      >
                        <button
                          type="button"
                          class={styles.check}
                          aria-label={item.today_completed ? t('Mark not done') : t('Mark done')}
                          aria-pressed={item.today_completed}
                          onClick={() => void toggle(item)}
                        >
                          <Show when={item.today_completed}>
                            <Check size={12} strokeWidth={3} />
                          </Show>
                        </button>
                        <button type="button" class={styles.main} onClick={() => setEditing(item)}>
                          <span class={styles.name}>{tx('routine_item', item.id, 'name', item.name)}</span>
                          <span class={styles.meta}>
                            <Show when={formatTimeRange(item)}>
                              <span class="mt-mono">{formatTimeRange(item)}</span>
                            </Show>
                            <span>
                              <Clock size={11} /> {formatMinutes(item.today_minutes)} / {formatMinutes(item.target_minutes)}
                            </span>
                            <Show when={item.repeat_days !== 127}>
                              <span>{describeRepeatLabel(item.repeat_days)}</span>
                            </Show>
                            <Show when={item.counts_as_business && props.kind === 'personal'}>
                              <Badge variant="outline">{t('Business time')}</Badge>
                            </Show>
                            <Show when={query.data()?.current_item_id === item.id}>
                              <Badge variant="solid">{t('Now')}</Badge>
                            </Show>
                          </span>
                        </button>
                        <div class={styles.rowActions}>
                          <Show when={isTracking(item)}>
                            <span class={[styles.elapsed, 'mt-mono'].join(' ')}>{formatClock(timerStore.elapsedSeconds())}</span>
                          </Show>
                          <Button
                            variant={isTracking(item) ? 'primary' : 'ghost'}
                            size="icon-sm"
                            aria-label={isTracking(item) ? t('Stop timer') : t('Start timer')}
                            onClick={() => void track(item)}
                            loading={timerStore.busy()}
                          >
                            <Show when={isTracking(item)} fallback={<Play size={13} />}>
                              <Pause size={13} />
                            </Show>
                          </Button>
                          <Dropdown
                            label={t('Item actions')}
                            items={[
                              { label: t('Edit'), onSelect: () => setEditing(item) },
                              { label: t('Move up'), icon: <ChevronUp size={14} />, disabled: index() === 0, onSelect: () => void move(item, -1) },
                              { label: t('Move down'), icon: <ChevronDown size={14} />, disabled: index() === items().length - 1, onSelect: () => void move(item, 1) },
                              { label: t('Delete'), danger: true, separatorBefore: true, onSelect: () => void remove(item) },
                            ]}
                            trigger={(menu) => (
                              <Button variant="ghost" size="icon-sm" onClick={menu.toggle} aria-label={t('More')}>
                                <MoreHorizontal size={15} />
                              </Button>
                            )}
                          />
                        </div>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </Show>
          </Show>
        </div>
      </Page>

      <RoutineItemEditor
        kind={props.kind}
        item={editing() === 'new' ? null : (editing() as RoutineItem | null)}
        open={editing() !== null}
        onClose={() => setEditing(null)}
        onSaved={() => query.refetch()}
      />
    </>
  );
}

function RoutineItemEditor(props: {
  kind: RoutineKind;
  item: RoutineItem | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}): JSX.Element {
  const [form, setForm] = createSignal<RoutineItemInput>({});
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal('');

  createEffect(() => {
    if (!props.open) return;
    const i = props.item;
    batch(() => {
      setForm({
        name: i?.name ?? '',
        description: i?.description ?? '',
        target_minutes: i?.target_minutes ?? 60,
        start_time: i?.start_time?.slice(0, 5) ?? '',
        end_time: i?.end_time?.slice(0, 5) ?? '',
        repeat_days: i?.repeat_days ?? 127,
        counts_as_business: i?.counts_as_business ?? props.kind === 'business',
        is_active: i?.is_active ?? true,
      });
      setError('');
    });
  });

  const update = <K extends keyof RoutineItemInput>(key: K, value: RoutineItemInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const save = async (event?: Event) => {
    event?.preventDefault();
    if (saving()) return;
    if (!form().name?.trim()) {
      setError(t('Name is required.'));
      return;
    }
    setSaving(true);
    const payload: RoutineItemInput = {
      ...form(),
      start_time: form().start_time || null,
      end_time: form().end_time || null,
    };
    try {
      if (props.item) await routinesApi.update(props.item.id, payload);
      else await routinesApi.create(props.kind, payload);
      props.onSaved();
      props.onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('Could not save.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open={props.open}
      onClose={props.onClose}
      title={props.item ? t('Edit block') : t('New routine block')}
      footer={
        <>
          <Button variant="ghost" onClick={props.onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={save} loading={saving()}>
            {t('Save')}
          </Button>
        </>
      }
    >
      <form class={styles.form} onSubmit={save}>
        <Field label={t('Name')} required error={error()}>
          <Input value={form().name ?? ''} onInput={(e) => update('name', e.currentTarget.value)} autofocus placeholder={t('Deep work')} />
        </Field>
        <Field label={t('Description')}>
          <Textarea rows={2} value={form().description ?? ''} onInput={(e) => update('description', e.currentTarget.value)} />
        </Field>
        <div class={styles.grid}>
          <Field label={t('Target (minutes)')}>
            <Input
              type="number"
              min={0}
              max={1440}
              value={form().target_minutes ?? 60}
              onInput={(e) => update('target_minutes', Number(e.currentTarget.value))}
            />
          </Field>
          <Field label={t('Start')}>
            <Input type="time" value={form().start_time ?? ''} onInput={(e) => update('start_time', e.currentTarget.value)} />
          </Field>
          <Field label={t('End')}>
            <Input type="time" value={form().end_time ?? ''} onInput={(e) => update('end_time', e.currentTarget.value)} />
          </Field>
        </div>
        <Field label={t('Repeat')}>
          <div class={styles.days}>
            <For each={WEEKDAYS}>
              {(day, i) => (
                <button
                  type="button"
                  class={[styles.day, weekdayEnabled(form().repeat_days ?? 127, i()) ? styles.dayOn : ''].join(' ')}
                  aria-pressed={weekdayEnabled(form().repeat_days ?? 127, i())}
                  onClick={() => update('repeat_days', toggleWeekday(form().repeat_days ?? 127, i()))}
                >
                  {t(day)}
                </button>
              )}
            </For>
          </div>
        </Field>
        <Checkbox
          label={t('Time on this block counts as business time')}
          checked={form().counts_as_business ?? false}
          onChange={(e) => update('counts_as_business', e.currentTarget.checked)}
        />
        <Checkbox label={t('Active')} checked={form().is_active ?? true} onChange={(e) => update('is_active', e.currentTarget.checked)} />
      </form>
    </Drawer>
  );
}
