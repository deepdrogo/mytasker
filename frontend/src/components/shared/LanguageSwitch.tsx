// MyTasker — two-segment UI language toggle (ქარ | EN).
// Built by drogoz · https://github.com/deepdrogo/mytasker

import type { JSX } from 'solid-js';
import { For } from 'solid-js';
import { LOCALES, LOCALE_LABEL, LOCALE_SHORT, locale, t, type Locale } from '~/i18n';
import { changeLocale } from '~/stores/locale';
import styles from './LanguageSwitch.module.css';

export function LanguageSwitch(props: { compact?: boolean; class?: string }): JSX.Element {
  return (
    <div class={[styles.switch, props.compact ? styles.compact : '', props.class ?? ''].filter(Boolean).join(' ')} role="group" aria-label={t('Language')}>
      <For each={LOCALES}>
        {(code: Locale) => (
          <button
            type="button"
            class={[styles.option, locale() === code ? styles.active : ''].filter(Boolean).join(' ')}
            aria-pressed={locale() === code}
            title={LOCALE_LABEL[code]}
            onClick={() => void changeLocale(code)}
          >
            {props.compact ? LOCALE_SHORT[code] : LOCALE_LABEL[code]}
          </button>
        )}
      </For>
    </div>
  );
}
