import { A } from '@solidjs/router';
import { Copy, FileText, MoreHorizontal, Star } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { For, Show } from 'solid-js';
import { Badge, VisibilityMark } from '~/components/shared/Indicators';
import { Button } from '~/components/ui/Button';
import { Dropdown } from '~/components/ui/Dropdown';
import { EmptyState, ErrorNote, Skeleton } from '~/components/ui/Feedback';
import { copyToClipboard, promptsApi } from '~/features/prompts/api';
import { toast } from '~/stores/ui';
import type { PromptListItem } from '~/types';
import { formatRelative } from '~/utils/format';
import styles from './PromptList.module.css';

interface PromptListProps {
  prompts: PromptListItem[] | undefined;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  onChanged?: () => void;
  emptyTitle?: string;
  emptyHint?: string;
  emptyAction?: JSX.Element;
  showProject?: boolean;
}

export function PromptList(props: PromptListProps): JSX.Element {
  const copy = async (prompt: PromptListItem) => {
    try {
      const full = await promptsApi.get(prompt.id);
      const ok = await copyToClipboard(full.body);
      toast(ok ? 'Prompt copied' : 'Copy failed');
    } catch {
      toast('Could not load the prompt.');
    }
  };

  const run = async (fn: () => Promise<unknown>, message?: string) => {
    try {
      await fn();
      if (message) toast(message);
      props.onChanged?.();
    } catch {
      toast('Action failed.');
    }
  };

  return (
    <Show when={!props.error} fallback={<ErrorNote message="Could not load prompts." onRetry={props.onRetry} />}>
      <Show when={props.prompts} fallback={<Show when={props.loading}><Skeleton rows={5} height={64} /></Show>}>
        {(prompts) => (
          <Show
            when={prompts().length > 0}
            fallback={
              <EmptyState
                icon={<FileText size={22} />}
                title={props.emptyTitle ?? 'No prompts'}
                hint={props.emptyHint}
                action={props.emptyAction}
              />
            }
          >
            <ul class={styles.list}>
              <For each={prompts()}>
                {(prompt) => (
                  <li class={[styles.row, prompt.is_archived ? styles.archived : ''].join(' ')}>
                    <A href={`/prompts/${prompt.id}`} class={styles.main}>
                      <div class={styles.titleRow}>
                        <Show when={prompt.is_favorite}>
                          <Star size={13} class={styles.star} fill="currentColor" />
                        </Show>
                        <span class={styles.title}>{prompt.title}</span>
                        <Show when={prompt.project}>
                          <VisibilityMark visibility={prompt.visibility} mode={prompt.project?.mode} />
                        </Show>
                      </div>
                      <p class={styles.snippet}>{prompt.snippet}</p>
                      <div class={styles.meta}>
                        <Show when={prompt.category}>
                          <Badge variant="outline">{prompt.category}</Badge>
                        </Show>
                        <For each={prompt.tags.slice(0, 4)}>{(tag) => <span class={styles.tag}>#{tag}</span>}</For>
                        <Show when={props.showProject !== false && prompt.project}>
                          <span class={styles.project}>{prompt.project?.name}</span>
                        </Show>
                        <span class={styles.spacer} />
                        <span class="mt-mono">{prompt.body_length.toLocaleString()} chars</span>
                        <span>v{prompt.version}</span>
                        <span>{formatRelative(prompt.updated_at)}</span>
                      </div>
                    </A>
                    <div class={styles.actions}>
                      <Button variant="ghost" size="icon-sm" aria-label="Copy prompt" onClick={() => void copy(prompt)}>
                        <Copy size={14} />
                      </Button>
                      <Dropdown
                        label="Prompt actions"
                        items={[
                          {
                            label: prompt.is_favorite ? 'Remove favorite' : 'Favorite',
                            onSelect: () => void run(() => promptsApi.toggleFavorite(prompt.id)),
                          },
                          {
                            label: 'Duplicate',
                            onSelect: () => void run(() => promptsApi.duplicate(prompt.id), 'Duplicated'),
                          },
                          {
                            label: prompt.is_archived ? 'Unarchive' : 'Archive',
                            onSelect: () => void run(() => promptsApi.toggleArchive(prompt.id)),
                          },
                          {
                            label: 'Delete',
                            danger: true,
                            separatorBefore: true,
                            disabled: !prompt.is_owner,
                            onSelect: () => void run(() => promptsApi.remove(prompt.id), 'Deleted'),
                          },
                        ]}
                        trigger={(menu) => (
                          <Button variant="ghost" size="icon-sm" onClick={menu.toggle} aria-label="More">
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
        )}
      </Show>
    </Show>
  );
}
