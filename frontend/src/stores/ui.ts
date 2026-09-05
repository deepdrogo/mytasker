import { createSignal, onCleanup } from 'solid-js';

export type ToastTone = 'default' | 'strong';

export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
  action?: { label: string; run: () => void };
}

const [toasts, setToasts] = createSignal<Toast[]>([]);
const [paletteOpen, setPaletteOpen] = createSignal(false);
const [quickAddOpen, setQuickAddOpen] = createSignal(false);
const [aiOpen, setAiOpen] = createSignal(false);
const [aiPrefill, setAiPrefill] = createSignal('');
const [notificationsOpen, setNotificationsOpen] = createSignal(false);
const [sidebarOpen, setSidebarOpen] = createSignal(false);

// Desktop only: a pinned sidebar stays docked beside the canvas instead of sliding over it. Remembered per browser.
const SIDEBAR_PIN_KEY = 'mt_sidebar_pinned';

function readPinned(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_PIN_KEY) === '1';
  } catch {
    return false;
  }
}

const [sidebarPinned, setSidebarPinnedSignal] = createSignal(readPinned());

function setSidebarPinned(value: boolean): void {
  setSidebarPinnedSignal(value);
  try {
    if (value) localStorage.setItem(SIDEBAR_PIN_KEY, '1');
    else localStorage.removeItem(SIDEBAR_PIN_KEY);
  } catch {
    /* private mode - the choice lasts for this session only */
  }
}

let toastId = 0;

export function toast(message: string, options: { tone?: ToastTone; action?: Toast['action']; ms?: number } = {}): void {
  const id = ++toastId;
  const entry: Toast = { id, message, tone: options.tone ?? 'default' };
  if (options.action) entry.action = options.action;
  setToasts((list) => [...list, entry]);
  const ms = options.ms ?? (options.action ? 7000 : 3200);
  window.setTimeout(() => dismissToast(id), ms);
}

export function dismissToast(id: number): void {
  setToasts((list) => list.filter((t) => t.id !== id));
}

export const uiStore = {
  toasts,
  paletteOpen,
  quickAddOpen,
  aiOpen,
  aiPrefill,
  notificationsOpen,
  sidebarOpen,
  sidebarPinned,
  openPalette: () => setPaletteOpen(true),
  closePalette: () => setPaletteOpen(false),
  togglePalette: () => setPaletteOpen((v) => !v),
  openQuickAdd: () => setQuickAddOpen(true),
  closeQuickAdd: () => setQuickAddOpen(false),
  openAI: (prefill = '') => {
    setAiPrefill(prefill);
    setAiOpen(true);
  },
  closeAI: () => setAiOpen(false),
  consumeAIPrefill: (): string => {
    const value = aiPrefill();
    setAiPrefill('');
    return value;
  },
  toggleNotifications: () => setNotificationsOpen((v) => !v),
  closeNotifications: () => setNotificationsOpen(false),
  openSidebar: () => setSidebarOpen(true),
  closeSidebar: () => setSidebarOpen(false),
  toggleSidebar: () => setSidebarOpen((open) => !open),
  /** Pin: dock the sidebar and drop the overlay. Unpin: back to the slide-over, closed. */
  pinSidebar: () => {
    setSidebarPinned(true);
    setSidebarOpen(false);
  },
  unpinSidebar: () => {
    setSidebarPinned(false);
    setSidebarOpen(false);
  },
  togglePinnedSidebar: () => (sidebarPinned() ? uiStore.unpinSidebar() : uiStore.pinSidebar()),
};

/** Media query helper that stays reactive. */
export function createMediaQuery(query: string): () => boolean {
  const mql = window.matchMedia(query);
  const [value, setValue] = createSignal(mql.matches);
  const handler = (event: MediaQueryListEvent) => setValue(event.matches);
  mql.addEventListener('change', handler);
  onCleanup(() => mql.removeEventListener('change', handler));
  return value;
}

export function useIsMobile(): () => boolean {
  return createMediaQuery('(max-width: 899px)');
}
