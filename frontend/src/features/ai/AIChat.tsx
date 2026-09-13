import { ArrowUp, CalendarClock, CheckCheck, CirclePlus, ClockAlert, Sparkles, Sun, Timer } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { For, Show, createEffect, createSignal, onMount } from 'solid-js';
import { ApiError } from '~/api/client';
import { Button } from '~/components/ui/Button';
import { AIActionPreview, ToolTrace } from '~/features/ai/AIActionPreview';
import { aiApi, type ChatTurn } from '~/features/ai/api';
import { t } from '~/i18n';
import { authStore } from '~/stores/auth';
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

interface Suggestion {
  icon: () => JSX.Element;
  text: string;
}

const SUGGESTIONS: Suggestion[] = [
  { icon: () => <Sun size={15} />, text: 'What should I focus on today?' },
  { icon: () => <ClockAlert size={15} />, text: 'What is overdue right now?' },
  { icon: () => <CirclePlus size={15} />, text: 'Add "Review invoices" for tomorrow 10:00, business' },
  { icon: () => <CheckCheck size={15} />, text: 'Complete everything I finished about the website' },
  { icon: () => <Timer size={15} />, text: 'Start a business timer' },
  { icon: () => <CalendarClock size={15} />, text: 'Plan my day' },
];

const MAX_INPUT_HEIGHT = 200;

const [chatMessages, setChatMessages] = createSignal<ChatMessage[]>([]);
const [chatInput, setChatInput] = createSignal('');
const [chatBusy, setChatBusy] = createSignal(false);
const [chatConfirming, setChatConfirming] = createSignal<ID | null>(null);
let hydratedFor: ID | null = null;
let nextId = 1;

function storageKey(userId: ID): string {
  return `mt_ai_thread_${userId}`;
}

function hydrateThread(): void {
  const userId = authStore.user()?.id;
  if (!userId || hydratedFor === userId) return;
  hydratedFor = userId;
  try {
    const parsed = JSON.parse(sessionStorage.getItem(storageKey(userId)) ?? '[]') as ChatMessage[];
    const valid = Array.isArray(parsed) ? parsed.filter((message) => message?.role === 'user' || message?.role === 'assistant').slice(-80) : [];
    setChatMessages(valid);
    nextId = Math.max(1, ...valid.map((message) => message.id + 1));
  } catch {
    setChatMessages([]);
  }
}

export function AIChat(props: { prefill?: string; compact?: boolean; autofocus?: boolean }): JSX.Element {
  hydrateThread();
  const messages = chatMessages;
  const setMessages = setChatMessages;
  const input = chatInput;
  const setInput = setChatInput;
  const busy = chatBusy;
  const setBusy = setChatBusy;
  const confirming = chatConfirming;
  const setConfirming = setChatConfirming;
  let textarea: HTMLTextAreaElement | undefined;
  let scroller: HTMLDivElement | undefined;

  /** Empty canvas: the composer is centred until the first turn exists. */
  const blank = () => messages().length === 0 && !busy();

  const autoSize = () => {
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, MAX_INPUT_HEIGHT)}px`;
  };

  createEffect(() => {
    if (props.prefill) {
      setInput(props.prefill);
      queueMicrotask(() => {
        textarea?.focus();
        autoSize();
      });
    }
  });

  createEffect(() => {
    const userId = authStore.user()?.id;
    if (!userId || hydratedFor !== userId) return;
    try {
      sessionStorage.setItem(storageKey(userId), JSON.stringify(messages().slice(-80)));
    } catch {
      /* Storage can be unavailable in private browsing; in-memory history still survives navigation. */
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
    queueMicrotask(autoSize);
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
          text: result.reply || (result.changed ? t('Done.') : ''),
          toolCalls: result.tool_calls,
          pending: result.pending,
          pendingActionId: result.pending_action_id,
        },
      ]);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('AI is unavailable right now.');
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
      resolvePending(message.id, result.reply || t('Confirmed.'));
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('Could not confirm.'));
    } finally {
      setConfirming(null);
    }
  };

  const reject = async (message: ChatMessage) => {
    if (!message.pendingActionId) return;
    await aiApi.reject(message.pendingActionId).catch(() => undefined);
    resolvePending(message.id, t('Cancelled.'));
  };

  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };

  return (
    <div class={cx(styles.chat, props.compact && styles.compact, blank() && styles.blank)}>
      <div class={styles.scroll} ref={scroller}>
        <div class={styles.thread}>
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
      </div>

      <Show when={blank()}>
        <div class={styles.hero}>
          <span class={styles.heroIcon} aria-hidden="true">
            <Sparkles size={18} />
          </span>
          <h2 class={styles.heroTitle}>{t('What can I do for you?')}</h2>
          <p class={styles.heroText}>
            {t('Add, complete, reschedule and find tasks, start timers, create projects or plan the day — in plain language.')}
          </p>
        </div>
      </Show>

      <form
        class={styles.composer}
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <div class={styles.field}>
          <textarea
            ref={textarea}
            class={styles.input}
            rows={1}
            placeholder={t('Ask or instruct…')}
            value={input()}
            onInput={(e) => {
              setInput(e.currentTarget.value);
              autoSize();
            }}
            onKeyDown={onKey}
            disabled={busy()}
            aria-label={t('AI command')}
          />
          <Button
            type="submit"
            variant="primary"
            size="icon-sm"
            class={styles.sendBtn}
            disabled={!input().trim() || busy()}
            title={t('Send')}
            aria-label={t('Send')}
          >
            <ArrowUp size={15} />
          </Button>
        </div>
        <p class={styles.hint}>
          <kbd>Enter</kbd> {t('to send')} · <kbd>Shift</kbd>+<kbd>Enter</kbd> {t('for a new line')} · {t('destructive actions ask first')}
        </p>
      </form>

      <Show when={blank()}>
        <div class={styles.suggestions}>
          <For each={SUGGESTIONS}>
            {(s) => (
              <button type="button" class={styles.suggestion} onClick={() => void send(t(s.text))}>
                <span class={styles.suggestionIcon}>{s.icon()}</span>
                <span class={styles.suggestionText}>{t(s.text)}</span>
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
