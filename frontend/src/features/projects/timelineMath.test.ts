import { describe, expect, it } from 'vitest';
import { addDays, diffDays, overlapsWindow, previewRange, rangeForSave, sameRange, windowColumns } from './timelineMath';

const WINDOW_START = '2026-09-01';
const WINDOW_END = '2026-11-30';

describe('timeline date maths', () => {
  it('walks days across month and year boundaries', () => {
    expect(addDays('2026-09-28', 5)).toBe('2026-10-03');
    expect(addDays('2027-01-02', -3)).toBe('2026-12-30');
    expect(diffDays('2026-09-07', '2026-09-10')).toBe(3);
    expect(diffDays('2026-11-30', '2026-09-01')).toBe(-90);
  });

  it('draws a new range in either direction', () => {
    const empty = { start: null, end: null };
    expect(previewRange(empty, 'create', '2026-09-07', '2026-09-10')).toEqual({ start: '2026-09-07', end: '2026-09-10' });
    expect(previewRange(empty, 'create', '2026-09-10', '2026-09-07')).toEqual({ start: '2026-09-07', end: '2026-09-10' });
  });

  it('moves a range as a whole and keeps open-ended work open', () => {
    const closed = { start: '2026-09-07', end: '2026-09-10' };
    expect(previewRange(closed, 'move', '2026-09-08', '2026-09-11')).toEqual({ start: '2026-09-10', end: '2026-09-13' });

    const open = { start: '2026-09-07', end: null };
    expect(previewRange(open, 'move', '2026-09-07', '2026-09-05')).toEqual({ start: '2026-09-05', end: null });
  });

  it('snaps the dragged edge to the day under the cursor, wherever the grab started', () => {
    const range = { start: '2026-09-07', end: '2026-09-10' };
    // Grabbing a pixel off (from = 09-09 rather than the true edge 09-10) must not shift the result.
    expect(previewRange(range, 'end', '2026-09-09', '2026-09-14')).toEqual({ start: '2026-09-07', end: '2026-09-14' });
    expect(previewRange(range, 'end', '2026-09-10', '2026-09-14')).toEqual({ start: '2026-09-07', end: '2026-09-14' });
    expect(previewRange(range, 'start', '2026-09-08', '2026-09-03')).toEqual({ start: '2026-09-03', end: '2026-09-10' });

    // Dragging an edge past the other one collapses to a single day instead of inverting the range.
    expect(previewRange(range, 'start', '2026-09-07', '2026-09-20')).toEqual({ start: '2026-09-10', end: '2026-09-10' });
    expect(previewRange(range, 'end', '2026-09-10', '2026-09-01')).toEqual({ start: '2026-09-07', end: '2026-09-07' });
  });

  it('gives an open-ended project an end once its right edge is dragged', () => {
    const open = { start: '2026-09-07', end: null };
    expect(previewRange(open, 'end', '2026-09-07', '2026-09-12')).toEqual({ start: '2026-09-07', end: '2026-09-12' });
  });

  it('knows what belongs in the visible window', () => {
    expect(overlapsWindow({ start: null, end: null }, WINDOW_START, WINDOW_END)).toBe(false);
    expect(overlapsWindow({ start: '2026-08-01', end: '2026-08-30' }, WINDOW_START, WINDOW_END)).toBe(false);
    expect(overlapsWindow({ start: '2026-08-01', end: '2026-09-02' }, WINDOW_START, WINDOW_END)).toBe(true);
    expect(overlapsWindow({ start: '2026-07-01', end: null }, WINDOW_START, WINDOW_END)).toBe(true);
    expect(overlapsWindow({ start: '2027-01-05', end: null }, WINDOW_START, WINDOW_END)).toBe(false);
  });

  it('clears both ends when a project is taken off the calendar', () => {
    expect(rangeForSave({ start: '2026-09-07', end: '2026-09-10' })).toEqual({ start: '2026-09-07', end: '2026-09-10' });
    expect(rangeForSave({ start: '2026-09-07', end: null })).toEqual({ start: '2026-09-07', end: null });
    expect(rangeForSave({ start: null, end: '2026-09-10' })).toEqual({ start: null, end: null });
    expect(sameRange({ start: null, end: null }, rangeForSave({ start: null, end: '2026-09-10' }))).toBe(true);
  });

  it('clips ranges to the window when positioning a bar', () => {
    expect(windowColumns({ start: '2026-09-07', end: '2026-09-10' }, WINDOW_START, WINDOW_END)).toEqual({ offset: 6, span: 4 });
    expect(windowColumns({ start: '2026-08-20', end: '2026-09-03' }, WINDOW_START, WINDOW_END)).toEqual({ offset: 0, span: 3 });
    expect(windowColumns({ start: '2026-11-29', end: null }, WINDOW_START, WINDOW_END)).toEqual({ offset: 89, span: 2 });
  });
});
