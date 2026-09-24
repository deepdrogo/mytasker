import { A } from '@solidjs/router';
import { Bitcoin, CalendarDays, CalendarX, ChevronLeft, ChevronRight, Infinity as InfinityIcon } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { Button } from '~/components/ui/Button';
import { Input, Select } from '~/components/ui/Input';
import { projectsApi } from '~/features/projects/api';
import { settingsApi } from '~/features/settings/api';
import { tasksApi } from '~/features/tasks/api';
import { createQuery } from '~/hooks/createQuery';
import { locale, t } from '~/i18n';
import { authStore } from '~/stores/auth';
import { toast } from '~/stores/ui';
import type { Priority, Project, Task } from '~/types';
import styles from './ProjectTimeline.module.css';
import {
  addDays,
  diffDays,
  iso,
  overlapsWindow,
  parseDate,
  previewRange,
  rangeForSave,
  sameRange,
  windowColumns,
  type DateRange,
  type DragMode,
} from './timelineMath';

const DAY_MS = 86_400_000;
/** How many months the board shows at once: the anchor month plus the two that follow. */
const WINDOW_MONTHS = 3;
/** A plain click (no horizontal drag) schedules this many days, long enough to grab and stretch. */
const DEFAULT_SPAN_DAYS = 3;
const DRAG_THRESHOLD_PX = 4;
const CRYPTO_KEY = 'crypto';
/** Crypto world's gold, matching its icon. */
const CRYPTO_HUE = 40;

/**
 * One schedulable line on the board: a project, or the Crypto world list (not a project, so its dates
 * live in the user's preferences). Both are drawn, dragged, stretched and removed the same way.
 */
interface TimelineRow {
  key: string;
  name: string;
  href: string;
  editable: boolean;
  dates: DateRange;
  hue: number;
  priority?: Priority;
  project?: Project;
}

interface DragState {
  key: string;
  mode: DragMode;
  base: DateRange;
  /** Day under the pointer when the drag started, and where it is now. */
  from: string;
  to: string;
  originX: number;
  moved: boolean;
}

function intl(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(locale() === 'ka' ? 'ka-GE' : 'en', options);
}

function taskDate(task: Task): string | null {
  return (task.due_at ?? task.start_at)?.slice(0, 10) ?? null;
}

