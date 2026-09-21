// MyTasker — inline search in the top bar. Type anything; tasks, projects, prompts, ideas, routine and pages answer.
// Built by drogoz · https://github.com/deepdrogo/mytasker

import { useNavigate } from '@solidjs/router';
import { ArrowRight, Check, CornerDownLeft, FileText, FolderKanban, Handshake, Lightbulb, ListChecks, Plus, Search, X } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show } from 'solid-js';
import { PriorityMark } from '~/components/shared/Indicators';
import { registerSearchFocus } from '~/features/search/focus';
import { NAV_TARGETS } from '~/features/search/navTargets';
import {
  EMPTY_RESULTS,
  highlightSegments,
  normalizeTerm,
  SEARCH_DEBOUNCE_MS,
  SEARCH_MIN_CHARS,
  searchEverything,
  splitWords,
} from '~/features/search/searchClient';
import { TaskEditor } from '~/features/tasks/TaskEditor';
import { tasksApi } from '~/features/tasks/api';
import { t } from '~/i18n';
import { authStore } from '~/stores/auth';
import { tx } from '~/stores/translations';
import { toast } from '~/stores/ui';
import type { SearchResults, Task } from '~/types';
import { taskKindLabel } from '~/utils/taskKind';
import { cx } from '~/utils/cx';
import styles from './GlobalSearch.module.css';

interface Row {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: JSX.Element;
  muted?: boolean;
  run: () => void;
}

