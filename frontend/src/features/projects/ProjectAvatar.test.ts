import { describe, expect, it } from 'vitest';
import { initials, seed } from './ProjectAvatar';

describe('generated project avatar', () => {
  it('takes two letters from the name', () => {
    expect(initials('Masting AI')).toBe('MA');
    expect(initials('Replika')).toBe('RE');
    expect(initials('LAST EXIT / Trust And Game')).toBe('LE');
    expect(initials('ჩემი პროექტი')).toBe('ჩპ');
    expect(initials('  ---  ')).toBe('?');
  });

  it('is stable for the same project and varies between projects', () => {
    expect(seed(19, 'MyTasker')).toBe(seed(19, 'MyTasker'));
    const motifs = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((id) => seed(id, `Project ${id}`) % 5));
    expect(motifs.size).toBeGreaterThan(2);
  });
});
