/**
 * One place that talks to /search/. Results are cached per term in the query cache under the "search"
 * namespace, so retyping a term is instant and any task / project mutation (which invalidates "search")
 * drops stale answers.
 */

import { api } from '~/api/client';
import { getCached, setCached } from '~/hooks/createQuery';
import type { SearchResults } from '~/types';

export const EMPTY_RESULTS: SearchResults = { tasks: [], projects: [], prompts: [], ideas: [], routine_items: [] };

/** Debounce between keystrokes and the request. Short on purpose: the server answers in a few ms. */
export const SEARCH_DEBOUNCE_MS = 70;
export const SEARCH_MIN_CHARS = 1;

export function normalizeTerm(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

export async function searchEverything(term: string, signal?: AbortSignal, limit = 8): Promise<SearchResults> {
  const key = `search:${limit}:${term.toLowerCase()}`;
  const cached = getCached<SearchResults>(key);
  if (cached) return cached;
  const data = await api.get<SearchResults>('/search/', { params: { q: term, limit }, signal });
  setCached(key, data);
  return data;
}

export function splitWords(term: string): string[] {
  return normalizeTerm(term).toLowerCase().split(' ').filter(Boolean);
}

/** Case-insensitive segments of `text`, marking the parts that match any of `words` (for <mark>). */
export function highlightSegments(text: string, words: string[]): Array<{ text: string; hit: boolean }> {
  if (!text || words.length === 0) return [{ text, hit: false }];
  const lower = text.toLowerCase();
  const hits: boolean[] = new Array<boolean>(text.length).fill(false);
  for (const word of words) {
    if (!word) continue;
    let from = 0;
    while (from <= lower.length - word.length) {
      const at = lower.indexOf(word, from);
      if (at === -1) break;
      for (let i = at; i < at + word.length; i += 1) hits[i] = true;
      from = at + word.length;
    }
  }
  const out: Array<{ text: string; hit: boolean }> = [];
  let start = 0;
  for (let i = 1; i <= text.length; i += 1) {
    if (i === text.length || hits[i] !== hits[start]) {
      out.push({ text: text.slice(start, i), hit: hits[start] ?? false });
      start = i;
    }
  }
  return out;
}
