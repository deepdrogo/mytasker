import type { JSX } from 'solid-js';
import { Show, Suspense } from 'solid-js';
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

  return (
    <div class={styles.shell}>
      <Show when={!isMobile()}>
        <Sidebar />
      </Show>
      <Show when={isMobile() && uiStore.sidebarOpen()}>
        <div class={styles.mobileSidebar} onClick={(e) => e.target === e.currentTarget && uiStore.closeSidebar()}>
          <div class={styles.mobileSidebarPanel}>
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
