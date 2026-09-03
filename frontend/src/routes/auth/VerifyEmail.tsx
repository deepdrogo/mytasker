import { A, useSearchParams } from '@solidjs/router';
import type { JSX } from 'solid-js';
import { createResource, Match, Switch } from 'solid-js';
import { api, ApiError } from '~/api/client';
import { t } from '~/i18n';
import { refreshMe } from '~/stores/auth';
import styles from './auth.module.css';

export default function VerifyEmail(): JSX.Element {
  const [params] = useSearchParams();
  const token = () => (typeof params.token === 'string' ? params.token : '');

  const [result] = createResource(token, async (value: string) => {
    if (!value) throw new ApiError(400, { code: 'validation_error', message: t('Missing token.'), fields: {} });
    await api.post('/auth/email/verify/', { token: value });
    await refreshMe();
    return true;
  });

  return (
    <div class={styles.form}>
      <h1 class={styles.heading}>{t('Email verification')}</h1>
      <Switch>
        <Match when={result.loading}>
          <p class={styles.note}>{t('Verifying…')}</p>
        </Match>
        <Match when={result.error}>
          <p class={styles.note}>
            {result.error instanceof ApiError ? result.error.message : t('This link is invalid or has expired.')}
          </p>
        </Match>
        <Match when={result()}>
          <p class={styles.success}>{t('Your email is verified.')}</p>
        </Match>
      </Switch>
      <A href="/auth/login" class={styles.link} style={{ 'text-align': 'center' }}>
        {t('Continue to sign in')}
      </A>
    </div>
  );
}
