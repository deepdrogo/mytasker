import { Check, Copy, Heart } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { For, Show, createSignal } from 'solid-js';
import { api } from '~/api/client';
import { Page } from '~/components/shared/Page';
import { Button } from '~/components/ui/Button';
import { EmptyState, Skeleton } from '~/components/ui/Feedback';
import { copyToClipboard } from '~/features/prompts/api';
import { createQuery } from '~/hooks/createQuery';
import { toast } from '~/stores/ui';
import styles from './Donate.module.css';

interface DonationAddress {
  id: number;
  asset: string;
  network: string;
  address: string;
  memo: string;
  note: string;
}

export default function Donate(): JSX.Element {
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
    <Page title="Donate" subtitle="MyTasker is free and has no premium tier. If it saves you time, you can support hosting and development.">
      <div class={styles.wrap}>
        <p class={styles.lead}>
          <Heart size={14} /> Donations are optional and never unlock features. Send only on the network listed for each address.
        </p>
        <Show when={query.data()} fallback={<Skeleton rows={3} height={64} />}>
          {(rows) => (
            <Show when={rows().length > 0} fallback={<EmptyState title="No donation addresses are published yet." compact />}>
              <ul class={styles.list}>
                <For each={rows()}>
                  {(row) => (
                    <li class={styles.row}>
                      <div class={styles.head}>
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
      </div>
    </Page>
  );
}
