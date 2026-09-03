import { ExternalLink, RefreshCw } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { For, Show, createSignal, onCleanup } from 'solid-js';
import { ApiError } from '~/api/client';
import { Button } from '~/components/ui/Button';
import { ConfirmDialog } from '~/components/ui/Feedback';
import { telegramApi, type TelegramLinkStart } from '~/features/settings/api';
import { createQuery, invalidate } from '~/hooks/createQuery';
import { t } from '~/i18n';
import { refreshMe } from '~/stores/auth';
import { toast } from '~/stores/ui';
import type { TelegramStatus } from '~/types';
import { formatRelative } from '~/utils/format';
import styles from './Settings.module.css';

export default function TelegramSection(): JSX.Element {
  const status = createQuery<TelegramStatus>(() => 'telegram:status', () => telegramApi.status());
  const [link, setLink] = createSignal<TelegramLinkStart | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [confirmUnlink, setConfirmUnlink] = createSignal(false);
  const [showLog, setShowLog] = createSignal(false);
  const deliveries = createQuery(() => (showLog() ? 'telegram:deliveries' : null), () => telegramApi.deliveries());
  let poll: ReturnType<typeof setInterval> | undefined;
  onCleanup(() => clearInterval(poll));

  const startLink = async () => {
    setBusy(true);
    try {
      const data = await telegramApi.startLink();
      setLink(data);
      if (data.deep_link) window.open(data.deep_link, '_blank', 'noopener');
      // Poll until the bot confirms the /start <token> message.
      clearInterval(poll);
      poll = setInterval(async () => {
        const s = await telegramApi.status().catch(() => null);
        if (s?.linked) {
          clearInterval(poll);
          setLink(null);
          invalidate('telegram');
          await refreshMe();
          toast(t('Telegram linked'));
        }
      }, 3000);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('Could not start linking.'));
    } finally {
      setBusy(false);
    }
  };

  const unlink = async () => {
    setBusy(true);
    try {
      await telegramApi.unlink();
      await refreshMe();
      toast(t('Telegram unlinked'));
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('Could not unlink.'));
    } finally {
      setBusy(false);
      setConfirmUnlink(false);
    }
  };

  const test = async () => {
    try {
      await telegramApi.test();
      toast(t('Test message queued'));
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('Could not send.'));
    }
  };

  return (
    <section class={styles.section}>
      <header class={styles.sectionHead}>
        <h2>{t('Telegram')}</h2>
        <p>{t('Reminders, summaries and quick task management from chat. Commands: /add, /done, /list, /timer, /summary, /week - or just type naturally.')}</p>
      </header>

      <Show when={status.data()} fallback={<p class={styles.dim}>{t('Loading…')}</p>}>
        {(s) => (
          <div class={styles.card}>
            <Show when={s().configured} fallback={<p class={styles.dim}>{t('The Telegram bot is not configured on this server.')}</p>}>
              <Show
                when={s().linked}
                fallback={
                  <>
                    <p class={styles.dim}>{t('Not linked. Open the bot and press Start; the link expires in 10 minutes.')}</p>
                    <Show when={link()}>
                      {(l) => (
                        <div class={styles.form}>
                          <Show when={l().deep_link}>
                            <a class={styles.dim} href={l().deep_link} target="_blank" rel="noopener">
                              {t('Open @{name}', { name: l().bot_username })} <ExternalLink size={12} />
                            </a>
                          </Show>
                          <p class={styles.dim}>{t('Or send this to the bot manually:')}</p>
                          <code class={styles.code}>/start {l().token}</code>
                          <p class={styles.mono}>{t('Waiting for confirmation…')}</p>
                        </div>
                      )}
                    </Show>
                    <div class={styles.actions} style={{ 'justify-content': 'flex-start' }}>
                      <Button variant="primary" size="sm" loading={busy()} onClick={() => void startLink()}>
                        {link() ? t('Generate a new link') : t('Link Telegram')}
                      </Button>
                    </div>
                  </>
                }
              >
                <div class={styles.row} style={{ 'border-bottom': 'none', padding: '0' }}>
                  <div class={styles.rowText}>
                    <span>
                      {t('Linked as')} <strong>{s().first_name || s().username || t('Telegram user')}</strong>
                      <Show when={s().username}> (@{s().username})</Show>
                    </span>
                    <span class={styles.rowHint}>
                      {t('Linked {time}', { time: formatRelative(s().linked_at ?? null) })}
                      <Show when={s().last_interaction_at}> · {t('last message {time}', { time: formatRelative(s().last_interaction_at ?? null) })}</Show>
                    </span>
                  </div>
                  <span class={styles.badge}>{t('linked')}</span>
                </div>
                <div class={styles.actions} style={{ 'justify-content': 'flex-start' }}>
                  <Button variant="secondary" size="sm" onClick={() => void test()}>
                    {t('Send test message')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setShowLog(!showLog())}>
                    {showLog() ? t('Hide log') : t('Delivery log')}
                  </Button>
                  <Button variant="ghost" size="sm" loading={busy()} onClick={() => setConfirmUnlink(true)}>
                    {t('Unlink')}
                  </Button>
                </div>
              </Show>
            </Show>
          </div>
        )}
      </Show>

      <Show when={showLog()}>
        <div class={styles.section}>
          <div class={styles.row}>
            <span class={styles.dim}>{t('Last deliveries')}</span>
            <Button variant="ghost" size="sm" onClick={() => deliveries.refetch()} aria-label={t('Refresh')}>
              <RefreshCw size={13} />
            </Button>
          </div>
          <ul class={styles.list}>
            <For each={deliveries.data() ?? []} fallback={<li class={styles.dim}>{t('Nothing sent yet.')}</li>}>
              {(d) => (
                <li class={styles.row}>
                  <div class={styles.rowText}>
                    <span>{d.kind || t('message')}</span>
                    <span class={styles.rowHint}>
                      {formatRelative(d.created_at)} · {t('{count} attempt(s)', { count: d.attempts })}
                      <Show when={d.last_error}> · {d.last_error}</Show>
                    </span>
                  </div>
                  <span class={styles.badge}>{d.status}</span>
                </li>
              )}
            </For>
          </ul>
        </div>
      </Show>

      <ConfirmDialog
        open={confirmUnlink()}
        title={t('Unlink Telegram?')}
        message={t('You will stop receiving reminders and summaries in Telegram. You can link again any time.')}
        confirmLabel={t('Unlink')}
        onConfirm={() => void unlink()}
        onCancel={() => setConfirmUnlink(false)}
      />
    </section>
  );
}
