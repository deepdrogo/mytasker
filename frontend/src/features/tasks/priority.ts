// MyTasker — quick priority colours: High shows yellow, Critical shows red, everything else stays grey.

import type { Priority } from '~/types';

export type PriorityTone = 'red' | 'yellow';

export function priorityTone(priority: Priority): PriorityTone | null {
  if (priority === 'critical') return 'red';
  if (priority === 'high') return 'yellow';
  return null;
}

export const TONE_PRIORITY: Record<PriorityTone, Priority> = { red: 'critical', yellow: 'high' };

/** Tapping a colour sets it; tapping the colour the task already has takes it back to Normal. */
export function priorityAfterTap(current: Priority, tone: PriorityTone): Priority {
  return priorityTone(current) === tone ? 'normal' : TONE_PRIORITY[tone];
}
