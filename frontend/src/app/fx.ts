// MyTasker — visual effects level. /fx.js picks it before first paint (weak device, Save-Data, reduced
// transparency); a choice saved here wins on every later visit.

export type FxLevel = 'low' | 'high';

const KEY = 'mt_fx';

export function fxLevel(): FxLevel {
  return document.documentElement.dataset.fx === 'low' ? 'low' : 'high';
}

export function setFxLevel(level: FxLevel): void {
  document.documentElement.dataset.fx = level;
  try {
    localStorage.setItem(KEY, level);
  } catch {
    /* private mode: applies to this visit only */
  }
}
