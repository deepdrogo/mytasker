// MyTasker — Time history. Saved cycles: what the 24-hour ring held at each reset, with the grand total.
// By day: every tracked day, newest first, and each sleep or timer entry behind it.

import { useSearchParams } from '@solidjs/router';
import { CalendarDays, History as HistoryIcon, RotateCcw, Trash2 } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { createEffect, createSignal, For, Show } from 'solid-js';
import { api } from '~/api/client';
import { Page } from '~/components/shared/Page';
import { Button } from '~/components/ui/Button';
import { ConfirmDialog, EmptyState, ErrorNote, Skeleton } from '~/components/ui/Feedback';
import { KIND_TONE } from '~/features/timer/WeekCard';
import { createQuery } from '~/hooks/createQuery';
import { intlLocale, t } from '~/i18n';
import { authStore } from '~/stores/auth';
import { toast } from '~/stores/ui';
import type { CycleKind, CycleSnapshot, CycleSnapshotPage, TimeHistoryPage } from '~/types';
import { cx } from '~/utils/cx';
import { formatDuration, formatTime } from '~/utils/format';
import styles from './History.module.css';

type Day = TimeHistoryPage['days'][number];

const KINDS: Array<{ kind: CycleKind; label: string }> = [
  { kind: 'sleep', label: 'Sleep' },
  { kind: 'business', label: 'Work' },
  { kind: 'fun', label: 'Fun' },
  { kind: 'exercise', label: 'Exercise' },
  { kind: 'personal', label: 'Other' },
];
const KIND_LABEL = Object.fromEntries(KINDS.map((item) => [item.kind, item.label])) as Record<CycleKind, string>;

const dur = (seconds: number) => (seconds <= 0 ? '0' : seconds < 60 ? '<1m' : formatDuration(seconds));

function localDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

