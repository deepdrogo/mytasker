import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { createSortable } from './createSortable';

interface Row {
  id: number;
  name: string;
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const rows = (...ids: number[]): Row[] => ids.map((id) => ({ id, name: `p${id}` }));
const keys = (list: readonly Row[]) => list.map((r) => r.id);

describe('createSortable', () => {
  it('moves items with arrow-key semantics and reports the new order once', () => {
    createRoot((dispose) => {
      const [source] = createSignal(rows(1, 2, 3, 4));
      const onReorder = vi.fn();
      const sortable = createSortable<Row>({ items: source, key: (r) => r.id, onReorder });

      expect(keys(sortable.items())).toEqual([1, 2, 3, 4]);

      sortable.move(sortable.items()[2] as Row, -1); // 3 up
      expect(keys(sortable.items())).toEqual([1, 3, 2, 4]);
      expect(onReorder).toHaveBeenCalledTimes(1);
      expect(onReorder.mock.calls[0]?.[1]).toEqual([1, 3, 2, 4]);

      sortable.move(sortable.items()[0] as Row, -1); // already on top: no-op, no callback
      expect(keys(sortable.items())).toEqual([1, 3, 2, 4]);
      expect(onReorder).toHaveBeenCalledTimes(1);

      sortable.move(sortable.items()[0] as Row, 99); // clamps to the end
      expect(keys(sortable.items())).toEqual([3, 2, 4, 1]);
      expect(onReorder).toHaveBeenCalledTimes(2);
      dispose();
    });
  });

  it('follows the source list when it changes outside a drag', async () => {
    await createRoot(async (dispose) => {
      const [source, setSource] = createSignal(rows(1, 2, 3));
      const sortable = createSortable<Row>({ items: source, key: (r) => r.id, onReorder: () => undefined });
      await tick(); // effects are flushed once the root has rendered
      setSource(rows(3, 1, 2, 9));
      expect(keys(sortable.items())).toEqual([3, 1, 2, 9]);
      dispose();
    });
  });

  it('ignores moves when disabled', () => {
    createRoot((dispose) => {
      const [source] = createSignal(rows(1, 2));
      const onReorder = vi.fn();
      const sortable = createSortable<Row>({ items: source, key: (r) => r.id, onReorder, enabled: () => false });
      sortable.move(sortable.items()[1] as Row, -1);
      expect(keys(sortable.items())).toEqual([1, 2]);
      expect(onReorder).not.toHaveBeenCalled();
      dispose();
    });
  });
});
