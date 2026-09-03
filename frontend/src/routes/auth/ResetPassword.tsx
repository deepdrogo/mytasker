import { A, useNavigate, useSearchParams } from '@solidjs/router';
import type { JSX } from 'solid-js';
import { createSignal, Show } from 'solid-js';
import { api, ApiError } from '~/api/client';
import { Button } from '~/components/ui/Button';
import { ErrorNote } from '~/components/ui/Feedback';
import { Field, Input, nextId } from '~/components/ui/Input';
import { t } from '~/i18n';
import { toast } from '~/stores/ui';
import styles from './auth.module.css';

export default function ResetPassword(): JSX.Element {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [password, setPassword] = createSignal('');
  const [error, setError] = createSignal('');
  const [fieldError, setFieldError] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const passwordId = nextId('password');
  const token = () => (typeof params.token === 'string' ? params.token : '');

  const submit = async (event: Event) => {
    event.preventDefault();
    setError('');
    setFieldError('');
    setBusy(true);
    try {
      await api.post('/auth/password/reset/confirm/', { token: token(), password: password() });
      toast(t('Password updated. Sign in with your new password.'));
      navigate('/auth/login', { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setFieldError(err.fieldError('password') ?? '');
        setError(err.fieldError('token') ?? err.message);
      } else {
        setError(t('Something went wrong.'));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Show
      when={token()}
      fallback={
        <div class={styles.form}>
          <h1 class={styles.heading}>{t('Invalid link')}</h1>
          <p class={styles.note}>{t('This reset link is missing its token.')}</p>
          <A href="/auth/forgot" class={styles.link} style={{ 'text-align': 'center' }}>
            {t('Request a new link')}
          </A>
        </div>
      }
    >
      <form class={styles.form} onSubmit={submit} novalidate>
        <h1 class={styles.heading}>{t('Set a new password')}</h1>

        {error() && <ErrorNote message={error()} />}

        <Field label={t('New password')} id={passwordId} error={fieldError()} hint={t('At least 10 characters.')}>
          <Input
            id={passwordId}
            type="password"
            autocomplete="new-password"
            required
            value={password()}
            onInput={(e) => setPassword(e.currentTarget.value)}
            invalid={!!fieldError()}
            data-autofocus
          />
        </Field>

        <Button type="submit" variant="primary" size="lg" block loading={busy()}>
          {t('Update password')}
        </Button>
      </form>
    </Show>
  );
}
