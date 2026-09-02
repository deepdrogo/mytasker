import { Activity } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { createSignal, For, Show } from 'solid-js';
import { SourceLabel } from '~/components/shared/Indicators';
import { Button } from '~/components/ui/Button';
import { EmptyState, ErrorNote, Skeleton } from '~/components/ui/Feedback';
import { collabApi, describeActivity } from '~/features/collab/api';
import { createQuery } from '~/hooks/createQuery';
import type { ActivityItem, ID } from '~/types';
import { formatRelative } from '~/utils/format';
import styles from './ActivityFeed.module.css';

interface ActivityFeedProps {
  project?: ID;
  task?: ID;
  compact?: boolean;
  limit?: number;
}

const ACTOR_GLYPH: Record<ActivityItem['actor_kind'], string> = {
  user: '',
  guest: 'guest',
  ai: 'AI',
  telegram: 'TG',
  system: 'sys',
};

export function ActivityFeed(props: ActivityFeedProps): JSX.Element {
  const [extra, setExtra] = createSignal<ActivityItem[]>([]);
  const [nextCursor, setNextCursor] = createSignal<string | null>(null);
  const [loadingMore, setLoadingMore] = createSignal(false);

  const params = () => ({
    project: props.project,
    task: props.task,
    page_size: props.limit ?? (props.compact ? 10 : 50),
  });

  const query = createQuery(
    () => `activity:${props.project ?? 'all'}:${props.task ?? ''}:${params().page_size}`,
    async () => {
      const page = await collabApi.activity(params());
      setExtra([]);
      setNextCursor(page.next ? new URL(page.next, window.location.origin).searchParams.get('cursor') : null);
      return page;
    },
  );

  const loadMore = async () => {
    const cursor = nextCursor();
    if (!cursor || loadingMore()) return;
    setLoadingMore(true);
    try {
      const page = await collabApi.activity({ ...params(), cursor });
      setExtra((list) => [...list, ...page.results]);
      setNextCursor(page.next ? new URL(page.next, window.location.origin).searchParams.get('cursor') : null);
    } finally {
      setLoadingMore(false);
    }
  };

  const items = () => [...(query.data()?.results ?? []), ...extra()];

  return (
    <Show when={!query.error()} fallback={<ErrorNote message="Could not load activity." onRetry={query.refetch} />}>
      <Show when={query.data()} fallback={<Skeleton rows={5} height={30} />}>
        <Show
          when={items().length > 0}
          fallback={<EmptyState compact icon={<Activity size={18} />} title="No activity yet" />}
        >
          <ol class={[styles.list, props.compact ? styles.compact : ''].join(' ')}>
            <For each={items()}>
              {(item) => (
                <li class={styles.item}>
                  <span class={styles.dot} aria-hidden="true" />
                  <div class={styles.body}>
                    <p class={styles.line}>
                      <span class={styles.actor}>{item.actor_display || 'Someone'}</span>
                      <Show when={ACTOR_GLYPH[item.actor_kind]}>
                        <span class={styles.kind}>{ACTOR_GLYPH[item.actor_kind]}</span>
                      </Show>{' '}
                      {describeActivity(item)}
                    </p>
                    <p class={styles.meta}>
                      <time dateTime={item.created_at}>{formatRelative(item.created_at)}</time>
                      <Show when={!props.project && item.project}>
                        <span>· {item.project?.name}</span>
                      </Show>
                      <Show when={item.source !== 'web'}>
                        <span>
                          · <SourceLabel source={item.source} />
                        </span>
                      </Show>
                    </p>
                  </div>
                </li>
              )}
            </For>
          </ol>
          <Show when={nextCursor() && !props.compact}>
            <div class={styles.more}>
              <Button variant="ghost" size="sm" onClick={() => void loadMore()} loading={loadingMore()}>
                Load more
              </Button>
            </div>
          </Show>
        </Show>
      </Show>
    </Show>
  );
}
