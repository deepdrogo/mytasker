import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { createQuery, invalidate, setCached } from './createQuery';

// Invalidations flush on a short timer; a tick here outlasts it.
const tick = () => new Promise((r) => setTimeout(r, 25));

describe('createQuery', () => {
  it('fetches, caches within staleMs and refetches on prefix invalidation', async () => {
    const fetcher = vi.fn(async () => ({ n: fetcher.mock.calls.length }));
    await createRoot(async (dispose) => {
      const q = createQuery(() => 'tasks:personal:1', fetcher, { staleMs: 60_000 });
      await tick();
      await tick();
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(q.data()).toEqual({ n: 1 });

      invalidate('projects');
      await tick();
      expect(fetcher).toHaveBeenCalledTimes(1);

      invalidate('tasks');
      await tick();
      await tick();
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(q.data()).toEqual({ n: 2 });
      dispose();
    });
  });

  it('keeps the current data on screen while refetching (no blank state)', async () => {
    let resolveSecond: ((value: { n: number }) => void) | undefined;
    let calls = 0;
    const fetcher = vi.fn(() => {
      calls += 1;
      if (calls === 1) return Promise.resolve({ n: 1 });
      return new Promise<{ n: number }>((resolve) => {
        resolveSecond = resolve;
      });
    });
    await createRoot(async (dispose) => {
      const q = createQuery(() => 'tasks:live', fetcher);
      await tick();
      await tick();
      expect(q.data()).toEqual({ n: 1 });

      invalidate('tasks');
      await tick();
      expect(fetcher).toHaveBeenCalledTimes(2);
      // Old data stays visible during the refetch instead of flipping to undefined.
      expect(q.data()).toEqual({ n: 1 });
      expect(q.loading()).toBe(true);

      resolveSecond?.({ n: 2 });
      await tick();
      expect(q.data()).toEqual({ n: 2 });
      expect(q.loading()).toBe(false);
      dispose();
    });
  });

  it('coalesces several invalidations and a refetch in one tick into a single request', async () => {
    const fetcher = vi.fn(async () => ({ ok: true }));
    await createRoot(async (dispose) => {
      const q = createQuery(() => 'tasks:coalesce', fetcher);
      await tick();
      await tick();
      expect(fetcher).toHaveBeenCalledTimes(1);

      invalidate('tasks', 'today');
      invalidate('tasks');
      q.refetch();
      await tick();
      await tick();
      expect(fetcher).toHaveBeenCalledTimes(2);
      dispose();
    });
  });

  it('treats an API-layer invalidation and the awaiting caller refetch as one change', async () => {
    const fetcher = vi.fn(async () => ({ ok: true }));
    await createRoot(async (dispose) => {
      const q = createQuery(() => 'tasks:await', fetcher);
      await tick();
      expect(fetcher).toHaveBeenCalledTimes(1);

      // Mirrors tasksApi.complete(): invalidate inside the helper, then the caller's `await` continuation refetches.
      const helper = async () => {
        await Promise.resolve();
        invalidate('tasks');
      };
      await helper();
      await Promise.resolve();
      q.refetch();
      await tick();
      await tick();
      expect(fetcher).toHaveBeenCalledTimes(2);
      dispose();
    });
  });

  it('runs exactly one follow-up request when invalidated while a request is in flight', async () => {
    const pending: Array<(value: { n: number }) => void> = [];
    const fetcher = vi.fn(
      () =>
        new Promise<{ n: number }>((resolve) => {
          pending.push(resolve);
        }),
    );
    await createRoot(async (dispose) => {
      const q = createQuery(() => 'tasks:inflight', fetcher);
      await tick();
      expect(fetcher).toHaveBeenCalledTimes(1);
      pending.shift()?.({ n: 1 });
      await tick();
      expect(q.data()).toEqual({ n: 1 });

      invalidate('tasks');
      await tick();
      expect(fetcher).toHaveBeenCalledTimes(2);
      // Three more invalidations while request #2 is running...
      invalidate('tasks');
      await tick();
      invalidate('tasks');
      await tick();
      invalidate('tasks');
      await tick();
      expect(fetcher).toHaveBeenCalledTimes(2);

      pending.shift()?.({ n: 2 });
      await tick();
      // ...collapse into a single request #3 once #2 has landed.
      expect(fetcher).toHaveBeenCalledTimes(3);
      pending.shift()?.({ n: 3 });
      await tick();
      expect(q.data()).toEqual({ n: 3 });
      expect(q.loading()).toBe(false);
      dispose();
    });
  });

  it('shares one in-flight request between two queries on the same key', async () => {
    const fetcher = vi.fn(async () => ({ shared: true }));
    await createRoot(async (dispose) => {
      const a = createQuery(() => 'projects:selector:open', fetcher);
      const b = createQuery(() => 'projects:selector:open', fetcher);
      await tick();
      await tick();
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(a.data()).toEqual({ shared: true });
      expect(b.data()).toEqual({ shared: true });
      dispose();
    });
  });

  it('serves a fresh cached value without calling the fetcher', async () => {
    setCached('today', { ok: true });
    const fetcher = vi.fn(async () => ({ ok: false }));
    await createRoot(async (dispose) => {
      const q = createQuery(() => 'today', fetcher, { staleMs: 60_000 });
      await tick();
      await tick();
      expect(fetcher).not.toHaveBeenCalled();
      expect(q.data()).toEqual({ ok: true });
      dispose();
    });
  });
});
