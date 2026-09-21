import { describe, expect, it } from 'vitest';
import { highlightSegments, normalizeTerm, splitWords } from './searchClient';

describe('search helpers', () => {
  it('normalises whitespace and splits words', () => {
    expect(normalizeTerm('  video   card ')).toBe('video card');
    expect(splitWords('  Video   CARD ')).toEqual(['video', 'card']);
    expect(splitWords('   ')).toEqual([]);
  });

  it('marks every matching word, case-insensitively, in any order', () => {
    const segments = highlightSegments('Fit a Video card for MyMask', ['card', 'video']);
    expect(segments.map((s) => [s.text, s.hit])).toEqual([
      ['Fit a ', false],
      ['Video', true],
      [' ', false],
      ['card', true],
      [' for MyMask', false],
    ]);
  });

  it('handles Georgian text and no matches', () => {
    expect(highlightSegments('ვიდეოკარტა კლიენტისთვის', ['კლიენტ'])).toEqual([
      { text: 'ვიდეოკარტა ', hit: false },
      { text: 'კლიენტ', hit: true },
      { text: 'ისთვის', hit: false },
    ]);
    expect(highlightSegments('nothing', ['zzz'])).toEqual([{ text: 'nothing', hit: false }]);
    expect(highlightSegments('', ['a'])).toEqual([{ text: '', hit: false }]);
  });
});
