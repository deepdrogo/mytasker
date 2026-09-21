/** Lets the global "/" shortcut focus the inline search when one is mounted, and fall back to the palette otherwise. */

let handler: (() => void) | null = null;

export function registerSearchFocus(fn: (() => void) | null): void {
  handler = fn;
}

/** Returns true when an inline search took the focus. */
export function focusSearch(): boolean {
  if (!handler) return false;
  handler();
  return true;
}
