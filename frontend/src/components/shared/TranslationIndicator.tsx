// MyTasker — quiet bottom-corner status while Claude translates content in the background.
// Built by drogoz · https://github.com/deepdrogo/mytasker

import { Languages } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { Show, createEffect, createSignal, onCleanup } from 'solid-js';
import { Portal } from 'solid-js/web';
import { t } from '~/i18n';
import { translationStore } from '~/stores/translations';
import styles from './TranslationIndicator.module.css';

export function TranslationIndicator(): JSX.Element {
  const count = () => translationStore.pendingCount();
  // Linger for a moment after the last job so the "done" state is visible instead of vanishing.
  const [phase, setPhase] = createSignal<'hidden' | 'working' | 'done'>('hidden');
  let hideTimer: number | undefined;

  createEffect(() => {
    if (count() > 0) {
      if (hideTimer !== undefined) {
        window.clearTimeout(hideTimer);
        hideTimer = undefined;
      }
      setPhase('working');
    } else if (phase() === 'working') {
      setPhase('done');
      hideTimer = window.setTimeout(() => setPhase('hidden'), 1600);
    }
  });
  onCleanup(() => hideTimer !== undefined && window.clearTimeout(hideTimer));

  return (
    <Portal>
      <Show when={phase() !== 'hidden'}>
        <div class={[styles.pill, phase() === 'done' ? styles.done : ''].filter(Boolean).join(' ')} role="status" aria-live="polite">
          <span class={styles.icon} aria-hidden="true">
            <Languages size={12} />
          </span>
          <Show when={phase() === 'working'} fallback={<span>{t('Translated')}</span>}>
            <span>{t('Translating…')}</span>
            <Show when={count() > 1}>
              <span class={styles.count}>{count()}</span>
            </Show>
          </Show>
        </div>
      </Show>
    </Portal>
  );
}
