import { A } from '@solidjs/router';
import type { JSX } from 'solid-js';
import { createSignal, Show } from 'solid-js';
import { api, ApiError } from '~/api/client';
import { Button } from '~/components/ui/Button';
import { ErrorNote } from '~/components/ui/Feedback';
import { Field, Input, nextId } from '~/components/ui/Input';
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
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Show
      when={!sent()}
      fallback={
        <div class={styles.form}>
          <h1 class={styles.heading}>Check your inbox</h1>
          <p class={styles.success}>If an account exists for {email()}, a reset link is on its way.</p>
          <A href="/auth/login" class={styles.link} style={{ 'text-align': 'center' }}>
            Back to sign in
          </A>
        </div>
      }
    >
      <form class={styles.form} onSubmit={submit} novalidate>
        <h1 class={styles.heading}>Reset password</h1>
        <p class={styles.note}>Enter your email and we'll send a reset link.</p>

        {error() && <ErrorNote message={error()} />}

        <Field label="Email" id={emailId}>
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
          Send reset link
        </Button>

        <div class={styles.links}>
          <A href="/auth/login" class={styles.link}>
            Back to sign in
          </A>
        </div>
      </form>
    </Show>
  );
}
