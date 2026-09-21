/**
 * Remembers which objects this tab just changed itself, so the WebSocket echo of that very change does not
 * trigger a second refetch of everything on screen. Entries expire after a few seconds; anything arriving
 * later (Telegram, another tab, a team member) is treated as a genuine remote change.
 */

const TTL_MS = 5000;
const recent = new Map<string, number>();

function keyOf(type: string, id: number | string): string {
  return `${type}:${id}`;
}

function prune(now: number): void {
  for (const [key, at] of recent) {
    if (now - at > TTL_MS) recent.delete(key);
  }
}

export function noteLocalChange(type: string, ...ids: Array<number | string | null | undefined>): void {
  const now = Date.now();
  prune(now);
  for (const id of ids) {
    if (id === null || id === undefined) continue;
    recent.set(keyOf(type, id), now);
  }
}

/** True when this tab changed the object moments ago. One change can echo as several events, so nothing is consumed. */
export function isLocalEcho(type: string, id: number | string): boolean {
  const now = Date.now();
  prune(now);
  const key = keyOf(type, id);
  const at = recent.get(key);
  if (at === undefined) return false;
  return now - at <= TTL_MS;
}

/** Test hook. */
export function resetLocalChanges(): void {
  recent.clear();
}
