import { describe, expect, it } from 'vitest';
import { inclusiveDays, projectSpan, taskSpan } from './span';

describe('task span', () => {
  it('counts Wednesday through Friday as three days', () => {
    const span = taskSpan({
      start_at: '2026-09-23T00:00:00',
      due_at: '2026-09-25T23:59:00',
    });
    expect(span).toEqual({ start: '2026-09-23', end: '2026-09-25' });
    expect(inclusiveDays(span!.start, span!.end)).toBe(3);
  });

  it('keeps a due-only task on its single day', () => {
    expect(taskSpan({ start_at: null, due_at: '2026-09-24T23:59:00' })).toEqual({
      start: '2026-09-24',
      end: '2026-09-24',
    });
  });

  it('ignores a task with neither date', () => {
    expect(taskSpan({ start_at: null, due_at: null })).toBeNull();
  });
});

describe('project span', () => {
  it('uses the drawn start and deadline as plain days', () => {
    expect(projectSpan({ start_date: '2026-10-02', deadline: '2026-10-10' }, '2026-11-01')).toEqual({
      start: '2026-10-02',
      end: '2026-10-10',
    });
  });

  it('runs an open-ended project to the last day shown', () => {
    expect(projectSpan({ start_date: '2026-10-02', deadline: null }, '2026-11-01')).toEqual({
      start: '2026-10-02',
      end: '2026-11-01',
    });
    expect(projectSpan({ start_date: '2026-12-02', deadline: null }, '2026-11-01')).toEqual({
      start: '2026-12-02',
      end: '2026-12-02',
    });
  });

  it('leaves an unscheduled project off the calendar', () => {
    expect(projectSpan({ start_date: null, deadline: '2026-10-10' }, '2026-11-01')).toBeNull();
  });
});
