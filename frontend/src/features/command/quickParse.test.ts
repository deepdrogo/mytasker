import { describe, expect, it } from 'vitest';
import { quickParse } from './quickParse';

describe('quickParse', () => {
  it('extracts priority, kind, project and tags and keeps a clean title', () => {
    const r = quickParse('Call Anna tomorrow 15:00 !! #website @business ~design ~urgent');
    expect(r.title).toBe('Call Anna');
    expect(r.priority).toBe('high');
    expect(r.kind).toBe('business');
    expect(r.projectHint).toBe('website');
    expect(r.tags).toEqual(['design', 'urgent']);
    expect(r.due_has_time).toBe(true);
    const due = new Date(r.due_at as string);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    expect(due.getDate()).toBe(tomorrow.getDate());
    expect(due.getHours()).toBe(15);
    expect(due.getMinutes()).toBe(0);
  });

  it('defaults to end of day when only a date is given', () => {
    const r = quickParse('Pay rent today');
    expect(r.title).toBe('Pay rent');
    expect(r.due_has_time).toBe(false);
    expect(new Date(r.due_at as string).getHours()).toBe(23);
  });

  it('maps !!! to critical and @p to personal', () => {
    const r = quickParse('Fix prod outage !!! @p');
    expect(r.priority).toBe('critical');
    expect(r.kind).toBe('personal');
    expect(r.title).toBe('Fix prod outage');
  });

  it('leaves plain text untouched', () => {
    const r = quickParse('  Buy milk  ');
    expect(r).toMatchObject({ title: 'Buy milk', tags: [] });
    expect(r.due_at).toBeUndefined();
  });
});
