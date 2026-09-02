// MyTasker — root component and providers.
// Built by drogoz · https://github.com/deepdrogo/mytasker

import { Router } from '@solidjs/router';
import type { JSX } from 'solid-js';
import { createResource, Show } from 'solid-js';
import { LogoMark } from '~/components/shared/Logo';
import { ToastHost } from '~/components/ui/Feedback';
import { routes } from '~/app/routes';
import { bootstrapAuth } from '~/stores/auth';
import styles from './App.module.css';

export function App(): JSX.Element {
  const [ready] = createResource(async () => {
    await bootstrapAuth();
    return true;
  });

  return (
    <>
      <Show when={ready()} fallback={<BootScreen />}>
        <Router>{routes}</Router>
      </Show>
      <ToastHost />
    </>
  );
}

function BootScreen(): JSX.Element {
  return (
    <div class={styles.boot} role="status" aria-label="Loading MyTasker">
      <LogoMark size={44} class={styles.bootMark} />
    </div>
  );
}
