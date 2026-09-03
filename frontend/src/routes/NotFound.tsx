import { A } from '@solidjs/router';
import type { JSX } from 'solid-js';
import { t } from '~/i18n';

export default function NotFound(): JSX.Element {
  return (
    <div
      style={{
        'min-height': '100vh',
        display: 'flex',
        'flex-direction': 'column',
        'align-items': 'center',
        'justify-content': 'center',
        gap: 'var(--s-4)',
        color: 'var(--c-text-dim)',
        'font-size': 'var(--fs-md)',
      }}
    >
      <span style={{ 'font-family': 'var(--font-mono)', 'font-size': 'var(--fs-2xl)', color: 'var(--c-text)' }}>404</span>
      <p>{t('This page does not exist.')}</p>
      <A href="/today" style={{ color: 'var(--c-text)' }}>
        {t('Back to Today')}
      </A>
    </div>
  );
}
