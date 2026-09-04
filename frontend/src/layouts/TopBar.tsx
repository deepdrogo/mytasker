import { useNavigate } from '@solidjs/router';
import { Bell, Menu, Plus, Search, Sparkles } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import { LanguageSwitch } from '~/components/shared/LanguageSwitch';
import { Button } from '~/components/ui/Button';
import { TimerIndicator } from '~/features/timer/TimerIndicator';
import { t } from '~/i18n';
import { authStore } from '~/stores/auth';
import { notificationStore } from '~/stores/notifications';
import { uiStore, useIsMobile } from '~/stores/ui';
import styles from './TopBar.module.css';

export function TopBar(): JSX.Element {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const searchLabel = () => (authStore.aiEnabled() ? t('Search or ask AI') : t('Search'));

  return (
    <header class={styles.topbar}>
      <button
        class={styles.iconBtn}
        onClick={uiStore.toggleSidebar}
        aria-label={uiStore.sidebarOpen() ? t('Close navigation') : t('Open navigation')}
        aria-expanded={uiStore.sidebarOpen()}
      >
        <Menu size={17} />
      </button>

      <button class={styles.search} onClick={uiStore.openPalette} aria-label={searchLabel()}>
        <Search size={14} />
        <span class={styles.searchText}>{searchLabel()}</span>
        <Show when={!isMobile()}>
          <kbd class={styles.kbd}>⌘K</kbd>
        </Show>
      </button>

      <div class={styles.right}>
        <TimerIndicator />

        <Show when={!isMobile()}>
          <LanguageSwitch compact />
        </Show>

        <Show when={!isMobile() && authStore.isAdmin()}>
          <Button variant="ghost" size="icon" aria-label={t('Ask AI')} onClick={() => navigate('/ai')}>
            <Sparkles size={15} />
          </Button>
        </Show>

        <button
          class={styles.iconBtn}
          onClick={uiStore.toggleNotifications}
          aria-label={
            notificationStore.unread() > 0
              ? t('Notifications ({count} unread)', { count: notificationStore.unread() })
              : t('Notifications')
          }
        >
          <Bell size={15} />
          <Show when={notificationStore.unread() > 0}>
            <span class={styles.unreadDot} aria-hidden="true" />
          </Show>
        </button>

        <Button variant="primary" size={isMobile() ? 'icon' : 'sm'} onClick={uiStore.openQuickAdd} aria-label={t('Quick add')}>
          <Plus size={15} />
          <Show when={!isMobile()}>
            <span>{t('Add')}</span>
          </Show>
        </Button>
      </div>
    </header>
  );
}
