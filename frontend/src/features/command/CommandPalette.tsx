// MyTasker — ⌘K command palette.
// Built by drogoz · https://github.com/deepdrogo/mytasker

import { useNavigate } from '@solidjs/router';
import {
  ArrowRight,
  Calendar,
  CheckSquare,
  CornerDownLeft,
  FileText,
  FolderKanban,
  LayoutDashboard,
  Lightbulb,
  ListChecks,
  Plus,
  Rocket,
  Search,
  Sparkles,
} from 'lucide-solid';
import type { JSX } from 'solid-js';
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { api } from '~/api/client';
import { PriorityMark } from '~/components/shared/Indicators';
import { TaskEditor } from '~/features/tasks/TaskEditor';
import { tasksApi } from '~/features/tasks/api';
import { t } from '~/i18n';
import { taskKindLabel } from '~/utils/taskKind';
import { authStore } from '~/stores/auth';
import { tx } from '~/stores/translations';
import { toast, uiStore } from '~/stores/ui';
import type { SearchResults, Task } from '~/types';
import styles from './CommandPalette.module.css';

interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: JSX.Element;
  keywords?: string;
  run: () => void;
}

interface ResultRow {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: JSX.Element;
  run: () => void;
}

const EMPTY: SearchResults = { tasks: [], projects: [], prompts: [], ideas: [], routine_items: [] };

/**
 * ⌘K palette: navigation + commands + global search. Prefix with ">" to talk to the AI.
 */
