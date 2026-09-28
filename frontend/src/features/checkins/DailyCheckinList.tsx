// MyTasker — today's lines from the project calendar, each ticked once a day.
// Built by drogoz · https://github.com/deepdrogo/mytasker

import { A } from '@solidjs/router';
import { Bitcoin, Check, Circle, Flame, Infinity as InfinityIcon } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { createEffect, createSignal, For, Show } from 'solid-js';
import { checkinsApi, targetOf } from '~/features/checkins/api';
import { t } from '~/i18n';
import { tx } from '~/stores/translations';
import { toast } from '~/stores/ui';
import type { DailyCheckinItem, ISODate } from '~/types';
import { cx } from '~/utils/cx';
import { formatDate } from '~/utils/format';
import styles from './DailyCheckinList.module.css';

export function checkinLabel(item: { subject: 'project' | 'crypto'; label: string; project_id?: number | null }): string {
  if (item.subject === 'crypto') return t('Crypto world');
  return item.project_id ? tx('project', item.project_id, 'name', item.label) : item.label;
}

export function checkinHref(item: { subject: 'project' | 'crypto'; project_id?: number | null }): string | undefined {
  if (item.subject === 'crypto') return '/tasks/crypto';
  return item.project_id ? `/projects/${item.project_id}/tasks` : undefined;
}

/** Empty state: weekends are gaps on the calendar, any other day just has nothing planned. */
export function NoCheckinsToday(): JSX.Element {
  const weekend = [0, 6].includes(new Date().getDay());
  return (
    <p class={styles.empty}>
      {weekend ? t('Weekend - the calendar takes the day off.') : t('Nothing on the calendar today.')}{' '}
      <A href="/projects/all" class={styles.emptyLink}>
        {t('Plan on the calendar')}
      </A>
    </p>
  );
}

export function DailyCheckinList(props: {
  items: DailyCheckinItem[];
  /** The day being ticked; today when omitted. */
  date?: ISODate;
  onChanged?: () => void;
}): JSX.Element {
  /** Ticks flip the moment they are pressed and hold until the refreshed list agrees (or the save fails). */
  const [overrides, setOverrides] = createSignal<Record<string, boolean>>({});
  const [busy, setBusy] = createSignal<Record<string, true>>({});
  const checked = (item: DailyCheckinItem) => overrides()[item.key] ?? item.checked;
  const done = () => props.items.filter(checked).length;

  const drop = (key: string) =>
    setOverrides((all) => {
      const rest = { ...all };
      delete rest[key];
      return rest;
    });

  createEffect(() => {
    for (const item of props.items) {
      if (overrides()[item.key] === item.checked && !busy()[item.key]) drop(item.key);
    }
  });

  const toggle = async (item: DailyCheckinItem) => {
    const target = targetOf(item);
    if (!target || busy()[item.key]) return;
    const next = !checked(item);
    setOverrides((all) => ({ ...all, [item.key]: next }));
    setBusy((all) => ({ ...all, [item.key]: true }));
    try {
      await checkinsApi.set(target, next, props.date);
      props.onChanged?.();
    } catch {
      drop(item.key);
      toast(t('Could not save the check-in.'));
    } finally {
      setBusy((all) => {
        const rest = { ...all };
        delete rest[item.key];
        return rest;
      });
    }
  };

  const itemRef = (item: DailyCheckinItem) => ({ subject: item.subject, label: item.label, project_id: item.project?.id ?? null });

  return (
    <div class={styles.wrap}>
      <div class={styles.progress} aria-label={t('{done} of {total} checked in', { done: done(), total: props.items.length })}>
        <For each={props.items}>{(item) => <span class={cx(styles.seg, checked(item) && styles.segDone)} />}</For>
      </div>
      <ul class={styles.list}>
        <For each={props.items}>
          {(item) => (
            <li class={cx(styles.row, checked(item) && styles.done)}>
              <button
                type="button"
                class={styles.check}
                onClick={() => void toggle(item)}
                aria-pressed={checked(item)}
                aria-label={checked(item) ? t('Undo check-in for {name}', { name: checkinLabel(itemRef(item)) }) : t('Check in {name}', { name: checkinLabel(itemRef(item)) })}
              >
                <Show when={checked(item)} fallback={<Circle size={15} />}>
                  <Check size={15} />
                </Show>
              </button>
              <Show when={item.subject === 'crypto'}>
                <Bitcoin size={13} class={styles.crypto} />
              </Show>
              <Show when={checkinHref(itemRef(item))} fallback={<span class={styles.name}>{checkinLabel(itemRef(item))}</span>}>
                {(href) => (
                  <A href={href()} class={styles.name}>
                    {checkinLabel(itemRef(item))}
                  </A>
                )}
              </Show>
              <Show when={item.streak > 1}>
                <span class={styles.streak} title={t('{count} days in a row', { count: item.streak })}>
                  <Flame size={11} /> {item.streak}
                </span>
              </Show>
              <span class={styles.until} title={t('On the calendar {start} → {end}', { start: formatDate(item.start), end: item.end ? formatDate(item.end) : t('ongoing') })}>
                <Show when={item.end} fallback={<InfinityIcon size={11} />}>
                  {(end) => t('until {date}', { date: formatDate(end()) })}
                </Show>
              </span>
            </li>
          )}
        </For>
      </ul>
    </div>
  );
}
