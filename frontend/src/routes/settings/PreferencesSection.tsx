import type { JSX } from 'solid-js';
import { createSignal } from 'solid-js';
import { ApiError } from '~/api/client';
import { Button } from '~/components/ui/Button';
import { Checkbox, Field, Input, Select } from '~/components/ui/Input';
import { settingsApi } from '~/features/settings/api';
import { authStore } from '~/stores/auth';
import { toast } from '~/stores/ui';
import type { UserPreferences } from '~/types';
import styles from './Settings.module.css';

export default function PreferencesSection(): JSX.Element {
  const initial = authStore.user()?.preferences;
  const [form, setForm] = createSignal<UserPreferences>({
    first_day_of_week: initial?.first_day_of_week ?? 0,
    time_format: initial?.time_format ?? '24h',
    default_task_type: initial?.default_task_type ?? 'personal',
    default_reminder_minutes: initial?.default_reminder_minutes ?? 30,
    business_hours_target_minutes: initial?.business_hours_target_minutes ?? 600,
    sleep_target_minutes: initial?.sleep_target_minutes ?? 480,
    planned_bedtime: initial?.planned_bedtime ?? null,
    planned_wake_time: initial?.planned_wake_time ?? null,
    morning_summary_enabled: initial?.morning_summary_enabled ?? true,
    morning_summary_time: initial?.morning_summary_time ?? '08:00',
    evening_summary_enabled: initial?.evening_summary_enabled ?? true,
    evening_summary_time: initial?.evening_summary_time ?? '21:00',
    weekly_review_enabled: initial?.weekly_review_enabled ?? true,
    monthly_review_enabled: initial?.monthly_review_enabled ?? true,
  });
  const [busy, setBusy] = createSignal(false);
  const set = <K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) => setForm((f) => ({ ...f, [key]: value }));
  const hours = (minutes: number) => String(Math.round((minutes / 60) * 10) / 10);
  const hhmm = (v: string) => v.slice(0, 5);

  const save = async () => {
    setBusy(true);
    try {
      await settingsApi.updatePreferences(form());
      toast('Preferences saved');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section class={styles.section}>
      <header class={styles.sectionHead}>
        <h2>Preferences</h2>
        <p>Targets feed the Today meters and Insights. Summary times are in your timezone.</p>
      </header>
      <form
        class={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div class={styles.grid}>
          <Field label="Business hours target / day">
            <Input
              type="number"
              min={0}
              max={24}
              step={0.5}
              value={hours(form().business_hours_target_minutes)}
              onInput={(e) => set('business_hours_target_minutes', Math.round(Number(e.currentTarget.value) * 60))}
            />
          </Field>
          <Field label="Sleep target / night (hours)">
            <Input
              type="number"
              min={0}
              max={16}
              step={0.5}
              value={hours(form().sleep_target_minutes)}
              onInput={(e) => set('sleep_target_minutes', Math.round(Number(e.currentTarget.value) * 60))}
            />
          </Field>
          <Field label="Planned bedtime">
            <Input type="time" value={form().planned_bedtime ?? ''} onInput={(e) => set('planned_bedtime', e.currentTarget.value || null)} />
          </Field>
          <Field label="Planned wake time">
            <Input type="time" value={form().planned_wake_time ?? ''} onInput={(e) => set('planned_wake_time', e.currentTarget.value || null)} />
          </Field>
          <Field label="Default task type">
            <Select value={form().default_task_type} onChange={(e) => set('default_task_type', e.currentTarget.value as UserPreferences['default_task_type'])}>
              <option value="personal">Personal</option>
              <option value="business">Business</option>
            </Select>
          </Field>
          <Field label="Default reminder (minutes before)">
            <Input type="number" min={0} max={1440} value={form().default_reminder_minutes} onInput={(e) => set('default_reminder_minutes', Number(e.currentTarget.value))} />
          </Field>
          <Field label="First day of week">
            <Select value={String(form().first_day_of_week)} onChange={(e) => set('first_day_of_week', Number(e.currentTarget.value))}>
              <option value="0">Monday</option>
              <option value="6">Sunday</option>
            </Select>
          </Field>
          <Field label="Time format">
            <Select value={form().time_format} onChange={(e) => set('time_format', e.currentTarget.value as '24h' | '12h')}>
              <option value="24h">24-hour</option>
              <option value="12h">12-hour</option>
            </Select>
          </Field>
        </div>

        <hr class={styles.divider} />

        <div class={styles.row}>
          <Checkbox label="Morning summary" checked={form().morning_summary_enabled} onChange={(e) => set('morning_summary_enabled', e.currentTarget.checked)} />
          <Input type="time" sizeVariant="sm" value={hhmm(form().morning_summary_time)} onInput={(e) => set('morning_summary_time', e.currentTarget.value)} style={{ width: '110px' }} />
        </div>
        <div class={styles.row}>
          <Checkbox label="Evening summary" checked={form().evening_summary_enabled} onChange={(e) => set('evening_summary_enabled', e.currentTarget.checked)} />
          <Input type="time" sizeVariant="sm" value={hhmm(form().evening_summary_time)} onInput={(e) => set('evening_summary_time', e.currentTarget.value)} style={{ width: '110px' }} />
        </div>
        <div class={styles.row}>
          <Checkbox label="Weekly review (Sunday evening)" checked={form().weekly_review_enabled} onChange={(e) => set('weekly_review_enabled', e.currentTarget.checked)} />
        </div>
        <div class={styles.row}>
          <Checkbox label="Monthly review (last day of month)" checked={form().monthly_review_enabled} onChange={(e) => set('monthly_review_enabled', e.currentTarget.checked)} />
        </div>

        <div class={styles.actions}>
          <Button variant="primary" type="submit" loading={busy()}>
            Save
          </Button>
        </div>
      </form>
    </section>
  );
}
