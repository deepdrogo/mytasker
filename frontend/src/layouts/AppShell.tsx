// MyTasker — app shell: dock + floating canvas.
// Built by drogoz · https://github.com/deepdrogo/mytasker

import type { JSX } from 'solid-js';
import { onCleanup, onMount, Show, Suspense } from 'solid-js';
import { CommandPalette } from '~/features/command/CommandPalette';
import { QuickAddDialog } from '~/features/command/QuickAddDialog';
import { AIPanel } from '~/features/ai/AIPanel';
import { NotificationCenter } from '~/features/notifications/NotificationCenter';
import { MobileNav } from '~/layouts/MobileNav';
import { Sidebar } from '~/layouts/Sidebar';
import { TopBar } from '~/layouts/TopBar';
import { Skeleton } from '~/components/ui/Feedback';
import { authStore } from '~/stores/auth';
import { uiStore, useIsMobile } from '~/stores/ui';
import styles from './AppShell.module.css';

export function AppShell(props: { children?: JSX.Element }): JSX.Element {
  const isMobile = useIsMobile();

  onMount(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && uiStore.sidebarOpen()) uiStore.closeSidebar();
    };
    window.addEventListener('keydown', onKey);
    onCleanup(() => window.removeEventListener('keydown', onKey));
  });

  return (
    <div class={styles.shell}>
      <Show when={uiStore.sidebarOpen()}>
        <div
          class={isMobile() ? styles.navOverlay : `${styles.navOverlay} ${styles.navOverlayDesktop}`}
          onClick={(e) => e.target === e.currentTarget && uiStore.closeSidebar()}
        >
          <div class={isMobile() ? styles.navPanel : `${styles.navPanel} ${styles.navPanelDesktop}`}>
            <Sidebar onNavigate={uiStore.closeSidebar} />
          </div>
        </div>
      </Show>

      <div class={styles.main}>
        <TopBar />
        <main class={styles.content} id="main-content">
          <Suspense fallback={<Skeleton rows={6} height={40} class={styles.loading} />}>{props.children}</Suspense>
        </main>
        <Show when={isMobile()}>
          <MobileNav />
        </Show>
      </div>

      <CommandPalette />
      <QuickAddDialog />
      <AIPanel />
      <Show when={authStore.isAuthenticated()}>
        <NotificationCenter />
      </Show>
    </div>
  );
}
