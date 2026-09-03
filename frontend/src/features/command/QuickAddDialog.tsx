import { useLocation } from '@solidjs/router';
import { Sparkles } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { createEffect, createMemo, createSignal, For, Show } from 'solid-js';
import { ApiError } from '~/api/client';
import { Badge, PriorityMark } from '~/components/shared/Indicators';
import { Button } from '~/components/ui/Button';
import { Modal } from '~/components/ui/Modal';
import { Select } from '~/components/ui/Input';
import { quickParse } from '~/features/command/quickParse';
import { projectsApi } from '~/features/projects/api';
import { tasksApi } from '~/features/tasks/api';
import { createQuery } from '~/hooks/createQuery';
import { t } from '~/i18n';
import { authStore } from '~/stores/auth';
import { tx } from '~/stores/translations';
import { toast, uiStore } from '~/stores/ui';
import type { TaskKind } from '~/types';
import { formatDueDate } from '~/utils/format';
import styles from './QuickAddDialog.module.css';

/**
 * Global quick add (N). One line in, parsed preview below, Enter saves. Shift+Enter keeps it open.
 */
export function QuickAddDialog(): JSX.Element {
  const location = useLocation();
  const [text, setText] = createSignal('');
  const [kind, setKind] = createSignal<TaskKind>('personal');
  const [projectId, setProjectId] = createSignal<number | null>(null);
  const [busy, setBusy] = createSignal(false);
  let input: HTMLInputElement | undefined;

  const projects = createQuery(
    () => (uiStore.quickAddOpen() ? 'projects:picker' : null),
    () => projectsApi.list({ view: 'open', page_size: 200 }),
    { staleMs: 60_000 },
  );

  const parsed = createMemo(() => quickParse(text()));

  const projectFromHint = createMemo(() => {
    const hint = parsed().projectHint;
    if (!hint) return null;
    return projects.data()?.results.find((p) => p.name.toLowerCase().replace(/\s+/g, '-').includes(hint)) ?? null;
  });

  createEffect(() => {
    if (!uiStore.quickAddOpen()) return;
    setText('');
    const path = location.pathname;
    const projectMatch = /^\/projects\/(\d+)/.exec(path);
    setProjectId(projectMatch ? Number(projectMatch[1]) : null);
    setKind(path.includes('/business') || projectMatch ? 'business' : authStore.user()?.preferences.default_task_type ?? 'personal');
    queueMicrotask(() => input?.focus());
  });

  const submit = async (keepOpen: boolean) => {
    const p = parsed();
    if (!p.title || busy()) return;
    setBusy(true);
    try {
      const project = projectFromHint()?.id ?? projectId();
      await tasksApi.create({
        title: p.title,
        kind: p.kind ?? kind(),
        priority: p.priority ?? 'normal',
        due_at: p.due_at ?? null,
        due_has_time: p.due_has_time ?? false,
        project_id: project,
        tags: p.tags,
      });
      toast(t('Added “{title}”', { title: p.title }));
      if (keepOpen) {
        setText('');
        input?.focus();
      } else {
        uiStore.closeQuickAdd();
      }
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('Could not create the task.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={uiStore.quickAddOpen()} onClose={uiStore.closeQuickAdd} size="md" closeOnBackdrop>
      <div class={styles.wrap}>
        <input
          ref={input}
          class={styles.input}
          placeholder={t('What needs to happen?')}
          value={text()}
          onInput={(e) => setText(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void submit(e.shiftKey);
            }
          }}
          aria-label={t('Task')}
          autocomplete="off"
        />

        <div class={styles.controls}>
          <Select sizeVariant="sm" value={parsed().kind ?? kind()} onChange={(e) => setKind(e.currentTarget.value as TaskKind)} aria-label={t('Type')}>
            <option value="personal">{t('Personal')}</option>
            <option value="business">{t('Business')}</option>
          </Select>
          <Select
            sizeVariant="sm"
            value={projectFromHint()?.id ?? projectId() ?? ''}
            onChange={(e) => setProjectId(e.currentTarget.value ? Number(e.currentTarget.value) : null)}
            aria-label={t('Project')}
          >
            <option value="">{t('No project')}</option>
            <For each={projects.data()?.results ?? []}>{(p) => <option value={p.id}>{tx('project', p.id, 'name', p.name)}</option>}</For>
          </Select>
          <span class={styles.spacer} />
          <Show when={authStore.aiEnabled()}>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const message = text().trim();
                uiStore.closeQuickAdd();
                uiStore.openAI(message);
              }}
              title={t('Let the AI plan this')}
            >
              <Sparkles size={13} />
              {t('AI')}
            </Button>
          </Show>
          <Button size="sm" onClick={() => void submit(false)} loading={busy()} disabled={!parsed().title}>
            {t('Add')}
          </Button>
        </div>

        <div class={styles.preview} aria-live="polite">
          <Show when={parsed().priority}>
            <Badge variant="outline">
              <PriorityMark priority={parsed().priority!} withLabel />
            </Badge>
          </Show>
          <Show when={parsed().due_at}>
            <Badge variant="outline">{formatDueDate(parsed().due_at, parsed().due_has_time)}</Badge>
          </Show>
          <Show when={projectFromHint()}>
            <Badge variant="outline">#{tx('project', projectFromHint()?.id, 'name', projectFromHint()?.name ?? '')}</Badge>
          </Show>
          <For each={parsed().tags}>{(tag) => <Badge variant="dashed">~{tag}</Badge>}</For>
          <span class={styles.hint}>
            <kbd>tomorrow 15:00</kbd> <kbd>!!</kbd> <kbd>#project</kbd> <kbd>@business</kbd> <kbd>~tag</kbd> · {t('Shift+Enter adds another')}
          </span>
        </div>
      </div>
    </Modal>
  );
}
