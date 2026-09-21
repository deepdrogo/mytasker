/**
 * Minimal server-state layer: keyed resources with explicit invalidation.
 * Deliberately small - no giant global store, no over-fetching.
 *
 * Keys are namespaced with ":" (e.g. "tasks:personal:page=1"). Invalidating "tasks" refetches
 * every mounted query whose key starts with "tasks" - and only those.
 *
 * Built on plain signals rather than `createResource` on purpose: a resource that refetches under a
 * `<Suspense>` boundary flips the boundary back to its fallback, so every completed task used to blank
 * the whole page and re-render it from scratch. Here a refetch keeps the current data on screen and
 * swaps it for the fresh copy when it lands - the list simply updates in place.
 *
 * Refetch requests are coalesced: `invalidate()` from the API layer, `refetch()` from a component
 * callback and a WebSocket echo arriving in the same tick collapse into a single request, and any
 * invalidation that arrives while a request is in flight results in exactly one follow-up request.
 */

import { batch, createEffect, createSignal, on, onCleanup, type Accessor, type Signal } from 'solid-js';

const cache = new Map<string, { value: unknown; at: number }>();
const generations = new Map<string, Signal<number>>();
/** One network request per key at a time, shared by every query mounted on that key. */
const inflight = new Map<string, Promise<unknown>>();

function generation(key: string): Signal<number> {
  let sig = generations.get(key);
  if (!sig) {
    sig = createSignal(0);
    generations.set(key, sig);
  }
  return sig;
}

function matches(key: string, prefix: string): boolean {
  return key === prefix || key.startsWith(`${prefix}:`);
}

let pendingPrefixes: Set<string> | null = null;

/**
 * Invalidations are flushed on a short timer rather than a microtask: an API helper invalidates while the
 * awaiting caller's continuation (which typically calls `refetch()` too) only runs a few microtasks later.
 * Waiting one macrotask lets both land in the same flush - one request instead of two.
 */
const FLUSH_DELAY_MS = 8;

function flushInvalidations(): void {
  const prefixes = pendingPrefixes;
  pendingPrefixes = null;
  if (!prefixes) return;
  batch(() => {
    for (const [key, [get, set]] of generations) {
      for (const prefix of prefixes) {
        if (matches(key, prefix)) {
          set(get() + 1);
          break;
        }
      }
    }
  });
}

/**
 * Invalidate every query whose key equals or starts with any prefix.
 * Cached values are dropped at once; the refetch itself is scheduled on the microtask queue so several
 * invalidations in one tick trigger one request per query.
 */
export function invalidate(...prefixes: string[]): void {
  for (const prefix of prefixes) {
    for (const key of [...cache.keys()]) {
      if (matches(key, prefix)) cache.delete(key);
    }
  }
  if (!pendingPrefixes) {
    pendingPrefixes = new Set();
    setTimeout(flushInvalidations, FLUSH_DELAY_MS);
  }
  for (const prefix of prefixes) pendingPrefixes.add(prefix);
}

export function setCached<T>(key: string, value: T): void {
  cache.set(key, { value, at: Date.now() });
}

export function getCached<T>(key: string): T | undefined {
  return cache.get(key)?.value as T | undefined;
}

export function clearCache(): void {
  cache.clear();
  batch(() => {
    for (const [get, set] of generations.values()) set(get() + 1);
  });
}

export interface QueryOptions {
  /** Serve the cached value without refetching while it is younger than this. */
  staleMs?: number;
  enabled?: Accessor<boolean>;
}

export type QueryMutator<T> = (value: T | undefined | ((previous: T | undefined) => T | undefined)) => void;

export interface QueryResult<T> {
  data: Accessor<T | undefined>;
  refetch: () => void;
  /** Replace the local copy (optimistic updates); the cache is kept in step. */
  mutate: QueryMutator<T>;
  loading: Accessor<boolean>;
  error: Accessor<unknown>;
}

function fetchShared<T>(key: string, fetcher: (key: string) => Promise<T>): Promise<T> {
  const running = inflight.get(key) as Promise<T> | undefined;
  if (running) return running;
  const promise = fetcher(key).finally(() => {
    if (inflight.get(key) === promise) inflight.delete(key);
  });
  inflight.set(key, promise);
  return promise;
}

export function createQuery<T>(
  key: Accessor<string | null>,
  fetcher: (key: string) => Promise<T>,
  options: QueryOptions = {},
): QueryResult<T> {
  const staleMs = options.staleMs ?? 0;
  const [data, setData] = createSignal<T | undefined>(undefined);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<unknown>(undefined);

  let sequence = 0;
  let activeKey: string | null = null;
  let loadingKey: string | null = null;
  let dirty = false;

  const source = (): { key: string; gen: number } | null => {
    if (options.enabled && !options.enabled()) return null;
    const k = key();
    if (!k) return null;
    const [gen] = generation(k);
    return { key: k, gen: gen() };
  };

  const load = (k: string): void => {
    if (loadingKey === k) {
      // Already fetching this key: remember to go once more when it lands, never twice at once.
      dirty = true;
      return;
    }
    dirty = false;
    loadingKey = k;
    const seq = ++sequence;
    setLoading(true);
    fetchShared(k, fetcher).then(
      (value) => {
        if (seq !== sequence) return;
        cache.set(k, { value, at: Date.now() });
        batch(() => {
          setData(() => value);
          setError(undefined);
        });
        settle(k);
      },
      (err: unknown) => {
        if (seq !== sequence) return;
        setError(err);
        settle(k);
      },
    );
  };

  const settle = (k: string): void => {
    loadingKey = null;
    if (dirty && activeKey === k) {
      load(k);
      return;
    }
    dirty = false;
    setLoading(false);
  };

  createEffect(
    on(source, (src) => {
      if (!src) return;
      const k = src.key;
      const keyChanged = k !== activeKey;
      activeKey = k;
      const cached = cache.get(k);
      if (cached && staleMs > 0 && Date.now() - cached.at < staleMs) {
        // Fresh enough: show it, cancel anything still in flight for an older key.
        sequence += 1;
        loadingKey = null;
        dirty = false;
        batch(() => {
          setData(() => cached.value as T);
          setError(undefined);
          setLoading(false);
        });
        return;
      }
      // Switching keys: show what we already know for the new key while the fresh copy loads.
      if (keyChanged && cached) setData(() => cached.value as T);
      if (keyChanged) {
        loadingKey = null;
        dirty = false;
      }
      load(k);
    }),
  );

  onCleanup(() => {
    sequence += 1;
  });

  const mutate: QueryMutator<T> = (value) => {
    const next = typeof value === 'function' ? (value as (previous: T | undefined) => T | undefined)(data()) : value;
    setData(() => next);
    if (activeKey) {
      if (next === undefined) cache.delete(activeKey);
      else cache.set(activeKey, { value: next, at: Date.now() });
    }
  };

  return {
    data,
    mutate,
    /** Same coalescing path as `invalidate`, so a callback refetch and an API invalidation cost one request. */
    refetch: () => {
      const k = key();
      if (k) invalidate(k);
    },
    loading,
    error,
  };
}
