import { A, useNavigate } from '@solidjs/router';
import type { JSX } from 'solid-js';
import { createSignal } from 'solid-js';
import { ApiError } from '~/api/client';
import { Button } from '~/components/ui/Button';
import { ErrorNote } from '~/components/ui/Feedback';
import { Field, Input, nextId } from '~/components/ui/Input';
import { t } from '~/i18n';
import { guessTimezone, register } from '~/stores/auth';
import styles from './auth.module.css';

export default function Register(): JSX.Element {
  const navigate = useNavigate();
  const [fullName, setFullName] = createSignal('');
  const [email, setEmail] = createSignal('');
  const [password, setPassword] = createSignal('');
  const [error, setError] = createSignal('');
  const [fieldErrors, setFieldErrors] = createSignal<Record<string, string>>({});
  const [busy, setBusy] = createSignal(false);
  const nameId = nextId('name');
  const emailId = nextId('email');
  const passwordId = nextId('password');

  const submit = async (event: Event) => {
    event.preventDefault();
    setError('');
    setFieldErrors({});
    setBusy(true);
    try {
      await register({
        email: email().trim(),
        password: password(),
        full_name: fullName().trim(),
        timezone: guessTimezone(),
      });
      navigate('/dashboard', { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.isValidation ? t('Check the fields below.') : err.message);
        setFieldErrors({
          email: err.fieldError('email') ?? '',
          password: err.fieldError('password') ?? '',
          full_name: err.fieldError('full_name') ?? '',
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
        <h1 class={styles.heading}>{t('Create your account')}</h1>
        <p class={styles.sub}>{t('Free forever. Takes under a minute.')}</p>
      </div>

      {error() && <ErrorNote message={error()} />}

      <Field label={t('Name')} id={nameId} error={fieldErrors().full_name}>
        <Input
          id={nameId}
          type="text"
          autocomplete="name"
          value={fullName()}
          onInput={(e) => setFullName(e.currentTarget.value)}
          data-autofocus
        />
      </Field>

      <Field label={t('Email')} id={emailId} error={fieldErrors().email} required>
        <Input
          id={emailId}
          type="email"
          autocomplete="email"
          inputmode="email"
          required
          value={email()}
          onInput={(e) => setEmail(e.currentTarget.value)}
          invalid={!!fieldErrors().email}
        />
      </Field>

      <Field
        label={t('Password')}
        id={passwordId}
        error={fieldErrors().password}
        hint={t('At least 10 characters.')}
        required
      >
        <Input
          id={passwordId}
          type="password"
          autocomplete="new-password"
          required
          value={password()}
          onInput={(e) => setPassword(e.currentTarget.value)}
          invalid={!!fieldErrors().password}
        />
      </Field>

      <Button type="submit" variant="primary" size="lg" block loading={busy()}>
        {t('Create account')}
      </Button>

      <div class={styles.links}>
        <span class="mt-dim">{t('Already have an account?')}</span>
        <A href="/auth/login" class={styles.link}>
          {t('Sign in')}
        </A>
      </div>
    </form>
  );
}
