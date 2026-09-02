import { Plus, Trash2 } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { For, Show, createSignal } from 'solid-js';
import { ApiError } from '~/api/client';
import { Button } from '~/components/ui/Button';
import { EmptyState } from '~/components/ui/Feedback';
import { Field, Input, Select, Textarea } from '~/components/ui/Input';
import { Modal } from '~/components/ui/Modal';
import { Breakdown, Stat } from '~/features/insights/Charts';
import { Block, InsightsPage, StatGrid, TwoCol, shortDate } from '~/features/insights/InsightsPage';
import { ProjectSelector } from '~/features/projects/ProjectSelector';
import { timeApi } from '~/features/routines/api';
import { analyticsApi, isoDay, shiftDays, shiftMonths } from '~/features/today/api';
import { createQuery } from '~/hooks/createQuery';
import { toast } from '~/stores/ui';
import type { Paginated } from '~/api/client';
import type { TimeEntry, TimeTotals, WeeklyReview } from '~/types';
import { formatDuration, formatTime, fromLocalInputValue, toLocalInputValue } from '~/utils/format';
import styles from './Time.module.css';

type Window = 'today' | 'week' | 'month';

const secondsFmt = (s: number) => formatDuration(s);

export default function InsightsTime(): JSX.Element {
  const today = isoDay(new Date());
  const [date, setDate] = createSignal(today);
  const [window, setWindow] = createSignal<Window>('week');
  const [adding, setAdding] = createSignal(false);

  const totals = createQuery<TimeTotals>(
    () => `timer:totals:${window()}:${date()}`,
    () => timeApi.totals({ window: window(), date: date() }),
    { staleMs: 15_000 },
  );
  const entries = createQuery<Paginated<TimeEntry>>(
    () => `timer:entries:${window()}:${date()}`,
    () => timeApi.entries({ window: window(), date: date(), page_size: 100 }),
    { staleMs: 15_000 },
  );
  // Project names come from the weekly review's lookup table; cheap and already cached for the Weekly tab.
  const names = createQuery<WeeklyReview>(() => `analytics:weekly:${date()}`, () => analyticsApi.weekly(date()), { staleMs: 60_000 });

  const t = () => totals.data();
  const projectName = (id: number) => names.data()?.projects[String(id)] ?? `Project ${id}`;
  const step = (dir: 1 | -1) =>
    setDate(window() === 'month' ? shiftMonths(date(), dir) : shiftDays(date(), window() === 'week' ? 7 * dir : dir));

  const periodLabel = () => {
    const data = t();
    if (!data) return '…';
    if (window() === 'today') return date() === today ? 'Today' : shortDate(date());
    return `${shortDate(data.start_date)} – ${shortDate(data.end_date)}`;
  };

  const remove = async (entry: TimeEntry) => {
    try {
      await timeApi.remove(entry.id);
      toast('Entry deleted');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not delete.');
    }
  };

  const grouped = () => {
    const map = new Map<string, TimeEntry[]>();
    for (const e of entries.data()?.results ?? []) {
      const key = e.started_at.slice(0, 10);
      map.set(key, [...(map.get(key) ?? []), e]);
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  };

  return (
    <InsightsPage
      title="Insights"
      periodLabel={periodLabel()}
      onPrev={() => step(-1)}
      onNext={() => step(1)}
      onToday={() => setDate(today)}
      nextDisabled={date() >= today}
      loading={totals.loading() && !t()}
      error={totals.error()}
      onRetry={() => {
        totals.refetch();
        entries.refetch();
      }}
      actions={
        <div class={styles.actions}>
          <div class={styles.segment} role="tablist">
            <For each={['today', 'week', 'month'] as Window[]}>
              {(w) => (
                <button type="button" role="tab" aria-selected={window() === w} class={styles.segmentBtn} onClick={() => setWindow(w)}>
                  {w === 'today' ? 'Day' : w === 'week' ? 'Week' : 'Month'}
                </button>
              )}
            </For>
          </div>
          <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
            <Plus size={14} /> Add time
          </Button>
        </div>
      }
    >
      <StatGrid>
        <Stat label="Business" value={secondsFmt(t()?.business ?? 0)} />
        <Stat label="Personal" value={secondsFmt(t()?.personal ?? 0)} />
        <Stat label="Total tracked" value={secondsFmt(t()?.total ?? 0)} />
        <Stat label="Sleep" value={secondsFmt(t()?.sleep ?? 0)} />
      </StatGrid>

      <TwoCol>
        <Block title="By project">
          <Breakdown
            rows={(t()?.by_project ?? []).map((r) => ({ label: projectName(r.project_id), value: r.seconds })).sort((a, b) => b.value - a.value)}
            format={secondsFmt}
            emptyText="No project time in this period."
          />
        </Block>
        <Block title="By task" hint={`${t()?.by_task.length ?? 0} tasks`}>
          <Breakdown
            rows={(t()?.by_task ?? [])
              .map((r) => ({
                label: entries.data()?.results.find((e: TimeEntry) => e.task?.id === r.task_id)?.task?.title ?? `Task ${r.task_id}`,
                value: r.seconds,
              }))
              .sort((a, b) => b.value - a.value)
              .slice(0, 10)}
            format={secondsFmt}
            emptyText="No task-linked time in this period."
          />
        </Block>
      </TwoCol>

      <Block title="Entries" hint={`${entries.data()?.count ?? 0}`}>
        <Show when={grouped().length > 0} fallback={<EmptyState title="No time entries in this period." hint="Start the timer or add time manually." compact />}>
          <div class={styles.groups}>
            <For each={grouped()}>
              {([day, list]) => (
                <div class={styles.group}>
                  <div class={styles.groupHead}>
                    <span>{shortDate(day)}</span>
                    <span class={styles.mono}>{secondsFmt(list.reduce((s, e) => s + e.duration_seconds, 0))}</span>
                  </div>
                  <ul class={styles.entries}>
                    <For each={list}>
                      {(e) => (
                        <li class={styles.entry}>
                          <span class={styles.time}>
                            {formatTime(e.started_at)}
                            {e.ended_at ? `–${formatTime(e.ended_at)}` : ' →'}
                          </span>
                          <span class={styles.what}>
                            {e.task?.title || e.routine_item?.name || e.note || (e.category === 'business' ? 'Business' : 'Personal')}
                            <Show when={e.project}>
                              <span class={styles.project}> · {e.project?.name}</span>
                            </Show>
                          </span>
                          <span class={styles.cat}>{e.category}</span>
                          <span class={styles.mono}>{e.is_running ? 'running' : secondsFmt(e.duration_seconds)}</span>
                          <button type="button" class={styles.del} onClick={() => void remove(e)} aria-label="Delete entry" disabled={e.is_running}>
                            <Trash2 size={13} />
                          </button>
                        </li>
                      )}
                    </For>
                  </ul>
                </div>
              )}
            </For>
          </div>
        </Show>
      </Block>

      <ManualEntryDialog open={adding()} onClose={() => setAdding(false)} />
    </InsightsPage>
  );
}

function ManualEntryDialog(props: { open: boolean; onClose: () => void }): JSX.Element {
  const [start, setStart] = createSignal(toLocalInputValue(new Date(Date.now() - 3600e3).toISOString()));
  const [end, setEnd] = createSignal(toLocalInputValue(new Date().toISOString()));
  const [category, setCategory] = createSignal<'business' | 'personal'>('business');
  const [projectId, setProjectId] = createSignal<number | null>(null);
  const [note, setNote] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');

  const submit = async () => {
    const s = fromLocalInputValue(start());
    const e = fromLocalInputValue(end());
    if (!s || !e) {
      setError('Both start and end are required.');
      return;
    }
    if (e <= s) {
      setError('End must be after start.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await timeApi.addManual({ started_at: s, ended_at: e, category: category(), project_id: projectId(), note: note().trim() });
      toast('Time added');
      props.onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={props.open} onClose={props.onClose} title="Add time manually" size="sm">
      <form
        class={styles.form}
        onSubmit={(ev) => {
          ev.preventDefault();
          void submit();
        }}
      >
        <div class={styles.formGrid}>
          <Field label="Start">
            <Input type="datetime-local" value={start()} onInput={(ev) => setStart(ev.currentTarget.value)} required />
          </Field>
          <Field label="End">
            <Input type="datetime-local" value={end()} onInput={(ev) => setEnd(ev.currentTarget.value)} required />
          </Field>
        </div>
        <div class={styles.formGrid}>
          <Field label="Category">
            <Select value={category()} onChange={(ev) => setCategory(ev.currentTarget.value as 'business' | 'personal')}>
              <option value="business">Business</option>
              <option value="personal">Personal</option>
            </Select>
          </Field>
          <Field label="Project">
            <ProjectSelector value={projectId()} onChange={setProjectId} />
          </Field>
        </div>
        <Field label="Note">
          <Textarea rows={2} value={note()} onInput={(ev) => setNote(ev.currentTarget.value)} maxLength={500} />
        </Field>
        <Show when={error()}>
          <p class={styles.error}>{error()}</p>
        </Show>
        <div class={styles.formActions}>
          <Button variant="ghost" type="button" onClick={props.onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" loading={busy()}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}