function dayTitle(iso: string): string {
  return localDate(iso).toLocaleDateString(intlLocale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function DaysView(): JSX.Element {
  const first = createQuery<TimeHistoryPage>(() => 'timer:history', () => api.get<TimeHistoryPage>('/timer/history/'));
  /** Older pages, appended by "Show older days". Dropped whenever the newest page is refetched. */
  const [older, setOlder] = createSignal<Day[]>([]);
  const [cursor, setCursor] = createSignal<string | null>(null);
  const [loadingMore, setLoadingMore] = createSignal(false);

  createEffect(() => {
    const page = first.data();
    if (!page) return;
    setOlder([]);
    setCursor(page.next_before);
  });

  const days = () => [...(first.data()?.days ?? []), ...older()];

  const loadMore = async () => {
    const before = cursor();
    if (!before || loadingMore()) return;
    setLoadingMore(true);
    try {
      const page = await api.get<TimeHistoryPage>('/timer/history/', { params: { before } });
      setOlder((current) => [...current, ...page.days]);
      setCursor(page.next_before);
    } catch {
      toast(t('Could not load older days.'));
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <>
      <Show when={!first.error()} fallback={<ErrorNote message={t('Could not load the history.')} onRetry={first.refetch} />}>
        <Show when={first.data()} fallback={<Skeleton rows={6} height={56} />}>
          <Show
            when={days().length > 0}
            fallback={<EmptyState icon={<HistoryIcon size={20} />} title={t('Nothing tracked yet.')} hint={t('Start a timer or sleep on the Dashboard.')} />}
          >
            <div class={styles.days}>
              <For each={days()}>{(day) => <DayBlock day={day} />}</For>
            </div>
            <Show when={cursor()}>
              <div class={styles.more}>
                <Button variant="ghost" size="sm" loading={loadingMore()} onClick={() => void loadMore()}>
                  {t('Show older days')}
                </Button>
              </div>
            </Show>
          </Show>
        </Show>
      </Show>
    </>
  );
}

type View = 'cycles' | 'days';

export default function TimeHistory(): JSX.Element {
  const [search, setSearch] = useSearchParams<{ view?: string }>();
  const view = (): View => (search.view === 'days' ? 'days' : 'cycles');
  return (
    <Page title={t('Time history')} subtitle={t('Every reset saves its cycle here, and every tracked day stays listed. Nothing is lost.')}>
      <div class={styles.tabs} role="tablist" aria-label={t('Time history')}>
        <button type="button" role="tab" aria-selected={view() === 'cycles'} class={cx(styles.tab, view() === 'cycles' && styles.tabOn)} onClick={() => setSearch({ view: undefined })}>
          <RotateCcw size={13} /> {t('Saved cycles')}
        </button>
        <button type="button" role="tab" aria-selected={view() === 'days'} class={cx(styles.tab, view() === 'days' && styles.tabOn)} onClick={() => setSearch({ view: 'days' })}>
          <CalendarDays size={13} /> {t('By day')}
        </button>
      </div>
      <Show when={view() === 'cycles'} fallback={<DaysView />}>
        <SavedCycles />
      </Show>
    </Page>
  );
}

/** Each reset's cycle, newest first, under the grand total of all of them. */
function SavedCycles(): JSX.Element {
  const first = createQuery<CycleSnapshotPage>(() => 'timer:snapshots', () => api.get<CycleSnapshotPage>('/timer/cycle/snapshots/'));
  const [older, setOlder] = createSignal<CycleSnapshot[]>([]);
  const [nextPage, setNextPage] = createSignal<number | null>(null);
  const [loadingMore, setLoadingMore] = createSignal(false);
  const [removing, setRemoving] = createSignal<CycleSnapshot | null>(null);
  const use12h = () => authStore.user()?.preferences.time_format === '12h';

  createEffect(() => {
    const page = first.data();
    if (!page) return;
    setOlder([]);
    setNextPage(page.next_page);
  });

  const rows = () => [...(first.data()?.results ?? []), ...older()];
  const totals = () => first.data()?.totals;
  const count = () => first.data()?.count ?? 0;
  const present = (seconds: Record<CycleKind, number>) => KINDS.filter((item) => (seconds[item.kind] ?? 0) > 0);

  const loadMore = async () => {
    const page = nextPage();
    if (!page || loadingMore()) return;
    setLoadingMore(true);
    try {
      const data = await api.get<CycleSnapshotPage>('/timer/cycle/snapshots/', { params: { page } });
      setOlder((current) => [...current, ...data.results]);
      setNextPage(data.next_page);
    } catch {
      toast(t('Could not load older cycles.'));
    } finally {
      setLoadingMore(false);
    }
  };

  const remove = async () => {
    const target = removing();
    if (!target) return;
    try {
      await api.delete(`/timer/cycle/snapshots/${target.id}/`);
      setRemoving(null);
      toast(t('Saved cycle removed'));
      first.refetch();
    } catch {
      toast(t('Could not remove the cycle.'));
    }
  };

  const range = (snapshot: CycleSnapshot) => {
    const from = new Date(snapshot.started_at);
    const to = new Date(snapshot.ended_at);
    const sameDay = from.toDateString() === to.toDateString();
    const day = (date: Date) => date.toLocaleDateString(intlLocale(), { day: 'numeric', month: 'short' });
    return sameDay
      ? `${day(to)} · ${formatTime(snapshot.started_at, use12h())}–${formatTime(snapshot.ended_at, use12h())}`
      : `${day(from)} ${formatTime(snapshot.started_at, use12h())} → ${day(to)} ${formatTime(snapshot.ended_at, use12h())}`;
  };

  return (
    <Show when={!first.error()} fallback={<ErrorNote message={t('Could not load the history.')} onRetry={first.refetch} />}>
      <Show when={first.data()} fallback={<Skeleton rows={4} height={56} />}>
        <Show
          when={count() > 0}
          fallback={
            <EmptyState
              icon={<RotateCcw size={20} />}
              title={t('No saved cycles yet.')}
              hint={t('Press reset on the 24-hour cycle on the Dashboard - the cycle so far is saved here.')}
            />
          }
        >
          <section class={cx(styles.day, styles.sum)} aria-label={t('All saved cycles')}>
            <header class={styles.dayHead}>
              <span class={styles.dayTitle}>{t('All saved cycles')}</span>
              <span class={styles.sumCount}>{count()}</span>
              <span class={styles.dayTotal}>{dur(totals()?.total ?? 0)}</span>
            </header>
            <div class={styles.sumGrid}>
              <For each={KINDS}>
                {(item) => (
                  <div class={cx(styles.sumCell, KIND_TONE[item.kind])}>
                    <span class={styles.sumLabel}>
                      <i class={styles.key} /> {t(item.label)}
                    </span>
                    <b>{dur(totals()?.seconds[item.kind] ?? 0)}</b>
                    <span class={styles.sumAvg}>
                      {t('{time} per cycle', { time: dur(Math.round((totals()?.seconds[item.kind] ?? 0) / Math.max(1, count()))) })}
                    </span>
                  </div>
                )}
              </For>
            </div>
          </section>

          <ul class={styles.cycles}>
            <For each={rows()}>
              {(snapshot) => (
                <li class={styles.cycle}>
                  <div class={styles.cycleHead}>
                    <span class={styles.cycleRange}>{range(snapshot)}</span>
                    <span class={styles.dayTotal}>{dur(snapshot.total)}</span>
                    <button
                      type="button"
                      class={styles.remove}
                      onClick={() => setRemoving(snapshot)}
                      aria-label={t('Remove this saved cycle')}
                      title={t('Remove this saved cycle')}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                  <div class={styles.strip} aria-hidden="true">
                    <For each={present(snapshot.seconds)}>
                      {(item) => (
                        <span
                          class={cx(styles.stripPiece, KIND_TONE[item.kind])}
                          style={{ width: `${(snapshot.seconds[item.kind] / Math.max(1, snapshot.total + snapshot.free_seconds)) * 100}%` }}
                        />
                      )}
                    </For>
                  </div>
                  <div class={styles.chips}>
                    <For each={present(snapshot.seconds)}>
                      {(item) => (
                        <span class={cx(styles.chip, KIND_TONE[item.kind])}>
                          <i class={styles.key} />
                          {t(item.label)} <b>{dur(snapshot.seconds[item.kind])}</b>
                        </span>
                      )}
                    </For>
                    <Show when={snapshot.free_seconds >= 60}>
                      <span class={styles.chip}>
                        {t('Free')} <b>{dur(snapshot.free_seconds)}</b>
                      </span>
                    </Show>
                  </div>
                </li>
              )}
            </For>
          </ul>

          <Show when={nextPage()}>
            <div class={styles.more}>
              <Button variant="ghost" size="sm" loading={loadingMore()} onClick={() => void loadMore()}>
                {t('Show older cycles')}
              </Button>
            </div>
          </Show>

          <ConfirmDialog
            open={removing() !== null}
            title={t('Remove this saved cycle')}
            message={t('Only this saved summary goes. The timer entries themselves stay in By day.')}
            confirmLabel={t('Remove')}
            destructive
            onCancel={() => setRemoving(null)}
            onConfirm={() => void remove()}
          />
        </Show>
      </Show>
    </Show>
  );
}

function DayBlock(props: { day: Day }): JSX.Element {
  const use12h = () => authStore.user()?.preferences.time_format === '12h';
  const present = () => KINDS.filter((item) => (props.day.seconds[item.kind] ?? 0) > 0);
  const length = (start: string, end: string | null) =>
    Math.max(0, Math.floor(((end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime()) / 1000));

  return (
    <section class={styles.day} aria-label={dayTitle(props.day.date)}>
      <header class={styles.dayHead}>
        <span class={styles.dayTitle}>{dayTitle(props.day.date)}</span>
        <span class={styles.dayTotal}>{dur(props.day.total)}</span>
      </header>

      {/* The day as one strip: each activity's share of 24 hours. */}
      <div class={styles.strip} aria-hidden="true">
        <For each={present()}>
          {(item) => <span class={cx(styles.stripPiece, KIND_TONE[item.kind])} style={{ width: `${(props.day.seconds[item.kind] / 86400) * 100}%` }} />}
        </For>
      </div>

      <div class={styles.chips}>
        <For each={present()}>
          {(item) => (
            <span class={cx(styles.chip, KIND_TONE[item.kind])}>
              <i class={styles.key} />
              {t(item.label)} <b>{dur(props.day.seconds[item.kind])}</b>
            </span>
          )}
        </For>
      </div>

      <Show when={props.day.items.length > 0}>
        <ul class={styles.items}>
          <For each={props.day.items}>
            {(item) => (
              <li class={cx(styles.item, KIND_TONE[item.kind])}>
                <span class={styles.time}>
                  {formatTime(item.start, use12h())}–{item.end ? formatTime(item.end, use12h()) : t('now')}
                </span>
                <i class={styles.key} />
                <span class={styles.kind}>{t(KIND_LABEL[item.kind])}</span>
                <span class={styles.label}>{item.label}</span>
                <span class={styles.length}>{dur(length(item.start, item.end))}</span>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </section>
  );
}
