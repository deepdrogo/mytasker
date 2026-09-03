import { Ban, Trash2 } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { For, Show, createSignal } from 'solid-js';
import { ApiError } from '~/api/client';
import { Button } from '~/components/ui/Button';
import { ConfirmDialog, EmptyState, Skeleton } from '~/components/ui/Feedback';
import { Checkbox } from '~/components/ui/Input';
import { sharesApi } from '~/features/sharing/api';
import { createQuery } from '~/hooks/createQuery';
import { t, tn } from '~/i18n';
import { toast } from '~/stores/ui';
import type { ShareLink } from '~/types';
import { formatRelative } from '~/utils/format';
import styles from './Settings.module.css';

type ShareState = 'revoked' | 'expired' | 'used' | 'active' | 'inactive';

const stateLabel = (state: ShareState): string => {
  switch (state) {
    case 'revoked':
      return t('revoked');
    case 'expired':
      return t('expired');
    case 'used':
      return t('used');
    case 'active':
      return t('active');
    default:
      return t('inactive');
  }
};

export default function SharingSection(): JSX.Element {
  const [showInactive, setShowInactive] = createSignal(false);
  const query = createQuery<ShareLink[]>(
    () => `shares:${showInactive() ? 'all' : 'active'}`,
    () => sharesApi.list({ active: showInactive() ? undefined : true }),
  );
  const [pending, setPending] = createSignal<{ kind: 'revoke' | 'delete'; share: ShareLink } | null>(null);
  const [busy, setBusy] = createSignal(false);

  const act = async () => {
    const p = pending();
    if (!p) return;
    setBusy(true);
    try {
      if (p.kind === 'revoke') await sharesApi.revoke(p.share.id);
      else await sharesApi.remove(p.share.id);
      toast(p.kind === 'revoke' ? t('Link revoked') : t('Link deleted'));
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('Action failed.'));
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  const state = (s: ShareLink): ShareState => {
    if (s.revoked_at) return 'revoked';
    if (s.expires_at && new Date(s.expires_at).getTime() < Date.now()) return 'expired';
    if ((s.one_time && s.use_count >= 1) || (s.max_uses !== null && s.use_count >= s.max_uses)) return 'used';
    return s.is_active ? 'active' : 'inactive';
  };

  return (
    <section class={styles.section}>
      <header class={styles.sectionHead}>
        <h2>{t('Sharing')}</h2>
        <p>{t('Anonymous links you created. Full URLs are never stored - only a fingerprint - so they cannot be shown again here.')}</p>
      </header>

      <div class={styles.row}>
        <Checkbox label={t('Show revoked and expired')} checked={showInactive()} onChange={(e) => setShowInactive(e.currentTarget.checked)} />
      </div>

      <Show when={query.data()} fallback={<Skeleton rows={3} height={56} />}>
        {(rows) => (
          <Show when={rows().length > 0} fallback={<EmptyState title={t('No share links.')} hint={t('Share a task from its menu or select several in a list.')} compact />}>
            <ul class={styles.list}>
              <For each={rows()}>
                {(s) => (
                  <li class={styles.row}>
                    <div class={styles.rowText}>
                      <span>{s.title || tn(s.task_count, 'task')}</span>
                      <span class={styles.rowHint}>
                        {tn(s.task_count, 'task')} · {s.requires_password ? t('password') : t('open')} · {s.one_time ? t('single use') : t('reusable')} ·{' '}
                        {t('used {count}×', { count: s.use_count })}
                        <Show when={s.expires_at}> · {t('expires {time}', { time: formatRelative(s.expires_at) })}</Show>
                        <Show when={s.last_opened_at}> · {t('last opened {time}', { time: formatRelative(s.last_opened_at) })}</Show>
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 'var(--s-2)', 'align-items': 'center' }}>
                      <span class={styles.badge}>{stateLabel(state(s))}</span>
                      <Show when={state(s) === 'active'}>
                        <Button variant="ghost" size="sm" title={t('Revoke')} onClick={() => setPending({ kind: 'revoke', share: s })}>
                          <Ban size={13} />
                        </Button>
                      </Show>
                      <Button variant="ghost" size="sm" title={t('Delete')} onClick={() => setPending({ kind: 'delete', share: s })}>
                        <Trash2 size={13} />
                      </Button>
                    </div>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        )}
      </Show>

      <ConfirmDialog
        open={pending() !== null}
        title={pending()?.kind === 'revoke' ? t('Revoke this link?') : t('Delete this link?')}
        message={
          pending()?.kind === 'revoke'
            ? t('Guests who open it will see that it was revoked. Completed work stays.')
            : t('The link and its guest history are removed. Tasks are not affected.')
        }
        confirmLabel={pending()?.kind === 'revoke' ? t('Revoke') : t('Delete')}
        destructive
        busy={busy()}
        onConfirm={() => void act()}
        onCancel={() => setPending(null)}
      />
    </section>
  );
}
