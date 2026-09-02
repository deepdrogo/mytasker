import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { createQuery, invalidate, setCached } from './createQuery';

const tick = () => new Promise((r) => setTimeout(r, 0));

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
