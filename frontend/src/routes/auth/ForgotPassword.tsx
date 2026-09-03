import { A } from '@solidjs/router';
import type { JSX } from 'solid-js';
import { createSignal, Show } from 'solid-js';
import { api, ApiError } from '~/api/client';
import { Button } from '~/components/ui/Button';
import { ErrorNote } from '~/components/ui/Feedback';
import { Field, Input, nextId } from '~/components/ui/Input';
import { t } from '~/i18n';
import styles from './auth.module.css';

export default function ForgotPassword(): JSX.Element {
  const [email, setEmail] = createSignal('');
  const [sent, setSent] = createSignal(false);
  const [error, setError] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const emailId = nextId('email');

  const submit = async (event: Event) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api.post('/auth/password/reset/', { email: email().trim() });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('Something went wrong.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Show
      when={!sent()}
      fallback={
        <div class={styles.form}>
          <h1 class={styles.heading}>{t('Check your inbox')}</h1>
          <p class={styles.success}>
            {t('If an account exists for {email}, a reset link is on its way.', { email: email() })}
          </p>
          <A href="/auth/login" class={styles.link} style={{ 'text-align': 'center' }}>
            {t('Back to sign in')}
          </A>
        </div>
      }
    >
      <form class={styles.form} onSubmit={submit} novalidate>
        <h1 class={styles.heading}>{t('Reset password')}</h1>
        <p class={styles.note}>{t("Enter your email and we'll send a reset link.")}</p>

        {error() && <ErrorNote message={error()} />}

        <Field label={t('Email')} id={emailId}>
          <Input
            id={emailId}
            type="email"
            autocomplete="email"
            required
            value={email()}
            onInput={(e) => setEmail(e.currentTarget.value)}
            data-autofocus
          />
        </Field>

        <Button type="submit" variant="primary" size="lg" block loading={busy()}>
          {t('Send reset link')}
        </Button>

        <div class={styles.links}>
          <A href="/auth/login" class={styles.link}>
            {t('Back to sign in')}
          </A>
        </div>
      </form>
    </Show>
  );
}
