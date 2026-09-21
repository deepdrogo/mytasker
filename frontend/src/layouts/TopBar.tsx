import { Bell, Menu, PanelLeftClose, Plus, Search, Sparkles } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import { LanguageSwitch } from '~/components/shared/LanguageSwitch';
import { Button } from '~/components/ui/Button';
import { GlobalSearch } from '~/features/search/GlobalSearch';
import { TimerIndicator } from '~/features/timer/TimerIndicator';
import { t } from '~/i18n';
import { authStore } from '~/stores/auth';
import { notificationStore } from '~/stores/notifications';
import { uiStore, useIsMobile } from '~/stores/ui';
import styles from './TopBar.module.css';

export function TopBar(): JSX.Element {
  const isMobile = useIsMobile();
  // Desktop with a pinned sidebar: the dock is always visible, so the menu button collapses it (unpins) instead.
  const docked = () => !isMobile() && uiStore.sidebarPinned();
  const navOpen = () => docked() || uiStore.sidebarOpen();

  return (
    <header class={styles.topbar}>
      <button
        class={styles.iconBtn}
        onClick={() => (docked() ? uiStore.unpinSidebar() : uiStore.toggleSidebar())}
        aria-label={docked() ? t('Collapse sidebar') : navOpen() ? t('Close navigation') : t('Open navigation')}
        aria-expanded={navOpen()}
        title={docked() ? t('Collapse sidebar') : undefined}
      >
        <Show when={docked()} fallback={<Menu size={17} />}>
          <PanelLeftClose size={17} />
        </Show>
      </button>

      {/* Desktop: a real search box that answers as you type. Phones: the palette, which searches the same way. */}
      <Show when={!isMobile()} fallback={
        <button class={styles.search} onClick={uiStore.openPalette} aria-label={t('Search')}>
          <Search size={14} />
          <span class={styles.searchText}>{t('Search everything…')}</span>
        </button>
      }>
        <GlobalSearch />
      </Show>

      <div class={styles.right}>
        <TimerIndicator />

        <Show when={!isMobile()}>
          <LanguageSwitch compact />
        </Show>

        <Show when={!isMobile() && authStore.isAdmin()}>
          <Button variant="ghost" size="icon" aria-label={t('Ask AI')} onClick={() => uiStore.openAI()}>
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
