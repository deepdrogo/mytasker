// MyTasker — donation addresses + author card. Shared by the in-app /donate page and the public /support page.
// Built by drogoz · https://github.com/deepdrogo/mytasker

import { Check, Copy, Github, Heart, Send } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { For, Show, createSignal } from 'solid-js';
import { api } from '~/api/client';
import { Button } from '~/components/ui/Button';
import { EmptyState, Skeleton } from '~/components/ui/Feedback';
import { copyToClipboard } from '~/features/prompts/api';
import { createQuery } from '~/hooks/createQuery';
import { toast } from '~/stores/ui';
import styles from './DonateContent.module.css';

export const AUTHOR_TELEGRAM = 'https://t.me/drogoz';
export const GITHUB_URL = 'https://github.com/deepdrogo/mytasker';

interface DonationAddress {
  id: number;
  asset: string;
  network: string;
  address: string;
  memo: string;
  note: string;
}

export function DonateContent(): JSX.Element {
  const query = createQuery<DonationAddress[]>(() => 'donations', () => api.get<DonationAddress[]>('/donations/'), { staleMs: 300_000 });
  const [copied, setCopied] = createSignal<number | null>(null);

  const copy = async (row: DonationAddress) => {
    if (await copyToClipboard(row.address)) {
      setCopied(row.id);
      toast(`${row.asset} address copied`);
      setTimeout(() => setCopied(null), 2000);
    }
  };

  return (
    <div class={styles.wrap}>
      <p class={styles.lead}>
        <Heart size={14} /> Donations are optional and never unlock features. Send only on the network listed for each address.
      </p>

      <Show when={query.data()} fallback={<Skeleton rows={2} height={96} />}>
        {(rows) => (
          <Show when={rows().length > 0} fallback={<EmptyState title="No donation addresses are published yet." compact />}>
            <ul class={styles.list}>
              <For each={rows()}>
                {(row) => (
                  <li class={styles.row}>
                    <div class={styles.head}>
                      <span class={styles.assetMark}>{row.asset === 'BTC' ? '₿' : row.asset.slice(0, 1)}</span>
                      <span class={styles.asset}>{row.asset}</span>
                      <Show when={row.network}>
                        <span class={styles.network}>{row.network}</span>
                      </Show>
                    </div>
                    <div class={styles.addressRow}>
                      <code class={styles.address}>{row.address}</code>
                      <Button variant="secondary" size="sm" onClick={() => void copy(row)}>
                        <Show when={copied() === row.id} fallback={<Copy size={13} />}>
                          <Check size={13} />
                        </Show>
                        Copy
                      </Button>
                    </div>
                    <Show when={row.memo}>
                      <div class={styles.memo}>
                        Memo / tag: <code>{row.memo}</code>
                      </div>
                    </Show>
                    <Show when={row.note}>
                      <p class={styles.note}>{row.note}</p>
                    </Show>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        )}
      </Show>

      <section class={styles.author}>
        <div class={styles.authorAvatar} aria-hidden="true">
          D
        </div>
        <div class={styles.authorBody}>
          <div class={styles.authorName}>
            Made by <strong>drogoz</strong>
          </div>
          <p class={styles.authorText}>
            MyTasker is a one-person project, kept free forever. Questions, ideas or a bug? Write to me directly on Telegram.
          </p>
          <div class={styles.authorLinks}>
            <a href={AUTHOR_TELEGRAM} target="_blank" rel="noreferrer" class={styles.authorPrimary}>
              <Send size={14} stroke-width={2.2} />
              @drogoz on Telegram
            </a>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer" class={styles.authorGhost}>
              <Github size={14} stroke-width={2} />
              Source on GitHub
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
