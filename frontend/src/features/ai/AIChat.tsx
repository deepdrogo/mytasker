import { ArrowUp, Sparkles } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { For, Show, createEffect, createSignal, onMount } from 'solid-js';
import { ApiError } from '~/api/client';
import { Button } from '~/components/ui/Button';
import { AIActionPreview, ToolTrace } from '~/features/ai/AIActionPreview';
import { aiApi, type ChatTurn } from '~/features/ai/api';
import { toast } from '~/stores/ui';
import type { AIPending, AIToolCall, ID } from '~/types';
import styles from './AIChat.module.css';
import { cx } from '~/utils/cx';

export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  toolCalls?: AIToolCall[];
  pending?: AIPending | null;
  pendingActionId?: ID | null;
  error?: boolean;
}

const SUGGESTIONS = [
  'What should I focus on today?',
  'Add "Review invoices" for tomorrow 10:00, business',
  'Complete everything I finished about the website',
  'Start a business timer',
  'Plan my day',
];

let nextId = 1;

export function AIChat(props: { prefill?: string; compact?: boolean; autofocus?: boolean }): JSX.Element {
  const [messages, setMessages] = createSignal<ChatMessage[]>([]);
  const [input, setInput] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [confirming, setConfirming] = createSignal<ID | null>(null);
  let textarea: HTMLTextAreaElement | undefined;
  let scroller: HTMLDivElement | undefined;

  createEffect(() => {
    if (props.prefill) {
      setInput(props.prefill);
      queueMicrotask(() => textarea?.focus());
    }
  });

  onMount(() => {
    if (props.autofocus) queueMicrotask(() => textarea?.focus());
  });

  const scrollToEnd = () => queueMicrotask(() => scroller?.scrollTo({ top: scroller.scrollHeight }));

  const history = (): ChatTurn[] =>
    messages()
      .filter((m) => !m.error)
      .slice(-8)
      .map((m) => ({ role: m.role, content: m.text }));

  const send = async (text = input()) => {
    const trimmed = text.trim();
    if (!trimmed || busy()) return;
    setInput('');
    setMessages((list) => [...list, { id: nextId++, role: 'user', text: trimmed }]);
    setBusy(true);
    scrollToEnd();
    try {
      const result = await aiApi.command(trimmed, history().slice(0, -1));
      setMessages((list) => [
        ...list,
        {
          id: nextId++,
          role: 'assistant',
          text: result.reply || (result.changed ? 'Done.' : ''),
          toolCalls: result.tool_calls,
          pending: result.pending,
          pendingActionId: result.pending_action_id,
        },
      ]);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'AI is unavailable right now.';
      setMessages((list) => [...list, { id: nextId++, role: 'assistant', text: message, error: true }]);
    } finally {
      setBusy(false);
      scrollToEnd();
      queueMicrotask(() => textarea?.focus());
    }
  };

  const resolvePending = (id: number, text: string) =>
    setMessages((list) => list.map((m) => (m.id === id ? { ...m, pending: null, pendingActionId: null, text: `${m.text}\n\n${text}`.trim() } : m)));

  const confirm = async (message: ChatMessage) => {
    if (!message.pendingActionId) return;
    setConfirming(message.pendingActionId);
    try {
      const result = await aiApi.confirm(message.pendingActionId);
      resolvePending(message.id, result.reply || 'Confirmed.');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not confirm.');
    } finally {
      setConfirming(null);
    }
  };

  const reject = async (message: ChatMessage) => {
    if (!message.pendingActionId) return;
    await aiApi.reject(message.pendingActionId).catch(() => undefined);
    resolvePending(message.id, 'Cancelled.');
  };

  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };

  return (
    <div class={cx(styles.chat, props.compact && styles.compact)}>
      <div class={styles.scroll} ref={scroller}>
        <Show when={messages().length === 0}>
          <div class={styles.intro}>
            <Sparkles size={18} />
            <p class={styles.introText}>
              Tell me what to do in plain language. I can add, complete, reschedule and find tasks, start timers, create
              projects, and plan your day. Anything destructive is shown for confirmation first.
            </p>
            <div class={styles.suggestions}>
              <For each={SUGGESTIONS}>
                {(s) => (
                  <button type="button" class={styles.suggestion} onClick={() => void send(s)}>
                    {s}
                  </button>
                )}
              </For>
            </div>
          </div>
        </Show>
        <For each={messages()}>
          {(m) => (
            <div class={cx(styles.message, m.role === 'user' && styles.user, m.role === 'assistant' && styles.assistant, m.error && styles.error)}>
              <div class={styles.bubble}>
                <Show when={m.text}>
                  <p class={styles.text}>{m.text}</p>
                </Show>
                <Show when={m.toolCalls?.length}>
                  <ToolTrace calls={m.toolCalls ?? []} />
                </Show>
                <Show when={m.pending && m.pendingActionId}>
                  <AIActionPreview
                    pending={m.pending as AIPending}
                    busy={confirming() === m.pendingActionId}
                    onConfirm={() => void confirm(m)}
                    onReject={() => void reject(m)}
                  />
                </Show>
              </div>
            </div>
          )}
        </For>
        <Show when={busy()}>
          <div class={`${styles.message} ${styles.assistant}`}>
            <div class={`${styles.bubble} ${styles.thinking}`} aria-live="polite">
              <span class={styles.dot} />
              <span class={styles.dot} />
              <span class={styles.dot} />
            </div>
          </div>
        </Show>
      </div>

      <form
        class={styles.composer}
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          ref={textarea}
          class={styles.input}
          rows={1}
          placeholder="Ask or instruct… (Enter to send, Shift+Enter for newline)"
          value={input()}
          onInput={(e) => setInput(e.currentTarget.value)}
          onKeyDown={onKey}
          disabled={busy()}
          aria-label="AI command"
        />
        <Button type="submit" variant="primary" size="sm" disabled={!input().trim() || busy()} title="Send">
          <ArrowUp size={14} />
        </Button>
      </form>
    </div>
  );
}
