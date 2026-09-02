import { authStore } from '~/stores/auth';
import { uiStore } from '~/stores/ui';

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/** Registers global keyboard shortcuts. Returns a disposer. */
export function registerGlobalShortcuts(): () => void {
  const handler = (event: KeyboardEvent) => {
    const mod = event.metaKey || event.ctrlKey;

    if (mod && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      uiStore.togglePalette();
      return;
    }

    if (isTypingTarget(event.target)) return;

    if (event.key === 'n' && !mod) {
      event.preventDefault();
      uiStore.openQuickAdd();
    } else if (event.key === '/' && !mod) {
      event.preventDefault();
      uiStore.openPalette();
    } else if (event.key === 'a' && !mod && authStore.isAdmin()) {
      event.preventDefault();
      uiStore.openAI();
    }
  };

  document.addEventListener('keydown', handler);
  return () => document.removeEventListener('keydown', handler);
}