export function CommandPalette(): JSX.Element {
  const navigate = useNavigate();
  const [query, setQuery] = createSignal('');
  const [results, setResults] = createSignal<SearchResults>(EMPTY);
  const [searching, setSearching] = createSignal(false);
  const [index, setIndex] = createSignal(0);
  const [openTask, setOpenTask] = createSignal<Task | null>(null);
  let input: HTMLInputElement | undefined;
  let list: HTMLUListElement | undefined;
  let debounce: number | undefined;
  let abort: AbortController | undefined;

  const go = (href: string) => () => {
    uiStore.closePalette();
    navigate(href);
  };

  const commands: Command[] = [
    { id: 'quick-add', label: 'New task', hint: 'N', icon: <Plus size={15} />, keywords: 'add create todo', run: () => { uiStore.closePalette(); uiStore.openQuickAdd(); } },
    ...(authStore.isAdmin()
      ? [{ id: 'ai', label: 'Ask AI', hint: 'A', icon: <Sparkles size={15} />, keywords: 'assistant claude command', run: () => { uiStore.closePalette(); uiStore.openAI(); } }]
      : []),
    { id: 'dashboard', label: 'Go to Dashboard', icon: <LayoutDashboard size={15} />, keywords: 'home overview დეშბორდი', run: go('/dashboard') },
    { id: 'today', label: 'Go to Today', icon: <Calendar size={15} />, keywords: 'due today დღეს', run: go('/today') },
    { id: 'tomorrow', label: 'Go to Tomorrow', icon: <Calendar size={15} />, keywords: 'due tomorrow ხვალ', run: go('/tomorrow') },
    { id: 'personal', label: 'Personal tasks', icon: <CheckSquare size={15} />, run: go('/tasks/personal') },
    { id: 'business', label: 'Business tasks', icon: <CheckSquare size={15} />, run: go('/tasks/business') },
    { id: 'crypto', label: 'Crypto world tasks', icon: <CheckSquare size={15} />, keywords: 'crypto cryptoworld კრიპტო კრიპტოსამყარო', run: go('/tasks/crypto') },
    { id: 'upcoming', label: 'Upcoming', icon: <Calendar size={15} />, run: go('/tasks/upcoming') },
    { id: 'completed', label: 'Completed tasks', icon: <CheckSquare size={15} />, run: go('/tasks/completed') },
    { id: 'projects', label: 'Active projects', icon: <FolderKanban size={15} />, run: go('/projects/active') },
    { id: 'startups', label: 'Startups', icon: <Rocket size={15} />, run: go('/projects/startups') },
    { id: 'all-projects', label: 'All projects', icon: <FolderKanban size={15} />, run: go('/projects/all') },
    { id: 'ideas', label: 'Project ideas', icon: <Lightbulb size={15} />, run: go('/projects/ideas') },
    { id: 'prompts', label: 'Prompt library', icon: <FileText size={15} />, run: go('/prompts') },
    { id: 'new-prompt', label: 'New prompt', icon: <Plus size={15} />, run: go('/prompts/new') },
    { id: 'routine', label: 'Personal routine', icon: <ListChecks size={15} />, run: go('/routine/personal') },
    { id: 'routine-b', label: 'Business routine', icon: <ListChecks size={15} />, run: go('/routine/business') },
    { id: 'rules', label: 'Rules', icon: <ListChecks size={15} />, run: go('/routine/rules') },
    { id: 'insights', label: 'Insights', icon: <ArrowRight size={15} />, keywords: 'analytics review daily weekly', run: go('/insights/daily') },
    { id: 'time', label: 'Time tracking', icon: <ArrowRight size={15} />, keywords: 'timer entries', run: go('/insights/time') },
    { id: 'settings', label: 'Settings', icon: <ArrowRight size={15} />, keywords: 'preferences telegram account', run: go('/settings') },
    { id: 'donate', label: 'Support the project', icon: <ArrowRight size={15} />, keywords: 'donate crypto', run: go('/donate') },
  ];

  const isAI = () => authStore.aiEnabled() && query().trim().startsWith('>');

  const filteredCommands = createMemo(() => {
    const q = query().trim().toLowerCase();
    if (isAI()) return [];
    if (!q) return commands.slice(0, 8);
    // Match the English label, its translation and keywords so Georgian users can type in Georgian.
    return commands.filter((c) => `${c.label} ${t(c.label)} ${c.keywords ?? ''}`.toLowerCase().includes(q)).slice(0, 6);
  });

  const rows = createMemo<ResultRow[]>(() => {
    const out: ResultRow[] = [];
    if (isAI()) {
      const message = query().trim().slice(1).trim();
      out.push({
        id: 'ai-send',
        group: t('AI'),
        label: message ? t('Ask AI: “{message}”', { message }) : t('Type a request for the AI…'),
        icon: <Sparkles size={15} />,
        run: () => {
          uiStore.closePalette();
          uiStore.openAI(message);
        },
      });
      return out;
    }
    for (const c of filteredCommands()) out.push({ id: `cmd-${c.id}`, group: t('Commands'), label: t(c.label), hint: c.hint, icon: c.icon, run: c.run });
    const r = results();
    for (const task of r.tasks) {
      out.push({
        id: `task-${task.id}`,
        group: t('Tasks'),
        label: tx('task', task.id, 'title', task.title),
        hint: task.project ? tx('project', task.project.id, 'name', task.project.name) : taskKindLabel(task.kind),
        icon: <PriorityMark priority={task.priority} />,
        run: () => {
          uiStore.closePalette();
          setOpenTask(task);
        },
      });
    }
    for (const project of r.projects) out.push({ id: `project-${project.id}`, group: t('Projects'), label: tx('project', project.id, 'name', project.name), hint: project.progress === null ? undefined : `${project.progress}%`, icon: <FolderKanban size={15} />, run: go(`/projects/${project.id}/tasks`) });
    for (const prompt of r.prompts) out.push({ id: `prompt-${prompt.id}`, group: t('Prompts'), label: tx('prompt', prompt.id, 'title', prompt.title), hint: prompt.category ? tx('prompt', prompt.id, 'category', prompt.category) : undefined, icon: <FileText size={15} />, run: go(`/prompts/${prompt.id}`) });
    for (const idea of r.ideas) out.push({ id: `idea-${idea.id}`, group: t('Ideas'), label: tx('idea', idea.id, 'title', idea.title), icon: <Lightbulb size={15} />, run: go('/projects/ideas') });
    for (const item of r.routine_items) out.push({ id: `routine-${item.id}`, group: t('Routine'), label: tx('routine_item', item.id, 'name', item.name), hint: item.kind === 'business' ? t('Business') : t('Personal'), icon: <ListChecks size={15} />, run: go(`/routine/${item.kind}`) });
    if (query().trim() && !isAI()) {
      out.push({
        id: 'create-task',
        group: t('Create'),
        label: t('Create task “{title}”', { title: query().trim() }),
        icon: <Plus size={15} />,
        run: () => {
          const title = query().trim();
          uiStore.closePalette();
          void tasksApi.create({ title }).then(() => toast(t('Task created'))).catch(() => toast(t('Could not create the task.')));
        },
      });
    }
    return out;
  });

  createEffect(
    on(query, (q) => {
      setIndex(0);
      window.clearTimeout(debounce);
      abort?.abort();
      const term = q.trim();
      if (term.length < 2 || isAI()) {
        setResults(EMPTY);
        setSearching(false);
        return;
      }
      setSearching(true);
      debounce = window.setTimeout(async () => {
        abort = new AbortController();
        try {
          const data = await api.get<SearchResults>('/search/', { params: { q: term, limit: 6 }, signal: abort.signal });
          setResults(data);
        } catch {
          /* aborted or failed - keep previous */
        } finally {
          setSearching(false);
        }
      }, 160);
    }),
  );

  createEffect(() => {
    if (uiStore.paletteOpen()) {
      setQuery('');
      setResults(EMPTY);
      queueMicrotask(() => input?.focus());
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
  });
  onCleanup(() => {
    document.body.style.overflow = '';
  });

  const onKey = (event: KeyboardEvent) => {
    const total = rows().length;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setIndex((i) => (total ? (i + 1) % total : 0));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setIndex((i) => (total ? (i - 1 + total) % total : 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      rows()[index()]?.run();
    } else if (event.key === 'Escape') {
      uiStore.closePalette();
    }
    queueMicrotask(() => list?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }));
  };

  return (
    <>
      <Show when={uiStore.paletteOpen()}>
        <Portal>
          <div class={styles.backdrop} onClick={(e) => e.target === e.currentTarget && uiStore.closePalette()}>
            <div class={styles.panel} role="dialog" aria-modal="true" aria-label={t('Command palette')}>
              <div class={styles.inputRow}>
                <Show when={!isAI()} fallback={<Sparkles size={16} class={styles.inputIcon} />}>
                  <Search size={16} class={styles.inputIcon} />
                </Show>
                <input
                  ref={input}
                  class={styles.input}
                  placeholder={t('Search tasks, projects, prompts… or type > to ask AI')}
                  value={query()}
                  onInput={(e) => setQuery(e.currentTarget.value)}
                  onKeyDown={onKey}
                  role="combobox"
                  aria-expanded="true"
                  aria-controls="palette-results"
                  aria-autocomplete="list"
                  autocomplete="off"
                  spellcheck={false}
                />
                <Show when={searching()}>
                  <span class={styles.searching} aria-live="polite">
                    {t('searching')}
                  </span>
                </Show>
              </div>

              <ul ref={list} id="palette-results" class={styles.results} role="listbox">
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
                        class={[styles.row, i() === index() ? styles.rowActive : ''].join(' ')}
                        onMouseEnter={() => setIndex(i())}
                        onClick={row.run}
                      >
                        <span class={styles.rowIcon}>{row.icon}</span>
                        <span class={styles.rowLabel}>{row.label}</span>
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
                <Show when={rows().length === 0}>
                  <li class={styles.empty}>{t('Nothing found')}</li>
                </Show>
              </ul>

              <div class={styles.footer}>
                <span>
                  <kbd>↑↓</kbd> {t('navigate')}
                </span>
                <span>
                  <kbd>↵</kbd> {t('open item')}
                </span>
                <span>
                  <kbd>&gt;</kbd> {t('ask AI')}
                </span>
                <span>
                  <kbd>esc</kbd> {t('close')}
                </span>
              </div>
            </div>
          </div>
        </Portal>
      </Show>

      <TaskEditor task={openTask()} open={openTask() !== null} onClose={() => setOpenTask(null)} />
    </>
  );
}
