import { Navigate, useSearchParams, type RouteSectionProps } from '@solidjs/router';
import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import { Logo } from '~/components/shared/Logo';
import { authStore } from '~/stores/auth';
import styles from './AuthLayout.module.css';

export function AuthLayout(props: RouteSectionProps): JSX.Element {
  const [params] = useSearchParams();
  // Honour ?next= here as well: this redirect fires the instant the session appears, before Login's own navigate.
  const target = () => {
    const next = typeof params.next === 'string' ? params.next : '';
    return next.startsWith('/') && !next.startsWith('//') ? next : '/today';
  };
  return (
    <Show when={!authStore.isAuthenticated()} fallback={<Navigate href={target()} />}>
      <div class={styles.wrap}>
        <div class={styles.panel}>
          <div class={styles.brand}>
            <Logo size={34} />
          </div>
          {props.children}
        </div>
        <p class={styles.tagline}>A control center for life, business, projects and time.</p>
      </div>
    </Show>
  );
}
