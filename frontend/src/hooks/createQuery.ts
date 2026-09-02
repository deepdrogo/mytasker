/**
 * Minimal server-state layer: keyed resources with explicit invalidation.
 * Deliberately small - no giant global store, no over-fetching.
 *
 * Keys are namespaced with ":" (e.g. "tasks:personal:page=1"). Invalidating "tasks" refetches
 * every mounted query whose key starts with "tasks" - and only those.
 */

import { createResource, createSignal, type Accessor, type Resource, type Setter, type Signal } from 'solid-js';

const cache = new Map<string, { value: unknown; at: number }>();
const generations = new Map<string, Signal<number>>();

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

/** Invalidate every query whose key equals or starts with any prefix. */
export function invalidate(...prefixes: string[]): void {
  for (const prefix of prefixes) {
    for (const key of [...cache.keys()]) {
      if (matches(key, prefix)) cache.delete(key);
    }
    for (const [key, [get, set]] of generations) {
      if (matches(key, prefix)) set(get() + 1);
    }
  }
}

export function setCached<T>(key: string, value: T): void {
  cache.set(key, { value, at: Date.now() });
}

export function getCached<T>(key: string): T | undefined {
  return cache.get(key)?.value as T | undefined;
}

export function clearCache(): void {
  cache.clear();
  for (const [get, set] of generations.values()) set(get() + 1);
}

export interface QueryOptions {
  /** Serve the cached value without refetching while it is younger than this. */
  staleMs?: number;
  enabled?: Accessor<boolean>;
}

export interface QueryResult<T> {
  data: Resource<T | undefined>;
  refetch: () => void;
  mutate: Setter<T | undefined>;
  loading: Accessor<boolean>;
  error: Accessor<unknown>;
}

export function createQuery<T>(
  key: Accessor<string | null>,
  fetcher: (key: string) => Promise<T>,
  options: QueryOptions = {},
): QueryResult<T> {
  const staleMs = options.staleMs ?? 0;

  const source = (): { key: string; gen: number } | null => {
    if (options.enabled && !options.enabled()) return null;
    const k = key();
    if (!k) return null;
    const [gen] = generation(k);
    return { key: k, gen: gen() };
  };

  const [data, { refetch, mutate }] = createResource(
    source,
    async ({ key: k }: { key: string; gen: number }) => {
      const cached = cache.get(k);
      if (cached && staleMs > 0 && Date.now() - cached.at < staleMs) return cached.value as T;
      const value = await fetcher(k);
      cache.set(k, { value, at: Date.now() });
      return value;
    },
  );

  return {
    data,
    mutate: mutate as Setter<T | undefined>,
    refetch: () => void refetch(),
    loading: () => data.loading,
    error: () => data.error,
  };
}
