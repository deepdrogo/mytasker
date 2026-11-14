// MyTasker — one-click "put this task into a project": a small searchable popover next to the row.
// Built by drogoz · https://github.com/deepdrogo/mytasker

import { Briefcase, Check, FolderPlus, Search, User } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { projectsApi } from '~/features/projects/api';
import { tasksApi, type MoveDestination } from '~/features/tasks/api';
import { createQuery } from '~/hooks/createQuery';
import { t } from '~/i18n';
import { tx } from '~/stores/translations';
import { toast } from '~/stores/ui';
import type { Project, Task } from '~/types';
import { cx } from '~/utils/cx';
import styles from './QuickProjectPicker.module.css';

const POPOVER_WIDTH = 260;

export function QuickProjectPicker(props: { task: Task; onChanged?: () => void; size?: 'sm' }): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const [pos, setPos] = createSignal({ top: 0, left: 0 });
  const [filter, setFilter] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  let panel: HTMLDivElement | undefined;
  let input: HTMLInputElement | undefined;

  // Same key as ProjectSelector, so every row shares one cached list.
  const query = createQuery(
    () => (open() ? 'projects:selector:open' : null),
    () => projectsApi.list({ view: 'open', page_size: 200, ordering: 'name' }),
    { staleMs: 30_000 },
  );
  const projects = createMemo<Project[]>(() => {
    const needle = filter().trim().toLowerCase();
    const list = query.data()?.results ?? [];
    if (!needle) return list;
    return list.filter((project) => tx('project', project.id, 'name', project.name).toLowerCase().includes(needle));
  });

  const toggle = (event: MouseEvent) => {
    event.stopPropagation();
    if (open()) return setOpen(false);
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.right - POPOVER_WIDTH, window.innerWidth - POPOVER_WIDTH - 8));
    const below = rect.bottom + 4;
    // Flip above the button when the list would run off the bottom of the screen.
    const top = below + 320 > window.innerHeight ? Math.max(8, rect.top - 324) : below;
    setPos({ top, left });
    setFilter('');
    setOpen(true);
  };

  createEffect(() => {
    if (!open()) return;
    queueMicrotask(() => input?.focus());
    const close = (event: MouseEvent) => {
      if (panel && !panel.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onScroll = (event: Event) => {
      if (panel && panel.contains(event.target as Node)) return;
      setOpen(false);
    };
    window.setTimeout(() => document.addEventListener('click', close), 0);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', () => setOpen(false), { once: true });
    window.addEventListener('scroll', onScroll, true);
    onCleanup(() => {
      document.removeEventListener('click', close);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    });
  });

  const moveTo = async (destination: MoveDestination, label: string) => {
    if (busy()) return;
    setBusy(true);
    try {
      await tasksApi.move(props.task.id, destination);
      setOpen(false);
      toast(t('Moved to {name}', { name: label }));
      props.onChanged?.();
    } catch {
      toast(t('Could not move the task.'));
    } finally {
      setBusy(false);
    }
  };

  const current = () => props.task.project?.id ?? null;

  return (
    <>
      <button
        type="button"
        class={cx(styles.trigger, props.size === 'sm' && styles.sm, props.task.project && styles.triggerSet)}
        onClick={toggle}
        aria-label={props.task.project ? t('Change project') : t('Put into a project')}
        title={props.task.project ? t('Change project') : t('Put into a project')}
        aria-expanded={open()}
      >
        <FolderPlus size={props.size === 'sm' ? 11 : 13} />
      </button>
      <Show when={open()}>
        <Portal>
          <div
            ref={panel}
            class={styles.panel}
            style={{ top: `${pos().top}px`, left: `${pos().left}px`, width: `${POPOVER_WIDTH}px` }}
            role="dialog"
            aria-label={t('Put into a project')}
            onClick={(event) => event.stopPropagation()}
          >
            <label class={styles.search}>
              <Search size={13} />
              <input
                ref={input}
                value={filter()}
                placeholder={t('Find a project…')}
                aria-label={t('Find a project…')}
                onInput={(event) => setFilter(event.currentTarget.value)}
                onKeyDown={(event) => {
                  const first = projects()[0];
                  if (event.key === 'Enter' && first) void moveTo({ project_id: first.id }, tx('project', first.id, 'name', first.name));
                }}
              />
            </label>
            <div class={styles.list}>
              <Show when={query.data()} fallback={<p class={styles.note}>{t('Loading…')}</p>}>
                <Show when={projects().length > 0} fallback={<p class={styles.note}>{t('No matching project.')}</p>}>
                  <For each={projects()}>
                    {(project) => {
                      const name = () => tx('project', project.id, 'name', project.name);
                      return (
                        <button
                          type="button"
                          class={cx(styles.item, current() === project.id && styles.itemOn)}
                          disabled={busy() || current() === project.id}
                          onClick={() => void moveTo({ project_id: project.id }, name())}
                        >
                          <span class={styles.itemName}>{name()}</span>
                          <Show when={current() === project.id}>
                            <Check size={12} />
                          </Show>
                        </button>
                      );
                    }}
                  </For>
                </Show>
              </Show>
            </div>
            <Show when={props.task.project}>
              <div class={styles.foot}>
                <button type="button" class={styles.item} disabled={busy()} onClick={() => void moveTo({ kind: 'business' }, t('Business'))}>
                  <Briefcase size={12} />
                  <span class={styles.itemName}>{t('Out of the project → Business')}</span>
                </button>
                <button type="button" class={styles.item} disabled={busy()} onClick={() => void moveTo({ kind: 'personal' }, t('Personal'))}>
                  <User size={12} />
                  <span class={styles.itemName}>{t('Out of the project → Personal')}</span>
                </button>
              </div>
            </Show>
          </div>
        </Portal>
      </Show>
    </>
  );
}
