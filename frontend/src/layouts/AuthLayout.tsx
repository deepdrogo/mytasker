import { A, Navigate, useSearchParams, type RouteSectionProps } from '@solidjs/router';
import { ArrowLeft, Bot, Clock3, ShieldCheck, Sparkles } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { For, Show } from 'solid-js';
import { LanguageSwitch } from '~/components/shared/LanguageSwitch';
import { Logo, LogoMark } from '~/components/shared/Logo';
import { t } from '~/i18n';
import { authStore } from '~/stores/auth';
import styles from './AuthLayout.module.css';

// English source strings; translated with t() at render time.
const POINTS = [
  { icon: Clock3, title: 'One control center', text: 'Tasks, routines, projects and time in a single calm view.' },
  { icon: Bot, title: 'Telegram built in', text: 'Add tasks, get reminders and daily summaries from your phone.' },
  { icon: ShieldCheck, title: 'Private by default', text: 'Your data is yours. Nothing is shared unless you share it.' },
];

export function AuthLayout(props: RouteSectionProps): JSX.Element {
  const [params] = useSearchParams();
  // Honour ?next= here as well: this redirect fires the instant the session appears, before Login's own navigate.
  const target = () => {
    const next = typeof params.next === 'string' ? params.next : '';
    return next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';
  };
  return (
    <Show when={!authStore.isAuthenticated()} fallback={<Navigate href={target()} />}>
      <div class={styles.root}>
        <div class={styles.bg} aria-hidden="true">
          <div class={styles.glowA} />
          <div class={styles.glowB} />
        </div>

        <A href="/" class={styles.back}>
          <ArrowLeft size={15} />
          <span>{t('Back to home')}</span>
        </A>

        <div class={styles.lang}>
          <LanguageSwitch compact />
        </div>

        <div class={styles.grid}>
          <aside class={styles.story}>
            <A href="/" class={styles.storyBrand} aria-label={t('MyTasker home')}>
              <Logo size={30} />
            </A>
            <p class={styles.eyebrow}>
              <Sparkles size={12} />
              {t('Always free · by drogoz')}
            </p>
            <h2 class={styles.storyTitle}>
              {t('Your day,')} <span>{t('in one place.')}</span>
            </h2>
            <ul class={styles.points}>
              <For each={POINTS}>
                {(p) => (
                  <li class={styles.point}>
                    <span class={styles.pointIcon}>
                      <p.icon size={16} />
                    </span>
                    <span>
                      <strong>{t(p.title)}</strong>
                      <em>{t(p.text)}</em>
                    </span>
                  </li>
                )}
              </For>
            </ul>
            <p class={styles.storyFoot}>{t('No premium tier. No credit card. Ever.')}</p>
          </aside>

          <main class={styles.panel}>
            <div class={styles.panelBrand}>
              <LogoMark size={44} />
            </div>
            {props.children}
          </main>
        </div>
      </div>
    </Show>
  );
}
