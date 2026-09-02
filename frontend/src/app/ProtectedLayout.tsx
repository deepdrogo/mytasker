import { Navigate, useLocation, type RouteSectionProps } from '@solidjs/router';
import type { JSX } from 'solid-js';
import { onCleanup, onMount, Show } from 'solid-js';
import { AppShell } from '~/layouts/AppShell';
import { authStore } from '~/stores/auth';
import { loadNotifications, resetNotifications } from '~/stores/notifications';
import { connectRealtime, disconnectRealtime } from '~/stores/realtime';
import { loadTimerState } from '~/stores/timer';
import { registerGlobalShortcuts } from '~/hooks/useShortcuts';

/**
 * Route guard. Frontend guards are UX only - the backend authorises every request.
 */
export function ProtectedLayout(props: RouteSectionProps): JSX.Element {
  const location = useLocation();

  onMount(() => {
    if (!authStore.isAuthenticated()) return;
    void loadTimerState();
    void loadNotifications();
    connectRealtime();
    const dispose = registerGlobalShortcuts();
    onCleanup(() => {
      dispose();
      disconnectRealtime();
      resetNotifications();
    });
  });

  return (
    <Show
      when={authStore.isAuthenticated()}
      fallback={<Navigate href={`/auth/login?next=${encodeURIComponent(location.pathname + location.search)}`} />}
    >
      <AppShell>{props.children}</AppShell>
    </Show>
  );
}
