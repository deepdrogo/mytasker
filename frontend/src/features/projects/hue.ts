/** The colour a project wears on the calendar, reused wherever the same project shows up (check-ins, dashboard). */
/** Crypto world's gold, matching its icon. */
export const CRYPTO_HUE = 40;

export function projectHue(projectId: number): number {
  return (projectId * 47 + 185) % 360;
}
