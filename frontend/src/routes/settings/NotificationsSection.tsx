import type { JSX } from 'solid-js';
import { For, Show, createSignal } from 'solid-js';
import { ApiError } from '~/api/client';
import { Button } from '~/components/ui/Button';
import { Checkbox, Field, Input, Select } from '~/components/ui/Input';
import { settingsApi } from '~/features/settings/api';
import { authStore } from '~/stores/auth';
import { toast } from '~/stores/ui';
import type { NotificationPreferences } from '~/types';
import styles from './Settings.module.css';

type EventKey = Exclude<keyof NotificationPreferences, 'mode' | 'telegram_enabled' | 'in_app_enabled' | 'quiet_hours_start' | 'quiet_hours_end'>;

const EVENTS: Array<{ key: EventKey; label: string; hint?: string }> = [
  { key: 'on_task_created', label: 'Task created in a shared project' },
  { key: 'on_task_completed', label: 'Task completed by a teammate' },
  { key: 'on_task_reopened', label: 'Task reopened' },
  { key: 'on_subtask_created', label: 'Subtask created' },
  { key: 'on_subtask_completed', label: 'Subtask completed' },
  { key: 'on_comment_created', label: 'New comment' },
  { key: 'on_deadline_changed', label: 'Deadline changed' },
  { key: 'on_assignment_changed', label: 'Assignment changed' },
  { key: 'on_member_joined', label: 'Member joined a project' },
  { key: 'on_member_removed', label: 'Member removed' },
  { key: 'on_share_task_completed', label: 'Guest completed a shared task' },
  { key: 'on_share_opened', label: 'Share link opened', hint: 'Can be noisy for reusable links.' },
  { key: 'on_reminder', label: 'Task reminders' },
];

export default function NotificationsSection(): JSX.Element {
  const initial = authStore.user()?.notification_preferences;
  const [form, setForm] = createSignal<NotificationPreferences>({
    mode: 'important',
    telegram_enabled: true,
    in_app_enabled: true,
    on_task_created: true,
    on_task_completed: true,
    on_task_reopened: false,
    on_subtask_created: false,
    on_subtask_completed: false,
    on_comment_created: true,
    on_deadline_changed: true,
    on_assignment_changed: true,
    on_member_joined: true,
    on_member_removed: true,
    on_share_task_completed: true,
    on_share_opened: false,
    on_reminder: true,
    quiet_hours_start: null,
    quiet_hours_end: null,
    ...initial,
  });
  const [busy, setBusy] = createSignal(false);
  const set = <K extends keyof NotificationPreferences>(key: K, value: NotificationPreferences[K]) => setForm((f) => ({ ...f, [key]: value }));

  const save = async () => {
    setBusy(true);
    try {
      await settingsApi.updateNotificationPreferences(form());
      toast('Notification settings saved');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section class={styles.section}>
      <header class={styles.sectionHead}>
        <h2>Notifications</h2>
        <p>"Important" keeps only what needs your attention. "Custom" lets you pick per event. Quiet hours hold Telegram messages until morning.</p>
      </header>
      <form
        class={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="Mode">
          <Select value={form().mode} onChange={(e) => set('mode', e.currentTarget.value as NotificationPreferences['mode'])}>
            <option value="important">Important only</option>
            <option value="all">Everything</option>
            <option value="custom">Custom</option>
          </Select>
        </Field>

        <div class={styles.row}>
          <Checkbox label="In-app notifications" checked={form().in_app_enabled} onChange={(e) => set('in_app_enabled', e.currentTarget.checked)} />
        </div>
        <div class={styles.row}>
          <div class={styles.rowText}>
            <Checkbox label="Telegram notifications" checked={form().telegram_enabled} onChange={(e) => set('telegram_enabled', e.currentTarget.checked)} />
            <Show when={!authStore.user()?.telegram_linked}>
              <span class={styles.rowHint}>Link Telegram in the Telegram section to receive these.</span>
            </Show>
          </div>
        </div>

        <div class={styles.grid}>
          <Field label="Quiet hours start" hint="Leave empty to disable">
            <Input type="time" value={form().quiet_hours_start?.slice(0, 5) ?? ''} onInput={(e) => set('quiet_hours_start', e.currentTarget.value || null)} />
          </Field>
          <Field label="Quiet hours end">
            <Input type="time" value={form().quiet_hours_end?.slice(0, 5) ?? ''} onInput={(e) => set('quiet_hours_end', e.currentTarget.value || null)} />
          </Field>
        </div>

        <Show when={form().mode === 'custom'}>
          <hr class={styles.divider} />
          <For each={EVENTS}>
            {(ev) => (
              <div class={styles.row}>
                <div class={styles.rowText}>
                  <Checkbox label={ev.label} checked={form()[ev.key]} onChange={(e) => set(ev.key, e.currentTarget.checked)} />
                  <Show when={ev.hint}>
                    <span class={styles.rowHint}>{ev.hint}</span>
                  </Show>
                </div>
              </div>
            )}
          </For>
        </Show>

        <div class={styles.actions}>
          <Button variant="primary" type="submit" loading={busy()}>
            Save
          </Button>
        </div>
      </form>
    </section>
  );
}
