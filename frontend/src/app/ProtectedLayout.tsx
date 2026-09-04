import { Navigate, useLocation, type RouteSectionProps } from '@solidjs/router';
import type { JSX } from 'solid-js';
import { onCleanup, onMount, Show } from 'solid-js';
import { AppShell } from '~/layouts/AppShell';
import { assistantMayOpen, authStore } from '~/stores/auth';
import { loadNotifications, resetNotifications } from '~/stores/notifications';
import { connectRealtime, disconnectRealtime } from '~/stores/realtime';
import { loadTimerState } from '~/stores/timer';
import { resetTranslations } from '~/stores/translations';
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
      resetTranslations();
    });
  });

  return (
    <Show
      when={authStore.isAuthenticated()}
      fallback={<Navigate href={`/auth/login?next=${encodeURIComponent(location.pathname + location.search)}`} />}
    >
      <Show when={!authStore.isAssistant() || assistantMayOpen(location.pathname)} fallback={<Navigate href="/tasks/personal" />}>
        <AppShell>{props.children}</AppShell>
      </Show>
    </Show>
  );
}
