import { describe, expect, it } from 'vitest';
import { gridSlot, type GridBox } from './createSortable';

const row = (left: number, top = 0): GridBox => ({ left, top, width: 100, height: 20 });

describe('grid slot', () => {
  const boxes = [row(0), row(110), row(220)];

  it('stays on the chip under the pointer', () => {
    expect(gridSlot(boxes, 160, 10, 1)).toBe(1);
  });

  it('moves to the left when the pointer crosses the previous centre', () => {
    expect(gridSlot(boxes, 40, 10, 1)).toBe(0);
  });

  it('moves to the end once the pointer passes the last centre', () => {
    expect(gridSlot(boxes, 280, 10, 1)).toBe(2);
  });

  it('counts a full earlier row before the current one', () => {
    const wrapped = [row(0, 0), row(110, 0), row(0, 28)];
    expect(gridSlot(wrapped, 50, 38, 2)).toBe(2);
    expect(gridSlot(wrapped, 50, 10, 2)).toBe(0);
  });
});
