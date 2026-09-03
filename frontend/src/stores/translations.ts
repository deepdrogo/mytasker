// MyTasker — translated user content (tasks, projects, notes…) produced in the background by Claude.
// Built by drogoz · https://github.com/deepdrogo/mytasker

/**
 * Components render `tx(type, id, field, original)`. The store batches unknown keys into one lookup
 * request, keeps every language of every translation it has seen, and is updated live through the
 * WebSocket when a background job finishes. Anything not (yet) translated falls back to the original.
 */

import { createSignal } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { api } from '~/api/client';
import { locale } from '~/i18n';
import { authStore } from '~/stores/auth';

export type TranslationStatus = 'ready' | 'pending' | 'failed' | 'none';

export interface TranslationEntry {
  status: TranslationStatus;
  source_lang?: string;
  translations?: Record<string, Record<string, string>>;
}

export type TranslatableType = 'task' | 'project' | 'idea' | 'prompt' | 'comment' | 'routine_item' | 'rule';

const TRANSLATABLE = new Set<string>(['task', 'project', 'idea', 'prompt', 'comment', 'routine_item', 'rule']);

const BATCH_DELAY_MS = 60;
const BATCH_SIZE = 200;
/** How long a key stays "pending" in the UI before we assume the job was lost and ask again. */
const PENDING_TTL_MS = 120_000;
/** Do not re-ask the server about the same key more often than this. */
const REASK_MS = 20_000;

const [entries, setEntries] = createStore<Record<string, TranslationEntry>>({});
const [pending, setPending] = createSignal<ReadonlySet<string>>(new Set());
const [enabled, setEnabled] = createSignal(true);

const wanted = new Set<string>();
const askedAt = new Map<string, number>();
const pendingSince = new Map<string, number>();
let flushTimer: number | undefined;
let sweepTimer: number | undefined;

export const translationStore = {
  entries,
  pending,
  pendingCount: () => pending().size,
  enabled,
};

export function translationKey(type: TranslatableType | string, id: number): string {
  return `${type}:${id}`;
}

/**
 * Display text for a user-written field in the current UI language.
 * Falls back to the original while the translation is missing, pending or failed.
 */
export function tx(type: TranslatableType | string, id: number | null | undefined, field: string, original: string): string {
  if (!original || id === null || id === undefined || !TRANSLATABLE.has(type)) return original;
  const key = translationKey(type, id);
  const lang = locale();
  const entry = entries[key];
  if (!entry) {
    want(key);
    return original;
  }
  if (entry.status === 'ready') {
    if (entry.source_lang === lang) return original;
    return entry.translations?.[lang]?.[field] ?? original;
  }
  return original;
}

/** True when a translated (different-language) value is being shown for this field. */
export function isTranslated(type: TranslatableType | string, id: number | null | undefined, field: string): boolean {
  if (id === null || id === undefined) return false;
  const entry = entries[translationKey(type, id)];
  const lang = locale();
  return !!entry && entry.status === 'ready' && entry.source_lang !== lang && !!entry.translations?.[lang]?.[field];
}

function want(key: string): void {
  if (!enabled()) return;
  const last = askedAt.get(key);
  if (last !== undefined && Date.now() - last < REASK_MS) return;
  wanted.add(key);
  if (flushTimer === undefined) flushTimer = window.setTimeout(flush, BATCH_DELAY_MS);
}

async function flush(): Promise<void> {
  flushTimer = undefined;
  if (!authStore.isAuthenticated()) {
    wanted.clear();
    return;
  }
  const keys = [...wanted].slice(0, BATCH_SIZE);
  keys.forEach((k) => wanted.delete(k));
  if (wanted.size > 0) flushTimer = window.setTimeout(flush, BATCH_DELAY_MS);
  if (keys.length === 0) return;
  const now = Date.now();
  keys.forEach((k) => askedAt.set(k, now));
  try {
    const res = await api.post<{ items: Record<string, TranslationEntry>; enabled: boolean }>('/translations/lookup/', {
      keys,
    });
    setEnabled(res.enabled !== false);
    for (const key of keys) {
      const item = res.items[key];
      // Keys the server did not echo are invisible to us or untranslatable - remember that to stop asking.
      apply(key, item ?? { status: 'none' });
    }
  } catch {
    // Network hiccup: allow a retry on the next render after the re-ask window.
    keys.forEach((k) => askedAt.delete(k));
  }
}

function apply(key: string, item: TranslationEntry): void {
  setEntries(key, reconcile(item));
  if (item.status === 'pending') {
    if (!pendingSince.has(key)) pendingSince.set(key, Date.now());
    setPending((set) => (set.has(key) ? set : new Set(set).add(key)));
    ensureSweep();
  } else {
    pendingSince.delete(key);
    setPending((set) => {
      if (!set.has(key)) return set;
      const next = new Set(set);
      next.delete(key);
      return next;
    });
  }
}

function ensureSweep(): void {
  if (sweepTimer !== undefined) return;
  sweepTimer = window.setInterval(() => {
    const now = Date.now();
    for (const [key, since] of pendingSince) {
      if (now - since > PENDING_TTL_MS) {
        pendingSince.delete(key);
        askedAt.delete(key);
        setEntries(key, undefined!);
        setPending((set) => {
          const next = new Set(set);
          next.delete(key);
          return next;
        });
      }
    }
    if (pendingSince.size === 0 && sweepTimer !== undefined) {
      window.clearInterval(sweepTimer);
      sweepTimer = undefined;
    }
  }, 10_000);
}

/** WebSocket: a background job finished (or failed) for `key`. */
export function receiveTranslation(message: { key: string } & TranslationEntry): void {
  const { key, ...item } = message;
  askedAt.set(key, Date.now());
  apply(key, item);
}

/** The original text changed - forget what we have so the next render asks again. */
export function markStale(type: string, id: number | null | undefined): void {
  if (id === null || id === undefined || !TRANSLATABLE.has(type)) return;
  const key = translationKey(type, id);
  askedAt.delete(key);
  if (entries[key]) setEntries(key, undefined!);
}

export function resetTranslations(): void {
  wanted.clear();
  askedAt.clear();
  pendingSince.clear();
  setEntries(reconcile({}));
  setPending(new Set<string>());
}
