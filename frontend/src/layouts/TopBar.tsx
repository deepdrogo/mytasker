import { useNavigate } from '@solidjs/router';
import { Bell, Menu, Plus, Search, Sparkles } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import { Button } from '~/components/ui/Button';
import { TimerIndicator } from '~/features/timer/TimerIndicator';
import { authStore } from '~/stores/auth';
import { notificationStore } from '~/stores/notifications';
import { uiStore, useIsMobile } from '~/stores/ui';
import styles from './TopBar.module.css';

export function TopBar(): JSX.Element {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const searchLabel = () => (authStore.aiEnabled() ? 'Search or ask AI' : 'Search');

  return (
    <header class={styles.topbar}>
      <Show when={isMobile()}>
        <button class={styles.iconBtn} onClick={uiStore.openSidebar} aria-label="Open navigation">
          <Menu size={17} />
        </button>
      </Show>

      <button class={styles.search} onClick={uiStore.openPalette} aria-label={searchLabel()}>
        <Search size={14} />
        <span class={styles.searchText}>{searchLabel()}</span>
        <Show when={!isMobile()}>
          <kbd class={styles.kbd}>⌘K</kbd>
        </Show>
      </button>

      <div class={styles.right}>
        <TimerIndicator />

        <Show when={!isMobile() && authStore.isAdmin()}>
          <Button variant="ghost" size="icon" aria-label="Ask AI" onClick={() => navigate('/ai')}>
            <Sparkles size={15} />
          </Button>
        </Show>

        <button
          class={styles.iconBtn}
          onClick={uiStore.toggleNotifications}
          aria-label={`Notifications${notificationStore.unread() > 0 ? ` (${notificationStore.unread()} unread)` : ''}`}
        >
          <Bell size={15} />
          <Show when={notificationStore.unread() > 0}>
            <span class={styles.unreadDot} aria-hidden="true" />
          </Show>
        </button>

        <Button variant="primary" size={isMobile() ? 'icon' : 'sm'} onClick={uiStore.openQuickAdd} aria-label="Quick add">
          <Plus size={15} />
          <Show when={!isMobile()}>
            <span>Add</span>
          </Show>
        </Button>
      </div>
    </header>
  );
}
