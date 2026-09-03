// MyTasker — root component and providers.
// Built by drogoz · https://github.com/deepdrogo/mytasker

import { Router } from '@solidjs/router';
import type { JSX } from 'solid-js';
import { createEffect, createResource, on, Show } from 'solid-js';
import { LogoMark } from '~/components/shared/Logo';
import { TranslationIndicator } from '~/components/shared/TranslationIndicator';
import { ToastHost } from '~/components/ui/Feedback';
import { routes } from '~/app/routes';
import { authStore, bootstrapAuth } from '~/stores/auth';
import { syncLocaleWithAccount } from '~/stores/locale';
import styles from './App.module.css';

export function App(): JSX.Element {
  const [ready] = createResource(async () => {
    await bootstrapAuth();
    return true;
  });

  createEffect(
    on(authStore.user, (me) => {
      if (me) syncLocaleWithAccount(me);
    }),
  );

  return (
    <>
      <Show when={ready()} fallback={<BootScreen />}>
        <Router>{routes}</Router>
      </Show>
      <ToastHost />
      <TranslationIndicator />
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
