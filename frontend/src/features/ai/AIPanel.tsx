import { useNavigate } from '@solidjs/router';
import { Maximize2 } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { Show, createEffect, createSignal } from 'solid-js';
import { Button } from '~/components/ui/Button';
import { Drawer } from '~/components/ui/Drawer';
import { AIChat } from '~/features/ai/AIChat';
import { t } from '~/i18n';
import { authStore } from '~/stores/auth';
import { uiStore } from '~/stores/ui';
import styles from './AIPanel.module.css';

/** Slide-over AI Command Center (shortcut: A). The full-page version lives at /ai. */
export function AIPanel(): JSX.Element {
  const navigate = useNavigate();
  const [prefill, setPrefill] = createSignal('');

  createEffect(() => {
    if (uiStore.aiOpen()) setPrefill(uiStore.consumeAIPrefill());
  });

  // Admin-only surface: the drawer itself opens for admins; the chat needs the provider configured.
  const configured = () => authStore.aiEnabled();

  return (
    <Drawer open={uiStore.aiOpen()} onClose={uiStore.closeAI} title={t('AI')} width="440px">
      <div class={styles.panel}>
        <Show
          when={configured()}
          fallback={
            <p class={styles.unavailable}>
              {authStore.isAdmin()
                ? t('AI is not configured on this server. Add an Anthropic API key in the backend environment to enable it.')
                : t('The AI assistant is available to administrators only.')}
            </p>
          }
        >
          <div class={styles.head}>
            <span class={styles.hint}>{t('Natural language → real actions. Destructive steps ask first.')}</span>
            <Button
              variant="ghost"
              size="sm"
              title={t('Open full page')}
              onClick={() => {
                uiStore.closeAI();
                navigate('/ai');
              }}
            >
              <Maximize2 size={14} />
            </Button>
          </div>
          <div class={styles.body}>
            <AIChat prefill={prefill()} compact autofocus />
          </div>
        </Show>
      </div>
    </Drawer>
  );
}
