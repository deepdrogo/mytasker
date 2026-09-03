import { useNavigate } from '@solidjs/router';
import { Bell, CheckCheck, Trash2 } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { For, Show, createEffect, createSignal } from 'solid-js';
import { Button } from '~/components/ui/Button';
import { Drawer } from '~/components/ui/Drawer';
import { EmptyState, Skeleton } from '~/components/ui/Feedback';
import { t } from '~/i18n';
import {
  clearRead,
  loadMoreNotifications,
  loadNotifications,
  markAllRead,
  markRead,
  notificationStore,
} from '~/stores/notifications';
import { uiStore } from '~/stores/ui';
import type { AppNotification } from '~/types';
import { formatRelative } from '~/utils/format';
import styles from './NotificationCenter.module.css';
import { cx } from '~/utils/cx';

type Filter = 'all' | 'unread';

/** English labels (i18n keys) - wrapped with `t()` at render time. */
const CATEGORY_LABEL: Record<string, string> = {
  reminder: 'Reminder',
  deadline: 'Deadline',
  team: 'Team',
  comment: 'Comment',
  guest: 'Guest',
  assignment: 'Assigned',
  ai: 'AI',
  summary: 'Review',
  system: 'System',
};

function categoryLabel(category: string): string {
  const label = CATEGORY_LABEL[category];
  return label ? t(label) : category;
}

export function NotificationCenter(): JSX.Element {
  const navigate = useNavigate();
  const [filter, setFilter] = createSignal<Filter>('all');

  createEffect(() => {
    if (uiStore.notificationsOpen()) void loadNotifications();
  });

  const visible = () => {
    const list = notificationStore.items();
    return filter() === 'unread' ? list.filter((n) => !n.read_at) : list;
  };

  const open = (n: AppNotification) => {
    void markRead(n.id);
    if (n.url) {
      uiStore.closeNotifications();
      navigate(n.url);
    }
  };

  return (
    <Drawer open={uiStore.notificationsOpen()} onClose={uiStore.closeNotifications} title={t('Notifications')} width="400px">
      <div class={styles.toolbar}>
        <div class={styles.filters} role="tablist">
          <button
            type="button"
            role="tab"
            class={cx(styles.filter, filter() === 'all' && styles.filterActive)}
            aria-selected={filter() === 'all'}
            onClick={() => setFilter('all')}
          >
            {t('All')}
          </button>
          <button
            type="button"
            role="tab"
            class={cx(styles.filter, filter() === 'unread' && styles.filterActive)}
            aria-selected={filter() === 'unread'}
            onClick={() => setFilter('unread')}
          >
            {t('Unread')}
            <Show when={notificationStore.unread() > 0}>
              <span class={styles.count}>{notificationStore.unread()}</span>
            </Show>
          </button>
        </div>
        <div class={styles.actions}>
          <Button variant="ghost" size="sm" onClick={() => void markAllRead()} disabled={notificationStore.unread() === 0} title={t('Mark all read')}>
            <CheckCheck size={14} />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void clearRead()} title={t('Clear read')}>
            <Trash2 size={14} />
          </Button>
        </div>
      </div>

      <Show when={!(notificationStore.loading() && notificationStore.items().length === 0)} fallback={<Skeleton rows={5} height={52} />}>
        <Show
          when={visible().length > 0}
          fallback={
            <EmptyState
              icon={<Bell size={20} />}
              title={filter() === 'unread' ? t('All caught up') : t('No notifications yet')}
              hint={t('Team activity, guest completions, reminders and reviews land here.')}
              compact
            />
          }
        >
          <ul class={styles.list}>
            <For each={visible()}>
              {(n) => (
                <li>
                  <button type="button" class={cx(styles.item, !n.read_at && styles.unread)} onClick={() => open(n)}>
                    <span class={styles.marker} aria-hidden="true" />
                    <span class={styles.body}>
                      <span class={styles.title}>{n.title}</span>
                      <Show when={n.body}>
                        <span class={styles.text}>{n.body}</span>
                      </Show>
                      <span class={styles.meta}>
                        <span class={styles.category}>{categoryLabel(n.category)}</span>
                        <span>{formatRelative(n.created_at)}</span>
                      </span>
                    </span>
                  </button>
                </li>
              )}
            </For>
          </ul>
          <Show when={notificationStore.hasMore()}>
            <div class={styles.more}>
              <Button variant="ghost" size="sm" loading={notificationStore.loading()} onClick={() => void loadMoreNotifications()}>
                {t('Load more')}
              </Button>
            </div>
          </Show>
        </Show>
      </Show>
    </Drawer>
  );
}
