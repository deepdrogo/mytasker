// MyTasker — Daily check-ins: today's calendar lines to tick, and the history of every day.
// Built by drogoz · https://github.com/deepdrogo/mytasker

import { Bitcoin, CalendarCheck, Check } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { createSignal, For, Show } from 'solid-js';
import { Page } from '~/components/shared/Page';
import { EmptyState, ErrorNote, Skeleton } from '~/components/ui/Feedback';
import { Select } from '~/components/ui/Input';
import { checkinsApi, targetOf } from '~/features/checkins/api';
import { checkinLabel, DailyCheckinList, NoCheckinsToday } from '~/features/checkins/DailyCheckinList';
import { projectTabs } from '~/features/projects/ProjectListPage';
import { createQuery } from '~/hooks/createQuery';
import { intlLocale, t } from '~/i18n';
import { toast } from '~/stores/ui';
import type { DailyCheckinHistoryItem, ISODate } from '~/types';
import { cx } from '~/utils/cx';
import { percent } from '~/utils/format';
import styles from './Checkins.module.css';

const RANGES = [7, 30, 90];

function dayLabel(iso: ISODate): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString(intlLocale(), { weekday: 'short', day: 'numeric', month: 'short' });
}

export default function ProjectsCheckins(): JSX.Element {
  const [days, setDays] = createSignal(30);
  const [busy, setBusy] = createSignal<string | null>(null);
  const today = createQuery(
    () => 'checkins:daily',
    () => checkinsApi.daily(),
  );
  const history = createQuery(
    () => `checkins:history:${days()}`,
    () => checkinsApi.history(days()),
  );
  const refresh = () => {
    today.refetch();
    history.refetch();
  };

  /** Past days can be fixed from the history: a forgotten tick, or one set by mistake. */
  const toggleDay = async (date: ISODate, item: DailyCheckinHistoryItem) => {
    const target = targetOf(item);
    const id = `${date}:${item.key}`;
    if (!target || busy()) return;
    setBusy(id);
    try {
      await checkinsApi.set(target, !item.checked, date);
      refresh();
    } catch {
      toast(t('Could not save the check-in.'));
    } finally {
      setBusy(null);
    }
  };

  const shownDays = () => (history.data()?.days ?? []).filter((day) => day.total > 0);

  return (
    <Page title={t('Daily check-ins')} subtitle={t('Whatever the project calendar puts on a day, ticked once that day.')} tabs={projectTabs()}>
      <div class={styles.layout}>
        <section class={styles.card}>
          <header class={styles.cardHead}>
            <CalendarCheck size={14} />
            <span>{t('Today')}</span>
            <Show when={today.data()?.items.length}>
              <span class={styles.count}>
                {today.data()!.items.filter((item) => item.checked).length}/{today.data()!.items.length}
              </span>
            </Show>
          </header>
          <Show when={!today.error()} fallback={<ErrorNote message={t('Could not load check-ins.')} onRetry={today.refetch} />}>
            <Show when={today.data()} fallback={<Skeleton rows={3} height={32} />}>
              {(data) => (
                <Show
                  when={data().items.length > 0}
                  fallback={<NoCheckinsToday />}
                >
                  <DailyCheckinList items={data().items} onChanged={refresh} />
                </Show>
              )}
            </Show>
          </Show>
        </section>

        <section class={styles.card}>
          <header class={styles.cardHead}>
            <span>{t('History')}</span>
            <Select
              sizeVariant="sm"
              class={styles.range}
              value={String(days())}
              onChange={(e) => setDays(Number(e.currentTarget.value))}
              aria-label={t('Period')}
            >
              <For each={RANGES}>{(n) => <option value={n}>{t('Last {count} days', { count: n })}</option>}</For>
            </Select>
          </header>

          <Show when={!history.error()} fallback={<ErrorNote message={t('Could not load check-ins.')} onRetry={history.refetch} />}>
            <Show when={history.data()} fallback={<Skeleton rows={6} height={28} />}>
              {(data) => (
                <Show
                  when={shownDays().length > 0}
                  fallback={
                    <EmptyState
                      icon={<CalendarCheck size={22} />}
                      title={t('No check-ins yet')}
                      hint={t('Place projects on the calendar; each day they cover shows up here.')}
                    />
                  }
                >
                  <ul class={styles.totals}>
                    <For each={data().lines}>
                      {(line) => (
                        <li class={styles.total}>
                          <span class={styles.totalName}>
                            <Show when={line.subject === 'crypto'}>
                              <Bitcoin size={12} class={styles.crypto} />
                            </Show>
                            {checkinLabel(line)}
                          </span>
                          <span class={styles.bar}>
                            <span class={styles.barFill} style={{ width: `${percent(line.done, line.scheduled)}%` }} />
                          </span>
                          <span class={styles.totalCount}>
                            {line.done}/{line.scheduled}
                          </span>
                        </li>
                      )}
                    </For>
                  </ul>

                  <ol class={styles.days}>
                    <For each={shownDays()}>
                      {(day) => (
                        <li class={styles.day}>
                          <span class={styles.dayLabel}>{day.date === data().end ? t('Today') : dayLabel(day.date)}</span>
                          <span class={cx(styles.dayCount, day.done === day.total && styles.dayComplete)}>
                            {day.done}/{day.total}
                          </span>
                          <span class={styles.chips}>
                            <For each={day.items}>
                              {(item) => (
                                <button
                                  type="button"
                                  class={cx(styles.chip, item.checked && styles.chipDone)}
                                  disabled={busy() !== null || !targetOf(item)}
                                  onClick={() => void toggleDay(day.date, item)}
                                  aria-pressed={item.checked}
                                  title={item.checked ? t('Checked in - click to undo') : t('Missed - click to check in')}
                                >
                                  <Show when={item.checked}>
                                    <Check size={11} />
                                  </Show>
                                  <Show when={item.subject === 'crypto'}>
                                    <Bitcoin size={11} />
                                  </Show>
                                  {checkinLabel(item)}
                                </button>
                              )}
                            </For>
                          </span>
                        </li>
                      )}
                    </For>
                  </ol>
                </Show>
              )}
            </Show>
          </Show>
        </section>
      </div>
    </Page>
  );
}