export function GlobalSearch(): JSX.Element {
  const navigate = useNavigate();
  const [query, setQuery] = createSignal('');
  const [open, setOpen] = createSignal(false);
  const [results, setResults] = createSignal<SearchResults>(EMPTY_RESULTS);
  const [searching, setSearching] = createSignal(false);
  const [index, setIndex] = createSignal(0);
  const [openTask, setOpenTask] = createSignal<Task | null>(null);
  let root: HTMLDivElement | undefined;
  let input: HTMLInputElement | undefined;
  let list: HTMLUListElement | undefined;
  let debounce: number | undefined;
  let abort: AbortController | undefined;

  const term = () => normalizeTerm(query());
  const words = createMemo(() => splitWords(query()));

  const close = () => {
    setOpen(false);
    setIndex(0);
  };
  const reset = () => {
    setQuery('');
    setResults(EMPTY_RESULTS);
    close();
  };
  const go = (href: string) => {
    reset();
    input?.blur();
    navigate(href);
  };

  onMount(() => {
    registerSearchFocus(() => {
      input?.focus();
      input?.select();
      setOpen(true);
    });
    const onDocClick = (event: MouseEvent) => {
      if (root && !root.contains(event.target as Node)) close();
    };
    document.addEventListener('mousedown', onDocClick);
    onCleanup(() => {
      document.removeEventListener('mousedown', onDocClick);
      registerSearchFocus(null);
      window.clearTimeout(debounce);
      abort?.abort();
    });
  });

  createEffect(
    on(query, (q) => {
      setIndex(0);
      window.clearTimeout(debounce);
      abort?.abort();
      const value = normalizeTerm(q);
      if (value.length < SEARCH_MIN_CHARS) {
        setResults(EMPTY_RESULTS);
        setSearching(false);
        return;
      }
      setSearching(true);
      debounce = window.setTimeout(async () => {
        abort = new AbortController();
        const mine = abort;
        try {
          const data = await searchEverything(value, mine.signal);
          if (!mine.signal.aborted) setResults(data);
        } catch {
          /* aborted or failed - keep what is on screen */
        } finally {
          if (!mine.signal.aborted) setSearching(false);
        }
      }, SEARCH_DEBOUNCE_MS);
    }),
  );

  const pages = createMemo(() => {
    const needle = term().toLowerCase();
    if (!needle) return [];
    return NAV_TARGETS.filter(
      (target) =>
        (!target.adminOnly || authStore.isAdmin()) &&
        `${target.label} ${t(target.label)} ${target.keywords ?? ''}`.toLowerCase().includes(needle),
    ).slice(0, 4);
  });

  const rows = createMemo<Row[]>(() => {
    const out: Row[] = [];
    const r = results();
    for (const task of r.tasks) {
      const done = task.status === 'done';
      out.push({
        id: `task-${task.id}`,
        group: t('Tasks'),
        label: tx('task', task.id, 'title', task.title),
        hint: [
          task.is_client ? t('Client') : '',
          task.project ? tx('project', task.project.id, 'name', task.project.name) : taskKindLabel(task.kind),
          done ? t('done') : '',
        ]
          .filter(Boolean)
          .join(' · '),
        icon: done ? <Check size={13} /> : task.is_client ? <Handshake size={13} /> : <PriorityMark priority={task.priority} />,
        muted: done,
        run: () => {
          close();
          setOpenTask(task);
        },
      });
    }
    for (const project of r.projects) {
      out.push({
        id: `project-${project.id}`,
        group: t('Projects'),
        label: tx('project', project.id, 'name', project.name),
        hint: project.progress === null ? undefined : `${project.progress}%`,
        icon: <FolderKanban size={14} />,
        run: () => go(`/projects/${project.id}/tasks`),
      });
    }
    for (const prompt of r.prompts) {
      out.push({
        id: `prompt-${prompt.id}`,
        group: t('Prompts'),
        label: tx('prompt', prompt.id, 'title', prompt.title),
        hint: prompt.category ? tx('prompt', prompt.id, 'category', prompt.category) : undefined,
        icon: <FileText size={14} />,
        run: () => go(`/prompts/${prompt.id}`),
      });
    }
    for (const idea of r.ideas) {
      out.push({ id: `idea-${idea.id}`, group: t('Ideas'), label: tx('idea', idea.id, 'title', idea.title), icon: <Lightbulb size={14} />, run: () => go('/projects/ideas') });
    }
    for (const item of r.routine_items) {
      out.push({
        id: `routine-${item.id}`,
        group: t('Routine'),
        label: tx('routine_item', item.id, 'name', item.name),
        hint: item.kind === 'business' ? t('Business') : t('Personal'),
        icon: <ListChecks size={14} />,
        run: () => go(`/routine/${item.kind}`),
      });
    }
    for (const page of pages()) {
      out.push({ id: `page-${page.id}`, group: t('Pages'), label: t(page.label), icon: <ArrowRight size={14} />, run: () => go(page.href) });
    }
    if (term()) {
      const title = term();
      out.push({
        id: 'create',
        group: t('Create'),
        label: t('Create task “{title}”', { title }),
        icon: <Plus size={14} />,
        run: () => {
          reset();
          void tasksApi
            .create({ title })
            .then(() => toast(t('Task created')))
            .catch(() => toast(t('Could not create the task.')));
        },
      });
    }
    return out;
  });

  const onKey = (event: KeyboardEvent) => {
    const total = rows().length;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setIndex((i) => (total ? (i + 1) % total : 0));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setIndex((i) => (total ? (i - 1 + total) % total : 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      rows()[index()]?.run();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      if (query()) reset();
      else {
        close();
        input?.blur();
      }
    }
    queueMicrotask(() => list?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }));
  };

  const showPanel = () => open() && term().length >= SEARCH_MIN_CHARS;

  return (
    <>
      <div ref={root} class={cx(styles.root, open() && styles.rootOpen)}>
        <div class={styles.field}>
          <Search size={14} class={styles.icon} />
          <input
            ref={input}
            class={styles.input}
            type="search"
            value={query()}
            placeholder={t('Search everything…')}
            aria-label={t('Search everything')}
            role="combobox"
            aria-expanded={showPanel()}
            aria-controls="global-search-results"
            aria-autocomplete="list"
            autocomplete="off"
            spellcheck={false}
            onInput={(event) => {
              setQuery(event.currentTarget.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKey}
          />
          <Show when={searching()}>
            <span class={styles.searching} aria-live="polite" />
          </Show>
          <Show
            when={query()}
            fallback={
              <kbd class={styles.kbd} title={t('Press / to search')}>
                /
              </kbd>
            }
          >
            <button type="button" class={styles.clear} onClick={() => { reset(); input?.focus(); }} aria-label={t('Clear search')}>
              <X size={13} />
            </button>
          </Show>
        </div>

        <Show when={showPanel()}>
          <div class={styles.panel} role="presentation">
            <ul ref={list} id="global-search-results" class={styles.results} role="listbox">
              <For each={rows()}>
                {(row, i) => (
                  <>
                    <Show when={i() === 0 || rows()[i() - 1]?.group !== row.group}>
                      <li class={styles.groupLabel} role="presentation">
                        {row.group}
                      </li>
                    </Show>
                    <li
                      role="option"
                      aria-selected={i() === index()}
                      class={cx(styles.row, i() === index() && styles.rowActive, row.muted && styles.rowMuted)}
                      onMouseEnter={() => setIndex(i())}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={row.run}
                    >
                      <span class={styles.rowIcon}>{row.icon}</span>
                      <span class={styles.rowLabel}>
                        <For each={highlightSegments(row.label, words())}>
                          {(segment) => (segment.hit ? <mark class={styles.mark}>{segment.text}</mark> : segment.text)}
                        </For>
                      </span>
                      <Show when={row.hint}>
                        <span class={styles.rowHint}>{row.hint}</span>
                      </Show>
                      <Show when={i() === index()}>
                        <CornerDownLeft size={12} class={styles.enter} />
                      </Show>
                    </li>
                  </>
                )}
              </For>
              <Show when={rows().length === 0 && !searching()}>
                <li class={styles.empty}>{t('Nothing found')}</li>
              </Show>
            </ul>
          </div>
        </Show>
      </div>

      <TaskEditor
        task={openTask()}
        open={openTask() !== null}
        onClose={() => setOpenTask(null)}
        onChanged={() => {
          const current = openTask();
          if (current) void tasksApi.get(current.id).then(setOpenTask).catch(() => setOpenTask(null));
        }}
        onOpenTask={(task) => void tasksApi.get(task.id).then(setOpenTask).catch(() => setOpenTask(task))}
      />
    </>
  );
}
