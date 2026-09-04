import { A, useLocation } from '@solidjs/router';
import { BookText, Briefcase, FolderKanban, Home, ListTodo, Settings, Sparkles, TrendingUp, User } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { For, onCleanup, onMount } from 'solid-js';
import { t } from '~/i18n';
import { authStore } from '~/stores/auth';
import styles from './MobileNav.module.css';

interface Item {
  label: string;
  href: string;
  match?: string;
  icon: () => JSX.Element;
}

const BASE_ITEMS: Item[] = [
  { label: 'Today', href: '/today', icon: () => <Home size={18} /> },
  { label: 'Tasks', href: '/tasks/personal', match: '/tasks', icon: () => <ListTodo size={18} /> },
  { label: 'Projects', href: '/projects/active', match: '/projects', icon: () => <FolderKanban size={18} /> },
  { label: 'Prompts', href: '/prompts', icon: () => <BookText size={18} /> },
];
const AI_ITEM: Item = { label: 'AI', href: '/ai', icon: () => <Sparkles size={18} /> };
const INSIGHTS_ITEM: Item = { label: 'Insights', href: '/insights/daily', match: '/insights', icon: () => <TrendingUp size={18} /> };

const ASSISTANT_ITEMS: Item[] = [
  { label: 'Personal', href: '/tasks/personal', icon: () => <User size={18} /> },
  { label: 'Business', href: '/tasks/business', icon: () => <Briefcase size={18} /> },
  { label: 'Projects', href: '/projects/active', match: '/projects', icon: () => <FolderKanban size={18} /> },
  { label: 'Settings', href: '/settings', icon: () => <Settings size={18} /> },
];

/**
 * iOS/Android do not tell the page when the software keyboard opens; the visual viewport just shrinks.
 * Mark <html data-keyboard="open"> when it loses a keyboard's worth of height so the dock can get out of the way
 * instead of floating in the middle of the screen above the keyboard.
 */
function trackKeyboard(): () => void {
  const vv = window.visualViewport;
  if (!vv) return () => undefined;
  const baseline = { h: Math.max(vv.height, window.innerHeight) };
  const update = () => {
    // Orientation change or address-bar collapse: re-baseline when the viewport grows.
    if (vv.height > baseline.h) baseline.h = vv.height;
    const shrunk = baseline.h - vv.height;
    const typing = document.activeElement?.matches('input, textarea, [contenteditable="true"]') ?? false;
    const open = shrunk > 120 && typing;
    document.documentElement.dataset.keyboard = open ? 'open' : 'closed';
  };
  vv.addEventListener('resize', update);
  window.addEventListener('orientationchange', () => {
    baseline.h = 0;
    setTimeout(update, 250);
  });
  document.addEventListener('focusout', () => setTimeout(update, 60));
  update();
  return () => {
    vv.removeEventListener('resize', update);
    delete document.documentElement.dataset.keyboard;
  };
}

export function MobileNav(): JSX.Element {
  const location = useLocation();
  onMount(() => {
    const stop = trackKeyboard();
    onCleanup(stop);
  });
  // The fifth slot is AI for administrators; everyone else gets Insights there.
  const items = () => {
    if (authStore.isAssistant()) return ASSISTANT_ITEMS;
    return [...BASE_ITEMS, authStore.isAdmin() ? AI_ITEM : INSIGHTS_ITEM];
  };
  const isActive = (item: Item) => {
    const base = item.match ?? item.href;
    return location.pathname === base || location.pathname.startsWith(`${base}/`);
  };

  return (
    <nav class={`${styles.nav} mt-hide-on-keyboard`} aria-label={t('Primary')}>
      <For each={items()}>
        {(item) => (
          <A
            href={item.href}
            class={[styles.item, isActive(item) ? styles.active : ''].filter(Boolean).join(' ')}
            aria-current={isActive(item) ? 'page' : undefined}
          >
            <span class={styles.icon}>{item.icon()}</span>
            <span class={styles.label}>{t(item.label)}</span>
          </A>
        )}
      </For>
    </nav>
  );
}
