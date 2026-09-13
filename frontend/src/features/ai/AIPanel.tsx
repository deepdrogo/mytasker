import { useNavigate } from '@solidjs/router';
import { Maximize2, Sparkles, X } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { Show, createEffect, createSignal } from 'solid-js';
import { Button } from '~/components/ui/Button';
import { Drawer } from '~/components/ui/Drawer';
import { AIChat } from '~/features/ai/AIChat';
import { t } from '~/i18n';
import { authStore } from '~/stores/auth';
import { uiStore, useIsMobile } from '~/stores/ui';
import styles from './AIPanel.module.css';

/** Slide-over AI Command Center (shortcut: A). The full-page version lives at /ai. */
export function AIPanel(): JSX.Element {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [prefill, setPrefill] = createSignal('');

  createEffect(() => {
    if (uiStore.aiOpen()) setPrefill(uiStore.consumeAIPrefill());
  });

  // Admin-only surface: the drawer itself opens for admins; the chat needs the provider configured.
  const configured = () => authStore.aiEnabled();
  const maximize = () => {
    uiStore.closeAI();
    navigate('/ai');
  };

  return (
    <Show when={uiStore.aiOpen()}>
      <Show
        when={isMobile()}
        fallback={
          <aside class={styles.dock} aria-label={t('AI assistant')}>
            <header class={styles.dockHeader}>
              <div class={styles.dockTitle}><Sparkles size={15} /><span>{t('AI')}</span></div>
              <div class={styles.dockActions}>
                <Button variant="ghost" size="icon-sm" title={t('Open full page')} onClick={maximize}><Maximize2 size={14} /></Button>
                <Button variant="ghost" size="icon-sm" title={t('Close')} onClick={uiStore.closeAI}><X size={15} /></Button>
              </div>
            </header>
            <PanelContent configured={configured()} prefill={prefill()} />
          </aside>
        }
      >
        <Drawer open onClose={uiStore.closeAI} title={t('AI')} width="440px">
          <PanelContent configured={configured()} prefill={prefill()} onMaximize={maximize} />
        </Drawer>
      </Show>
    </Show>
  );
}

function PanelContent(props: { configured: boolean; prefill: string; onMaximize?: () => void }): JSX.Element {
  return (
    <div class={styles.panel}>
      <Show
        when={props.configured}
        fallback={
          <p class={styles.unavailable}>
            {authStore.isAdmin()
              ? t('AI is not configured on this server. Add an Anthropic API key in the backend environment to enable it.')
              : t('The AI assistant is available to administrators only.')}
          </p>
        }
      >
        <div class={styles.head}>
          <span class={styles.hint}>{t('Your conversation stays here while you work.')}</span>
          <Show when={props.onMaximize}>
            {(action) => <Button variant="ghost" size="sm" title={t('Open full page')} onClick={action()}><Maximize2 size={14} /></Button>}
          </Show>
        </div>
        <div class={styles.body}>
          <AIChat prefill={props.prefill} compact autofocus />
        </div>
      </Show>
    </div>
  );
}
