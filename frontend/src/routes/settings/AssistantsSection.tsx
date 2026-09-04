import { Copy, KeyRound, Power, UserPlus } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { For, Show, createSignal } from 'solid-js';
import { ApiError } from '~/api/client';
import { Button } from '~/components/ui/Button';
import { ConfirmDialog, EmptyState, Skeleton } from '~/components/ui/Feedback';
import { Field, Input } from '~/components/ui/Input';
import { Modal } from '~/components/ui/Modal';
import { copyToClipboard } from '~/features/prompts/api';
import { assistantsApi } from '~/features/settings/api';
import { createQuery } from '~/hooks/createQuery';
import { t, tn } from '~/i18n';
import { toast } from '~/stores/ui';
import type { Assistant } from '~/types';
import { formatRelative } from '~/utils/format';
import styles from './Settings.module.css';

const MAX_ASSISTANTS = 5;

/**
 * Principal-side management of assistant logins. The generated password is shown exactly once
 * (creation / reset) - the server never stores it in clear text and cannot show it again.
 */
export default function AssistantsSection(): JSX.Element {
  const query = createQuery<Assistant[]>(() => 'assistants', () => assistantsApi.list());
  const [name, setName] = createSignal('');
  const [email, setEmail] = createSignal('');
  const [creating, setCreating] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [credentials, setCredentials] = createSignal<Assistant | null>(null);
  const [pending, setPending] = createSignal<{ kind: 'reset' | 'disable'; row: Assistant } | null>(null);
  const [busy, setBusy] = createSignal(false);

  const rows = () => query.data() ?? [];
  const atLimit = () => rows().filter((r) => r.is_active).length >= MAX_ASSISTANTS;

  const create = async (event: Event) => {
    event.preventDefault();
    if (!name().trim()) {
      setError(t('Name is required.'));
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const row = await assistantsApi.create({ full_name: name().trim(), email: email().trim() || undefined });
      setCredentials(row);
      setName('');
      setEmail('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('Action failed.'));
    } finally {
      setCreating(false);
    }
  };

  const act = async () => {
    const p = pending();
    if (!p) return;
    setBusy(true);
    try {
      if (p.kind === 'reset') {
        setCredentials(await assistantsApi.resetPassword(p.row.id));
      } else {
        await assistantsApi.remove(p.row.id);
        toast(t('Assistant disabled'));
      }
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('Action failed.'));
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  const enable = async (row: Assistant) => {
    try {
      await assistantsApi.update(row.id, { is_active: true });
      toast(t('Assistant enabled'));
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('Action failed.'));
    }
  };

  const copyAll = async (row: Assistant) => {
    const text = `${t('Email')}: ${row.email}\n${t('Password')}: ${row.password ?? ''}\n${window.location.origin}/auth/login`;
    if (await copyToClipboard(text)) toast(t('Copied'));
  };

  return (
    <section class={styles.section}>
      <header class={styles.sectionHead}>
        <h2>{t('Assistants')}</h2>
        <p>
          {t(
            'An assistant signs in with its own login and can add tasks to your personal and business lists and to your projects. It only ever sees the tasks it created itself - never your other tasks, routines, prompts or insights.',
          )}
        </p>
      </header>

      <form class={styles.card} onSubmit={(e) => void create(e)}>
        <div class={styles.grid}>
          <Field label={t('Assistant name')} required error={error() ?? undefined}>
            <Input value={name()} onInput={(e) => setName(e.currentTarget.value)} placeholder={t('e.g. Nino')} maxLength={120} disabled={atLimit()} />
          </Field>
          <Field label={t('Login email (optional)')} hint={t('Leave empty and we generate a login for you.')}>
            <Input type="email" value={email()} onInput={(e) => setEmail(e.currentTarget.value)} placeholder="assistant@example.com" disabled={atLimit()} />
          </Field>
        </div>
        <div class={styles.actions}>
          <Show when={atLimit()}>
            <span class={styles.dim}>{t('You can have at most {count} active assistants.', { count: MAX_ASSISTANTS })}</span>
          </Show>
          <Button type="submit" loading={creating()} disabled={atLimit()}>
            <UserPlus size={14} />
            {t('Create assistant')}
          </Button>
        </div>
      </form>

      <Show when={query.data()} fallback={<Skeleton rows={2} height={56} />}>
        <Show when={rows().length > 0} fallback={<EmptyState title={t('No assistants yet.')} hint={t('Create one above and hand over the generated password.')} compact />}>
          <ul class={styles.list}>
            <For each={rows()}>
              {(row) => (
                <li class={styles.row}>
                  <div class={styles.rowText}>
                    <span>{row.display_name}</span>
                    <span class={styles.rowHint}>
                      <span class={styles.mono}>{row.email}</span> · {tn(row.tasks_created, 'task')}
                      <Show when={row.last_seen_at}> · {t('seen {time}', { time: formatRelative(row.last_seen_at) })}</Show>
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 'var(--s-2)', 'align-items': 'center' }}>
                    <span class={styles.badge}>{row.is_active ? t('active') : t('disabled')}</span>
                    <Show when={row.is_active}>
                      <Button variant="ghost" size="sm" title={t('New password')} onClick={() => setPending({ kind: 'reset', row })}>
                        <KeyRound size={13} />
                      </Button>
                      <Button variant="ghost" size="sm" title={t('Disable')} onClick={() => setPending({ kind: 'disable', row })}>
                        <Power size={13} />
                      </Button>
                    </Show>
                    <Show when={!row.is_active}>
                      <Button variant="ghost" size="sm" onClick={() => void enable(row)} disabled={atLimit()}>
                        {t('Enable')}
                      </Button>
                    </Show>
                  </div>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Show>

      <Modal
        open={credentials() !== null}
        onClose={() => setCredentials(null)}
        title={t('Assistant credentials')}
        size="sm"
        footer={
          <>
            <Show when={credentials()}>
              {(row) => (
                <Button variant="secondary" onClick={() => void copyAll(row())}>
                  <Copy size={14} />
                  {t('Copy')}
                </Button>
              )}
            </Show>
            <Button onClick={() => setCredentials(null)} data-autofocus>
              {t('Done')}
            </Button>
          </>
        }
      >
        <Show when={credentials()}>
          {(row) => (
            <div class={styles.form}>
              <p class={styles.dim}>{t('Hand these to your assistant. The password is shown only now - you can generate a new one at any time.')}</p>
              <div>
                <p class={styles.rowHint}>{t('Email')}</p>
                <p class={styles.code}>{row().email}</p>
              </div>
              <div>
                <p class={styles.rowHint}>{t('Password')}</p>
                <p class={styles.code}>{row().password}</p>
              </div>
              <div>
                <p class={styles.rowHint}>{t('Sign in at')}</p>
                <p class={styles.code}>{`${window.location.origin}/auth/login`}</p>
              </div>
            </div>
          )}
        </Show>
      </Modal>

      <ConfirmDialog
        open={pending() !== null}
        title={pending()?.kind === 'reset' ? t('Generate a new password?') : t('Disable this assistant?')}
        message={
          pending()?.kind === 'reset'
            ? t('The current password stops working immediately. You will see the new one once.')
            : t('The assistant can no longer sign in. Tasks they added stay in your lists and you can enable them again later.')
        }
        confirmLabel={pending()?.kind === 'reset' ? t('New password') : t('Disable')}
        destructive={pending()?.kind === 'disable'}
        busy={busy()}
        onConfirm={() => void act()}
        onCancel={() => setPending(null)}
      />
    </section>
  );
}
