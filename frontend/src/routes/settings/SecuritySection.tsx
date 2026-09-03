import type { JSX } from 'solid-js';
import { Show, createSignal } from 'solid-js';
import { ApiError } from '~/api/client';
import { Button } from '~/components/ui/Button';
import { Field, Input } from '~/components/ui/Input';
import { settingsApi } from '~/features/settings/api';
import { t } from '~/i18n';
import { logout } from '~/stores/auth';
import { toast } from '~/stores/ui';
import styles from './Settings.module.css';

const first = (v?: string[] | string): string => (Array.isArray(v) ? v[0] ?? '' : v ?? '');

export default function SecuritySection(): JSX.Element {
  const [current, setCurrent] = createSignal('');
  const [next, setNext] = createSignal('');
  const [confirm, setConfirm] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const [fieldErrors, setFieldErrors] = createSignal<Record<string, string>>({});

  const submit = async () => {
    setError('');
    setFieldErrors({});
    if (next() !== confirm()) {
      setFieldErrors({ confirm: t('Passwords do not match.') });
      return;
    }
    if (next().length < 10) {
      setFieldErrors({ next: t('Use at least 10 characters.') });
      return;
    }
    setBusy(true);
    try {
      await settingsApi.changePassword(current(), next());
      toast(t('Password changed. Other sessions were signed out.'));
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (err) {
      if (err instanceof ApiError) {
        const fields = err.fields ?? {};
        setFieldErrors({ current: first(fields.current_password), next: first(fields.new_password) });
        if (!fields.current_password && !fields.new_password) setError(err.message);
      } else setError(t('Could not change password.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section class={styles.section}>
      <header class={styles.sectionHead}>
        <h2>{t('Security')}</h2>
        <p>{t('Changing your password signs out every other device.')}</p>
      </header>
      <form
        class={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label={t('Current password')} error={fieldErrors().current}>
          <Input type="password" autocomplete="current-password" value={current()} onInput={(e) => setCurrent(e.currentTarget.value)} required />
        </Field>
        <Field label={t('New password')} hint={t('At least 10 characters; not only digits; not too similar to your email.')} error={fieldErrors().next}>
          <Input type="password" autocomplete="new-password" value={next()} onInput={(e) => setNext(e.currentTarget.value)} required />
        </Field>
        <Field label={t('Repeat new password')} error={fieldErrors().confirm}>
          <Input type="password" autocomplete="new-password" value={confirm()} onInput={(e) => setConfirm(e.currentTarget.value)} required />
        </Field>
        <Show when={error()}>
          <p class={styles.error}>{error()}</p>
        </Show>
        <div class={styles.actions}>
          <Button variant="primary" type="submit" loading={busy()}>
            {t('Change password')}
          </Button>
        </div>
      </form>

      <hr class={styles.divider} />

      <div class={styles.row}>
        <div class={styles.rowText}>
          <span>{t('Sign out')}</span>
          <span class={styles.rowHint}>{t('Ends this session on this device.')}</span>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void logout()}>
          {t('Sign out')}
        </Button>
      </div>
    </section>
  );
}
