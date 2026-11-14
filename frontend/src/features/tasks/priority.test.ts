import { describe, expect, it } from 'vitest';
import { priorityAfterTap, priorityTone } from './priority';

describe('quick priority colours', () => {
  it('maps critical to red and high to yellow, the rest to none', () => {
    expect(priorityTone('critical')).toBe('red');
    expect(priorityTone('high')).toBe('yellow');
    expect(priorityTone('normal')).toBeNull();
    expect(priorityTone('low')).toBeNull();
  });

  it('sets a colour, switches between colours, and clears on a second tap', () => {
    expect(priorityAfterTap('normal', 'red')).toBe('critical');
    expect(priorityAfterTap('low', 'yellow')).toBe('high');
    expect(priorityAfterTap('high', 'red')).toBe('critical');
    expect(priorityAfterTap('critical', 'yellow')).toBe('high');
    expect(priorityAfterTap('critical', 'red')).toBe('normal');
    expect(priorityAfterTap('high', 'yellow')).toBe('normal');
  });
});
