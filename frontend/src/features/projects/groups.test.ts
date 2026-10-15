import { describe, expect, it } from 'vitest';
import { groupOf, groupProjects, toggledPriority } from './groups';
import type { Priority, ProjectCategory } from '~/types';

const p = (id: number, priority: Priority, category: ProjectCategory = 'general') => ({ id, priority, category });

describe('project groups', () => {
  it('files high and critical as important, startups apart', () => {
    expect(groupOf(p(1, 'high'))).toBe('important');
    expect(groupOf(p(2, 'critical'))).toBe('important');
    expect(groupOf(p(3, 'normal'))).toBe('normal');
    expect(groupOf(p(4, 'low'))).toBe('normal');
    expect(groupOf(p(5, 'high', 'startup'))).toBe('startup');
    expect(groupOf(p(5, 'high', 'startup'), false)).toBe('important');
  });

  it('keeps shelf order and the incoming order inside each group, skipping empty groups', () => {
    const list = [p(1, 'normal'), p(2, 'normal', 'startup'), p(3, 'high'), p(4, 'low'), p(5, 'critical')];
    expect(groupProjects(list).map((g) => [g.key, g.items.map((x) => x.id)])).toEqual([
      ['important', [3, 5]],
      ['normal', [1, 4]],
      ['startup', [2]],
    ]);
    expect(groupProjects([p(1, 'low')]).map((g) => g.key)).toEqual(['normal']);
  });

  it('stars to high and unstars to normal', () => {
    expect(toggledPriority(p(1, 'normal'))).toBe('high');
    expect(toggledPriority(p(1, 'low'))).toBe('high');
    expect(toggledPriority(p(1, 'critical'))).toBe('normal');
  });
});
