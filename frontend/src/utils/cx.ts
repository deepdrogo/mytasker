/** Join class names, skipping falsy values. Plays well with `noUncheckedIndexedAccess` CSS-module typings. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
