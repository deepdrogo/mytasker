import { createSignal } from 'solid-js';
import { api } from '~/api/client';
import type { Paginated } from '~/api/client';
import type { AppNotification, ID } from '~/types';

const [items, setItems] = createSignal<AppNotification[]>([]);
const [unread, setUnread] = createSignal(0);
const [loading, setLoading] = createSignal(false);
const [hasMore, setHasMore] = createSignal(false);

export const notificationStore = { items, unread, loading, hasMore };

type Page = Paginated<AppNotification> & { unread?: number };

export async function loadNotifications(): Promise<void> {
  setLoading(true);
  try {
    const page = await api.get<Page>('/notifications/', { params: { page_size: 40 } });
    setItems(page.results);
    setHasMore(Boolean(page.next));
    if (typeof page.unread === 'number') setUnread(page.unread);
  } catch {
    /* silent: notifications are non-critical */
  } finally {
    setLoading(false);
  }
}

export async function loadMoreNotifications(): Promise<void> {
  const last = items().at(-1);
  if (!last || loading()) return;
  setLoading(true);
  try {
    const page = await api.get<Page>('/notifications/', { params: { page: Math.floor(items().length / 40) + 1, page_size: 40 } });
    setItems((list) => {
      const seen = new Set(list.map((n) => n.id));
      return [...list, ...page.results.filter((n) => !seen.has(n.id))];
    });
    setHasMore(Boolean(page.next));
  } catch {
    setHasMore(false);
  } finally {
    setLoading(false);
  }
}

export function pushNotification(notification: AppNotification, unreadCount?: number): void {
  setItems((list) => [notification, ...list.filter((n) => n.id !== notification.id)].slice(0, 200));
  if (typeof unreadCount === 'number') setUnread(unreadCount);
  else if (!notification.read_at) setUnread((n) => n + 1);
}

export async function markRead(id: ID): Promise<void> {
  const target = items().find((n) => n.id === id);
  if (!target || target.read_at) return;
  setItems((list) => list.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)));
  setUnread((n) => Math.max(0, n - 1));
  await api.post('/notifications/read/', { ids: [id] }).catch(() => undefined);
}

export async function markAllRead(): Promise<void> {
  const now = new Date().toISOString();
  setItems((list) => list.map((n) => (n.read_at ? n : { ...n, read_at: now })));
  setUnread(0);
  await api.post('/notifications/read/', {}).catch(() => undefined);
}

export async function clearRead(): Promise<void> {
  setItems((list) => list.filter((n) => !n.read_at));
  await api.delete('/notifications/clear/').catch(() => undefined);
}

export function resetNotifications(): void {
  setItems([]);
  setUnread(0);
  setHasMore(false);
}