export function ProjectTimeline(props: { projects: () => Project[]; onChanged: () => void }): JSX.Element {
  const today = iso(new Date());
  const thisMonth = () => new Date(parseDate(today).getFullYear(), parseDate(today).getMonth(), 1);

  const [anchor, setAnchor] = createSignal(thisMonth());
  /** Server copies returned by our own saves; they win until the list query catches up. */
  const [patched, setPatched] = createSignal<Record<number, Project>>({});
  /** Dates shown immediately after a drag, before the server confirms them. */
  const [pending, setPending] = createSignal<Record<string, DateRange>>({});
  const [drag, setDrag] = createSignal<DragState | null>(null);
  const [saving, setSaving] = createSignal<string | null>(null);
  const [selected, setSelected] = createSignal('');
  const [manualStart, setManualStart] = createSignal(today);
  const [manualEnd, setManualEnd] = createSignal('');

  let scroller: HTMLDivElement | undefined;
  let dayHeader: HTMLDivElement | undefined;

  const crypto = createQuery(
    () => 'tasks:project-timeline:crypto',
    () => tasksApi.list({ kind: 'crypto', top_level: true, completed: false, ordering: 'due', page_size: 200 }),
  );

  const days = createMemo(() => {
    const first = anchor();
    const last = new Date(first.getFullYear(), first.getMonth() + WINDOW_MONTHS, 0);
    const count = Math.round((last.getTime() - first.getTime()) / DAY_MS) + 1;
    return Array.from({ length: count }, (_, index) => new Date(first.getFullYear(), first.getMonth(), index + 1));
  });
  const rangeStart = () => iso(days()[0]!);
  const rangeEnd = () => iso(days()[days().length - 1]!);

  const months = createMemo(() => {
    const groups: Array<{ key: string; label: string; span: number }> = [];
    for (const date of days()) {
      const key = `${date.getFullYear()}-${date.getMonth()}`;
      const last = groups[groups.length - 1];
      if (last?.key === key) last.span += 1;
      else groups.push({ key, label: intl({ month: 'long', year: 'numeric' }).format(date), span: 1 });
    }
    return groups;
  });

  /** The freshest copy we know of: our own save response beats a not-yet-refetched list entry. */
  const resolve = (project: Project): Project => {
    const patch = patched()[project.id];
    return patch && patch.version >= project.version ? patch : project;
  };

  const baseDates = (row: TimelineRow): DateRange => pending()[row.key] ?? row.dates;

  /** Dates as they should look right now, including the range being dragged. */
  const datesOf = (row: TimelineRow): DateRange => {
    const active = drag();
    const base = baseDates(row);
    if (!active || active.key !== row.key) return base;
    return previewRange(active.base, active.mode, active.from, active.to);
  };

  const visible = (dates: DateRange): boolean => overlapsWindow(dates, rangeStart(), rangeEnd());

  /** Scheduled projects first, in date order; unscheduled rows stay below, ready to be drawn on. */
  const projectRows = createMemo<TimelineRow[]>(() =>
    props
      .projects()
      .map((project) => {
        const fresh = resolve(project);
        return {
          key: `p${project.id}`,
          name: project.name,
          href: `/projects/${project.id}/tasks`,
          editable: Boolean(project.capabilities.manage_project),
          dates: { start: fresh.start_date, end: fresh.deadline },
          hue: (project.id * 47 + 185) % 360,
          priority: project.priority,
          project,
        };
      })
      .sort((a, b) => {
        const first = baseDates(a).start;
        const second = baseDates(b).start;
        if (first && second) return first === second ? a.name.localeCompare(b.name) : first < second ? -1 : 1;
        if (first) return -1;
        if (second) return 1;
        return a.name.localeCompare(b.name);
      }),
  );

  /** Crypto world always sits on the last line: it is a private list, not one of the projects. */
  const cryptoRow = createMemo<TimelineRow>(() => {
    const prefs = authStore.user()?.preferences;
    return {
      key: CRYPTO_KEY,
      name: t('Crypto world'),
      href: '/tasks/crypto',
      editable: Boolean(authStore.user()),
      dates: { start: prefs?.crypto_world_start ?? null, end: prefs?.crypto_world_end ?? null },
      hue: CRYPTO_HUE,
    };
  });

  const allRows = createMemo(() => [...projectRows(), cryptoRow()]);
  const rowByKey = (key: string) => allRows().find((row) => row.key === key);

  const activeToday = createMemo(() =>
    allRows().filter((row) => {
      const dates = baseDates(row);
      return Boolean(dates.start && dates.start <= today && (!dates.end || dates.end >= today));
    }),
  );

  const cryptoByDate = createMemo(() => {
    const map = new Map<string, Task[]>();
    for (const task of crypto.data()?.results ?? []) {
      const date = taskDate(task);
      if (!date || date < rangeStart() || date > rangeEnd()) continue;
      map.set(date, [...(map.get(date) ?? []), task]);
    }
    return [...map.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  });

  const chosen = () => rowByKey(selected());

  const persist = async (row: TimelineRow, next: DateRange) => {
    if (row.project) {
      const fresh = await projectsApi.update(row.project.id, {
        start_date: next.start,
        deadline: next.end,
        version: resolve(row.project).version,
      });
      setPatched((all) => ({ ...all, [row.project!.id]: fresh }));
      props.onChanged();
      return;
    }
    // Refreshes the signed-in user, so the Crypto world row redraws from the saved preferences.
    await settingsApi.updatePreferences({ crypto_world_start: next.start, crypto_world_end: next.end });
  };

  const save = async (row: TimelineRow, dates: DateRange, options?: { removed?: boolean }) => {
    // No start means "not on the calendar" — clear both ends together so a leftover end date
    // cannot keep a ghost bar after the user takes the row off.
    const next = rangeForSave(dates);
    if (sameRange(baseDates(row), next)) return;
    setPending((all) => ({ ...all, [row.key]: next }));
    setSaving(row.key);
    try {
      await persist(row, next);
      if (options?.removed) toast(t('Removed from calendar'));
    } catch {
      toast(row.project ? t('Could not save the project schedule.') : t('Could not save the Crypto world dates.'));
    } finally {
      setPending((all) => {
        const remaining = { ...all };
        delete remaining[row.key];
        return remaining;
      });
      setSaving(null);
    }
  };

  const unschedule = (row: TimelineRow) => {
    if (!row.editable || saving() === row.key) return;
    if (drag()?.key === row.key) setDrag(null);
    void save(row, { start: null, end: null }, { removed: true });
  };

  const stopBarGesture = (event: PointerEvent) => {
    event.stopPropagation();
  };

  /** Which calendar day sits under this x coordinate, clamped to the visible window. */
  const dateAtX = (clientX: number): string => {
    const list = days();
    if (!dayHeader) return rangeStart();
    const rect = dayHeader.getBoundingClientRect();
    const width = rect.width / list.length;
    const index = Math.min(list.length - 1, Math.max(0, Math.floor((clientX - rect.left) / width)));
    return iso(list[index]!);
  };

  const autoScroll = (clientX: number) => {
    if (!scroller) return;
    const rect = scroller.getBoundingClientRect();
    if (clientX < rect.left + 64) scroller.scrollLeft -= 16;
    else if (clientX > rect.right - 64) scroller.scrollLeft += 16;
  };

  const begin = (event: PointerEvent, row: TimelineRow, mode: DragMode) => {
    if (!row.editable || event.button !== 0) return;
    // Touch keeps its natural panning over empty rows; there the date pickers below do the scheduling.
    if (mode === 'create' && event.pointerType !== 'mouse') return;
    event.preventDefault();
    event.stopPropagation();
    const at = dateAtX(event.clientX);
    setDrag({ key: row.key, mode, base: baseDates(row), from: at, to: at, originX: event.clientX, moved: false });
  };

  const onPointerMove = (event: PointerEvent) => {
    const active = drag();
    if (!active) return;
    event.preventDefault();
    autoScroll(event.clientX);
    setDrag({
      ...active,
      to: dateAtX(event.clientX),
      moved: active.moved || Math.abs(event.clientX - active.originX) > DRAG_THRESHOLD_PX,
    });
  };

  const onPointerUp = () => {
    const active = drag();
    setDrag(null);
    if (!active) return;
    const row = rowByKey(active.key);
    if (!row) return;
    // Read the range off the finished gesture: the drag state is already cleared by now.
    const dates = previewRange(active.base, active.mode, active.from, active.to);
    // A click without movement still deserves a bar you can grab, so give it a default span.
    const commit =
      active.mode === 'create' && !active.moved && dates.start
        ? { start: dates.start, end: addDays(dates.start, DEFAULT_SPAN_DAYS - 1) }
        : dates;
    void save(row, commit);
  };

  onMount(() => {
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    scrollToToday();
  });
  onCleanup(() => {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
  });

  const scrollToToday = () => {
    if (!scroller || today < rangeStart() || today > rangeEnd()) return;
    const width = scroller.scrollWidth / days().length;
    scroller.scrollTo({ left: Math.max(0, (diffDays(rangeStart(), today) - 3) * width), behavior: 'smooth' });
  };

  const shiftMonths = (amount: number) => {
    const current = anchor();
    setAnchor(new Date(current.getFullYear(), current.getMonth() + amount, 1));
  };

  const jumpTo = (date: string) => setAnchor(new Date(parseDate(date).getFullYear(), parseDate(date).getMonth(), 1));

  const columnStyle = (dates: DateRange): JSX.CSSProperties => {
    const { offset, span } = windowColumns(dates, rangeStart(), rangeEnd());
    return { '--start': String(offset), '--span': String(span) } as JSX.CSSProperties;
  };

  const rangeTitle = (dates: DateRange): string => `${dates.start} → ${dates.end ?? t('ongoing')}`;

  const hueStyle = (row: TimelineRow): JSX.CSSProperties => ({ '--project-hue': String(row.hue) }) as JSX.CSSProperties;

  const placeManually = () => {
    const row = chosen();
    if (!row || !manualStart()) return;
    const end = manualEnd() || null;
    void save(row, { start: manualStart(), end: end && end < manualStart() ? manualStart() : end });
  };

  const dayCells = () => (
    <For each={days()}>
      {(date) => (
        <div
          class={[
            styles.cell,
            iso(date) === today ? styles.todayCell : '',
            date.getDay() === 0 || date.getDay() === 6 ? styles.weekend : '',
          ]
            .filter(Boolean)
            .join(' ')}
        />
      )}
    </For>
  );

  const renderRow = (row: TimelineRow) => {
    const isCrypto = row.key === CRYPTO_KEY;
    const dates = () => datesOf(row);
    const dragging = () => drag()?.key === row.key;
    return (
      <>
        <A
          class={[styles.rowLabel, isCrypto ? styles.cryptoLabel : ''].filter(Boolean).join(' ')}
          href={row.href}
          title={row.name}
          style={hueStyle(row)}
        >
          <Show when={isCrypto} fallback={<span class={styles.projectDot} data-priority={row.priority} />}>
            <Bitcoin size={14} />
          </Show>
          <span class={styles.rowName}>{row.name}</span>
        </A>
        <div
          class={[
            styles.track,
            isCrypto ? styles.cryptoTrack : styles.projectTrack,
            row.editable ? styles.editable : '',
            saving() === row.key ? styles.busy : '',
          ]
            .filter(Boolean)
            .join(' ')}
          style={hueStyle(row)}
          onPointerDown={(event) => {
            // Only unscheduled rows can be drawn on; dated work is moved by its own bar,
            // so a stray click on a row whose dates sit off-screen never reschedules it.
            if (!dates().start) begin(event, row, 'create');
          }}
        >
          {dayCells()}

          <Show when={!dates().start && !dragging()}>
            <span class={styles.rowHint}>
              {row.editable ? t('Drag across this row to schedule it') : t('Not scheduled')}
            </span>
          </Show>

          <Show when={dates().start && !visible(dates()) && !dragging()}>
            <div class={styles.offscreen}>
              <button
                type="button"
                class={styles.jump}
                onPointerDown={stopBarGesture}
                onClick={() => jumpTo(dates().start!)}
                title={rangeTitle(dates())}
              >
                <Show when={dates().start! < rangeStart()} fallback={<ChevronRight size={13} />}>
                  <ChevronLeft size={13} />
                </Show>
                {t('Jump to dates')}
              </button>
              <Show when={row.editable}>
                <button
                  type="button"
                  class={styles.jump}
                  onPointerDown={stopBarGesture}
                  onClick={() => unschedule(row)}
                  aria-label={t('Remove from calendar')}
                  title={t('Remove from calendar')}
                >
                  <CalendarX size={13} />
                  {t('Remove from calendar')}
                </button>
              </Show>
            </div>
          </Show>

          <Show when={dates().start && visible(dates())}>
            <div
              class={[styles.block, !dates().end ? styles.openEnded : '', dragging() ? styles.dragging : '']
                .filter(Boolean)
                .join(' ')}
              style={columnStyle(dates())}
              onPointerDown={(event) => begin(event, row, 'move')}
              title={rangeTitle(dates())}
            >
              <Show when={row.editable}>
                <span class={styles.handle} onPointerDown={(event) => begin(event, row, 'start')} aria-hidden="true" />
              </Show>
              <span class={styles.blockLabel}>
                <span class={styles.blockText}>{row.name}</span>
                <Show when={!dates().end}>
                  <InfinityIcon size={13} class={styles.openIcon} />
                </Show>
                <Show when={row.editable && !dragging()}>
                  <button
                    type="button"
                    class={styles.remove}
                    onPointerDown={stopBarGesture}
                    onClick={(event) => {
                      event.stopPropagation();
                      unschedule(row);
                    }}
                    aria-label={t('Remove from calendar')}
                    title={t('Remove from calendar')}
                  >
                    <CalendarX size={12} />
                  </button>
                </Show>
              </span>
              <Show when={row.editable}>
                <span
                  class={`${styles.handle} ${styles.handleEnd}`}
                  onPointerDown={(event) => begin(event, row, 'end')}
                  aria-hidden="true"
                />
              </Show>
            </div>
          </Show>

          {/* Crypto world: its open tasks marked on their due dates, on top of the scheduled span. */}
          <Show when={isCrypto}>
            <For each={cryptoByDate()}>
              {([date, tasks]) => (
                <A
                  href="/tasks/crypto"
                  class={styles.cryptoMark}
                  style={{ '--start': String(diffDays(rangeStart(), date)) } as JSX.CSSProperties}
                  title={`${date} · ${tasks.map((task) => task.title).join(', ')}`}
                  onPointerDown={stopBarGesture}
                >
                  <Bitcoin size={12} />
                  <Show when={tasks.length > 1}>
                    <b>{tasks.length}</b>
                  </Show>
                </A>
              )}
            </For>
          </Show>
        </div>
      </>
    );
  };

  return (
    <section class={styles.timeline} aria-label={t('Project calendar')}>
      <div class={styles.top}>
        <div class={styles.heading}>
          <div class={styles.eyebrow}>
            <CalendarDays size={14} /> {t('Project timeline')}
          </div>
          <h2>
            {months()[0]?.label} – {months()[months().length - 1]?.label}
          </h2>
          <p>{t('Draw across a row to schedule a project. Drag, stretch, or remove it from the calendar.')}</p>
        </div>
        <div class={styles.monthActions}>
          <Button variant="ghost" size="icon-sm" onClick={() => shiftMonths(-1)} aria-label={t('Previous month')}>
            <ChevronLeft size={16} />
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setAnchor(thisMonth());
              queueMicrotask(scrollToToday);
            }}
          >
            {t('Today')}
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => shiftMonths(1)} aria-label={t('Next month')}>
            <ChevronRight size={16} />
          </Button>
        </div>
      </div>

      <div class={styles.todayBar}>
        <span class={styles.todayDate}>{intl({ weekday: 'long', day: 'numeric', month: 'long' }).format(parseDate(today))}</span>
        <Show when={activeToday().length} fallback={<span class={styles.todayEmpty}>{t('Nothing scheduled for today')}</span>}>
          <span class={styles.todayLabel}>{t('In progress today')}</span>
          <For each={activeToday()}>
            {(row) => (
              <A href={row.href} class={styles.todayChip}>
                {row.name}
              </A>
            )}
          </For>
        </Show>
      </div>

      <div class={styles.planner}>
        <Select value={selected()} onChange={(event) => setSelected(event.currentTarget.value)} aria-label={t('Choose project')}>
          <option value="">{t('Choose project')}</option>
          <For each={allRows().filter((row) => row.editable)}>{(row) => <option value={row.key}>{row.name}</option>}</For>
        </Select>
        <Input
          type="date"
          value={manualStart()}
          onInput={(event) => setManualStart(event.currentTarget.value)}
          aria-label={t('Start date')}
        />
        <Input
          type="date"
          value={manualEnd()}
          min={manualStart()}
          onInput={(event) => setManualEnd(event.currentTarget.value)}
          aria-label={t('End date (optional)')}
        />
        <div class={styles.plannerActions}>
          <Button size="sm" disabled={!chosen() || !manualStart() || saving() === selected()} onClick={placeManually}>
            {t('Place on calendar')}
          </Button>
          <Show when={chosen() && baseDates(chosen()!).start && chosen()!.editable}>
            <Button size="sm" variant="ghost" disabled={saving() === selected()} onClick={() => unschedule(chosen()!)}>
              <CalendarX size={14} />
              {t('Remove from calendar')}
            </Button>
          </Show>
        </div>
      </div>

      <div class={styles.scroller} ref={scroller}>
        <div class={styles.calendar} style={{ '--days': String(days().length) }}>
          <div class={`${styles.labelCell} ${styles.cornerTop}`} />
          <div class={styles.monthBand}>
            <For each={months()}>
              {(month) => (
                <div class={styles.monthCell} style={{ '--span': String(month.span) } as JSX.CSSProperties}>
                  <span>{month.label}</span>
                </div>
              )}
            </For>
          </div>

          <div class={`${styles.labelCell} ${styles.corner}`}>{t('Project')}</div>
          <div class={styles.dayHeader} ref={dayHeader}>
            <For each={days()}>
              {(date) => (
                <div
                  class={[
                    styles.day,
                    iso(date) === today ? styles.today : '',
                    date.getDay() === 0 || date.getDay() === 6 ? styles.weekend : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <span>{intl({ weekday: 'narrow' }).format(date)}</span>
                  <b>{date.getDate()}</b>
                </div>
              )}
            </For>
          </div>

          <For each={projectRows()}>{(row) => renderRow(row)}</For>
          {renderRow(cryptoRow())}
        </div>
      </div>

      <div class={styles.legend}>
        <span>
          <i class={styles.todayKey} /> {t('Today')}
        </span>
        <span>
          <InfinityIcon size={12} /> {t('No end date')}
        </span>
        <span>
          <CalendarX size={12} /> {t('Remove from calendar')}
        </span>
        <span>{t('Overlapping projects stay visible on separate rows.')}</span>
      </div>
    </section>
  );
}
