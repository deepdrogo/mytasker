import { A, useNavigate, useSearchParams } from '@solidjs/router';
import type { JSX } from 'solid-js';
import { createSignal } from 'solid-js';
import { ApiError } from '~/api/client';
import { Button } from '~/components/ui/Button';
import { Field, Input, nextId } from '~/components/ui/Input';
import { ErrorNote } from '~/components/ui/Feedback';
import { t } from '~/i18n';
import { login } from '~/stores/auth';
import styles from './auth.module.css';

export default function Login(): JSX.Element {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = createSignal('');
  const [password, setPassword] = createSignal('');
  const [error, setError] = createSignal('');
  const [fieldErrors, setFieldErrors] = createSignal<Record<string, string>>({});
  const [busy, setBusy] = createSignal(false);
  const emailId = nextId('email');
  const passwordId = nextId('password');

  const submit = async (event: Event) => {
    event.preventDefault();
    setError('');
    setFieldErrors({});
    setBusy(true);
    try {
      await login(email().trim(), password());
      const next = typeof params.next === 'string' ? params.next : '/today';
      navigate(next.startsWith('/') ? next : '/today', { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setFieldErrors({
          email: err.fieldError('email') ?? '',
          password: err.fieldError('password') ?? '',
        });
      } else {
        setError(t('Something went wrong. Try again.'));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form class={styles.form} onSubmit={submit} novalidate>
      <div class={styles.head}>
        <h1 class={styles.heading}>{t('Welcome back')}</h1>
        <p class={styles.sub}>{t('Sign in to pick up where you left off.')}</p>
      </div>

      {error() && <ErrorNote message={error()} />}

      <Field label={t('Email')} id={emailId} error={fieldErrors().email}>
        <Input
          id={emailId}
          type="email"
          autocomplete="email"
          inputmode="email"
          required
          value={email()}
          onInput={(e) => setEmail(e.currentTarget.value)}
          invalid={!!fieldErrors().email}
          data-autofocus
        />
      </Field>

      <Field label={t('Password')} id={passwordId} error={fieldErrors().password}>
        <Input
          id={passwordId}
          type="password"
          autocomplete="current-password"
          required
          value={password()}
          onInput={(e) => setPassword(e.currentTarget.value)}
          invalid={!!fieldErrors().password}
        />
      </Field>

      <Button type="submit" variant="primary" size="lg" block loading={busy()}>
        {t('Sign in')}
      </Button>

      <div class={styles.links}>
        <A href="/auth/forgot" class={styles.link}>
          {t('Forgot password?')}
        </A>
        <A href="/auth/register" class={styles.link}>
          {t('Create account')}
        </A>
      </div>
    </form>
  );
}
