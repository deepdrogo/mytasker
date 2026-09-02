import { CalendarClock, History } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { For, Show, createSignal } from 'solid-js';
import { ApiError } from '~/api/client';
import { Page } from '~/components/shared/Page';
import { Button } from '~/components/ui/Button';
import { Drawer } from '~/components/ui/Drawer';
import { EmptyState } from '~/components/ui/Feedback';
import { AIChat } from '~/features/ai/AIChat';
import { aiApi, type PlanDayResult } from '~/features/ai/api';
import { createQuery } from '~/hooks/createQuery';
import { authStore } from '~/stores/auth';
import { toast } from '~/stores/ui';
import type { AIAction } from '~/types';
import { formatRelative } from '~/utils/format';
import styles from './AI.module.css';

/** Full-page AI Command Center: chat + Plan Day + action history. */
export default function AIPage(): JSX.Element {
  const [historyOpen, setHistoryOpen] = createSignal(false);
  const [plan, setPlan] = createSignal<PlanDayResult | null>(null);
  const [planning, setPlanning] = createSignal(false);
  const configured = () => authStore.aiEnabled();

  const planDay = async () => {
    setPlanning(true);
    try {
      setPlan(await aiApi.planDay());
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not plan the day.');
    } finally {
      setPlanning(false);
    }
  };

  return (
    <Page
      title="AI"
      subtitle="Talk to your workspace. Safe actions run instantly; destructive ones ask first."
      actions={
        <Show when={configured()}>
          <div class={styles.actions}>
            <Button variant="secondary" size="sm" loading={planning()} onClick={() => void planDay()}>
              <CalendarClock size={14} /> Plan my day
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setHistoryOpen(true)}>
              <History size={14} /> History
            </Button>
          </div>
        </Show>
      }
      scroll={false}
    >
      <Show
        when={configured()}
        fallback={
          <Show
            when={authStore.isAdmin()}
            fallback={
              <EmptyState
                title="Administrators only"
                hint="The AI assistant is available to administrator accounts. Ask an administrator if you need access."
              />
            }
          >
            <EmptyState
              title="AI is not configured"
              hint="Set ANTHROPIC_API_KEY in the backend environment and restart the API to enable the assistant."
            />
          </Show>
        }
      >
        <div class={styles.layout}>
          <div class={styles.chat}>
            <AIChat autofocus />
          </div>
          <Show when={plan()}>
            {(p) => (
              <aside class={styles.plan}>
                <div class={styles.planHead}>
                  <h2>Plan for today</h2>
                  <Button variant="ghost" size="sm" onClick={() => setPlan(null)}>
                    Close
                  </Button>
                </div>
                <p class={styles.planSummary}>{p().summary}</p>
                <ol class={styles.blocks}>
                  <For each={p().blocks}>
                    {(b) => (
                      <li class={styles.block}>
                        <span class={styles.blockTime}>
                          {b.start}–{b.end}
                        </span>
                        <div>
                          <div class={styles.blockLabel}>{b.label}</div>
                          <Show when={b.reason}>
                            <div class={styles.blockReason}>{b.reason}</div>
                          </Show>
                          <Show when={b.task_ids.length}>
                            <div class={styles.blockTasks}>{b.task_ids.length} task(s)</div>
                          </Show>
                        </div>
                      </li>
                    )}
                  </For>
                </ol>
                <Show when={p().defer?.length}>
                  <div class={styles.defer}>
                    <h3>Suggested to defer</h3>
                    <ul>
                      <For each={p().defer}>{(d) => <li>{d.reason}</li>}</For>
                    </ul>
                  </div>
                </Show>
              </aside>
            )}
          </Show>
        </div>
      </Show>

      <HistoryDrawer open={historyOpen()} onClose={() => setHistoryOpen(false)} />
    </Page>
  );
}

function HistoryDrawer(props: { open: boolean; onClose: () => void }): JSX.Element {
  const query = createQuery<AIAction[]>(() => (props.open ? 'ai:history' : null), () => aiApi.history());
  return (
    <Drawer open={props.open} onClose={props.onClose} title="AI history" width="420px">
      <Show when={query.data()?.length} fallback={<EmptyState title="No AI actions yet." compact />}>
        <ul class={styles.history}>
          <For each={query.data()}>
            {(a) => (
              <li class={styles.historyItem}>
                <div class={styles.historyHead}>
                  <span class={styles.status} data-status={a.status}>
                    {a.status}
                  </span>
                  <span class={styles.when}>{formatRelative(a.created_at)}</span>
                </div>
                <p class={styles.historyInput}>{a.input_text}</p>
                <Show when={a.reply_text}>
                  <p class={styles.historyReply}>{a.reply_text}</p>
                </Show>
                <Show when={a.tool_calls.length}>
                  <p class={styles.historyTools}>{a.tool_calls.map((c) => c.name).join(', ')}</p>
                </Show>
                <Show when={a.error}>
                  <p class={styles.historyError}>{a.error}</p>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </Drawer>
  );
}
