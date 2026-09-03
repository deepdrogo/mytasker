import type { JSX } from 'solid-js';
import { Show, createSignal } from 'solid-js';
import { ApiError } from '~/api/client';
import { Button } from '~/components/ui/Button';
import { Field, Input, Select } from '~/components/ui/Input';
import { settingsApi } from '~/features/settings/api';
import { LOCALES, LOCALE_LABEL, isLocale, locale, t } from '~/i18n';
import { authStore, guessTimezone } from '~/stores/auth';
import { changeLocale } from '~/stores/locale';
import { toast } from '~/stores/ui';
import styles from './Settings.module.css';

const TIMEZONES = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
  } catch {
    return [];
  }
})();

export default function ProfileSection(): JSX.Element {
  const me = () => authStore.user();
  const [fullName, setFullName] = createSignal(me()?.full_name ?? '');
  const [timezone, setTimezone] = createSignal(me()?.timezone ?? guessTimezone());
  const [busy, setBusy] = createSignal(false);
  const [resent, setResent] = createSignal(false);

  const save = async () => {
    setBusy(true);
    try {
      await settingsApi.updateProfile({ full_name: fullName().trim(), timezone: timezone() });
      toast(t('Profile saved'));
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('Could not save.'));
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    try {
      await settingsApi.resendVerification();
      setResent(true);
      toast(t('Verification email sent'));
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('Could not send.'));
    }
  };

  const zones = () => (TIMEZONES.includes(timezone()) ? TIMEZONES : [timezone(), ...TIMEZONES]);

  return (
    <section class={styles.section}>
      <header class={styles.sectionHead}>
        <h2>{t('Profile')}</h2>
        <p>{t('Your timezone drives "today", reminders and summaries - keep it accurate when you travel.')}</p>
      </header>
      <form
        class={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label={t('Email')}>
          <div class={styles.row} style={{ 'border-bottom': 'none', padding: '0' }}>
            <span>{me()?.email}</span>
            <Show
              when={me()?.email_verified}
              fallback={
                <Button variant="ghost" size="sm" type="button" disabled={resent()} onClick={() => void resend()}>
                  {resent() ? t('Sent') : t('Verify email')}
                </Button>
              }
            >
              <span class={styles.badge}>{t('verified')}</span>
            </Show>
          </div>
        </Field>
        <Field label={t('Full name')}>
          <Input value={fullName()} onInput={(e) => setFullName(e.currentTarget.value)} maxLength={120} autocomplete="name" />
        </Field>
        <Field label={t('Timezone')} hint={t('Detected: {zone}', { zone: guessTimezone() })}>
          <Show when={zones().length > 0} fallback={<Input value={timezone()} onInput={(e) => setTimezone(e.currentTarget.value)} />}>
            <Select value={timezone()} onChange={(e) => setTimezone(e.currentTarget.value)}>
              {zones().map((z) => (
                <option value={z}>{z}</option>
              ))}
            </Select>
          </Show>
        </Field>
        <Field label={t('Language')} hint={t('Interface language. Your tasks, projects and notes are translated into it automatically in the background.')}>
          <Select value={locale()} onChange={(e) => isLocale(e.currentTarget.value) && void changeLocale(e.currentTarget.value)}>
            {LOCALES.map((code) => (
              <option value={code}>{LOCALE_LABEL[code]}</option>
            ))}
          </Select>
        </Field>
        <div class={styles.actions}>
          <Button variant="primary" type="submit" loading={busy()}>
            {t('Save')}
          </Button>
        </div>
      </form>
    </section>
  );
}
