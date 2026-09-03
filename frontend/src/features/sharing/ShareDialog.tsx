import { Check, Copy, Link2 } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { For, Show, createEffect, createSignal, untrack } from 'solid-js';
import { ApiError } from '~/api/client';
import { Button } from '~/components/ui/Button';
import { Checkbox, Field, Input, Select } from '~/components/ui/Input';
import { Modal } from '~/components/ui/Modal';
import { copyToClipboard } from '~/features/prompts/api';
import { sharesApi } from '~/features/sharing/api';
import { intlLocale, t, tn } from '~/i18n';
import { tx } from '~/stores/translations';
import { toast } from '~/stores/ui';
import type { ShareLink, Task } from '~/types';
import styles from './ShareDialog.module.css';

type Expiry = 'never' | '1h' | '24h' | '7d' | '30d';

const EXPIRY_MS: Record<Exclude<Expiry, 'never'>, number> = {
  '1h': 3600e3,
  '24h': 86400e3,
  '7d': 7 * 86400e3,
  '30d': 30 * 86400e3,
};

interface ShareDialogProps {
  tasks: Task[] | null;
  open: boolean;
  onClose: () => void;
}

/**
 * Create an anonymous share link for one or many tasks. The full URL is shown exactly once -
 * only a hash is stored server-side, so it cannot be recovered later.
 */
export function ShareDialog(props: ShareDialogProps): JSX.Element {
  const [title, setTitle] = createSignal('');
  const [password, setPassword] = createSignal('');
  const [expiry, setExpiry] = createSignal<Expiry>('7d');
  const [askName, setAskName] = createSignal(true);
  const [allowComplete, setAllowComplete] = createSignal(true);
  const [allowReopen, setAllowReopen] = createSignal(false);
  const [oneTime, setOneTime] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [created, setCreated] = createSignal<ShareLink | null>(null);
  const [copied, setCopied] = createSignal(false);

  createEffect(() => {
    if (!props.open) return;
    const tasks = props.tasks ?? [];
    // untrack: a locale switch while the dialog is open must not reset the form.
    setTitle(tasks.length === 1 ? tasks[0]?.title ?? '' : tasks.length ? untrack(() => tn(tasks.length, 'task')) : '');
    setPassword('');
    setExpiry('7d');
    setAskName(true);
    setAllowComplete(true);
    setAllowReopen(false);
    setOneTime(false);
    setCreated(null);
    setCopied(false);
  });

  const create = async () => {
    const tasks = props.tasks ?? [];
    if (!tasks.length || busy()) return;
    setBusy(true);
    try {
      const exp = expiry();
      const share = await sharesApi.create({
        task_ids: tasks.map((task) => task.id),
        title: title().trim(),
        password: password() || null,
        expires_at: exp === 'never' ? null : new Date(Date.now() + EXPIRY_MS[exp]).toISOString(),
        ask_guest_name: askName(),
        allow_complete: allowComplete(),
        allow_reopen: allowReopen(),
        one_time: oneTime(),
      });
      setCreated(share);
      await copy(share.url);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('Could not create link.'));
    } finally {
      setBusy(false);
    }
  };

  const copy = async (url: string) => {
    const ok = await copyToClipboard(url);
    setCopied(ok);
    if (ok) toast(t('Link copied'));
  };

  return (
    <Modal open={props.open} onClose={props.onClose} title={created() ? t('Link ready') : t('Share tasks')} size="sm">
      <Show
        when={!created()}
        fallback={
          <div class={styles.result}>
            <p class={styles.resultHint}>
              {t('Copy it now - for security only a fingerprint is stored, so this exact link is shown once.')}
            </p>
            <div class={styles.urlRow}>
              <code class={styles.url}>{created()?.url}</code>
              <Button variant="primary" size="sm" onClick={() => void copy(created()?.url ?? '')}>
                <Show when={copied()} fallback={<Copy size={14} />}>
                  <Check size={14} />
                </Show>
                {copied() ? t('Copied') : t('Copy')}
              </Button>
            </div>
            <ul class={styles.summary}>
              <li>{tn(created()?.task_count ?? 0, 'task')}</li>
              <li>{created()?.requires_password ? t('Password protected') : t('No password')}</li>
              <li>
                {created()?.expires_at
                  ? t('Expires {date}', { date: new Date(created()!.expires_at as string).toLocaleString(intlLocale()) })
                  : t('Never expires')}
              </li>
              <li>{created()?.one_time ? t('Single use') : t('Reusable')}</li>
            </ul>
            <p class={styles.manage}>{t('Manage or revoke links in Settings → Sharing.')}</p>
            <div class={styles.actions}>
              <Button variant="secondary" onClick={props.onClose}>
                {t('Done')}
              </Button>
            </div>
          </div>
        }
      >
        <form
          class={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <ul class={styles.tasks}>
            <For each={(props.tasks ?? []).slice(0, 6)}>{(task) => <li>{tx('task', task.id, 'title', task.title)}</li>}</For>
            <Show when={(props.tasks?.length ?? 0) > 6}>
              <li class={styles.more}>{t('+{count} more', { count: (props.tasks?.length ?? 0) - 6 })}</li>
            </Show>
          </ul>

          <Field label={t('Title (shown to guests)')}>
            <Input value={title()} onInput={(e) => setTitle(e.currentTarget.value)} maxLength={200} />
          </Field>

          <div class={styles.grid}>
            <Field label={t('Expires')}>
              <Select value={expiry()} onChange={(e) => setExpiry(e.currentTarget.value as Expiry)}>
                <option value="1h">{t('1 hour')}</option>
                <option value="24h">{t('24 hours')}</option>
                <option value="7d">{t('7 days')}</option>
                <option value="30d">{t('30 days')}</option>
                <option value="never">{t('Never')}</option>
              </Select>
            </Field>
            <Field label={t('Password (optional)')}>
              <Input
                type="text"
                autocomplete="off"
                placeholder={t('min 4 chars')}
                value={password()}
                onInput={(e) => setPassword(e.currentTarget.value)}
                maxLength={128}
              />
            </Field>
          </div>

          <div class={styles.options}>
            <Checkbox label={t('Ask guests for their name')} checked={askName()} onChange={(e) => setAskName(e.currentTarget.checked)} />
            <Checkbox label={t('Guests can complete tasks')} checked={allowComplete()} onChange={(e) => setAllowComplete(e.currentTarget.checked)} />
            <Checkbox label={t('Guests can reopen tasks')} checked={allowReopen()} onChange={(e) => setAllowReopen(e.currentTarget.checked)} />
            <Checkbox label={t('Single use (first visitor only)')} checked={oneTime()} onChange={(e) => setOneTime(e.currentTarget.checked)} />
          </div>

          <div class={styles.actions}>
            <Button variant="ghost" type="button" onClick={props.onClose}>
              {t('Cancel')}
            </Button>
            <Button variant="primary" type="submit" loading={busy()} disabled={!props.tasks?.length}>
              <Link2 size={14} /> {t('Create link')}
            </Button>
          </div>
        </form>
      </Show>
    </Modal>
  );
}
