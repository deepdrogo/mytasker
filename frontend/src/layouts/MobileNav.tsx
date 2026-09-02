import { A, useLocation } from '@solidjs/router';
import { BookText, FolderKanban, Home, ListTodo, Sparkles, TrendingUp } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { For } from 'solid-js';
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

export function MobileNav(): JSX.Element {
  const location = useLocation();
  // The fifth slot is AI for administrators; everyone else gets Insights there.
  const items = () => [...BASE_ITEMS, authStore.isAdmin() ? AI_ITEM : INSIGHTS_ITEM];
  const isActive = (item: Item) => {
    const base = item.match ?? item.href;
    return location.pathname === base || location.pathname.startsWith(`${base}/`);
  };

  return (
    <nav class={styles.nav} aria-label="Primary">
      <For each={items()}>
        {(item) => (
          <A
            href={item.href}
            class={[styles.item, isActive(item) ? styles.active : ''].filter(Boolean).join(' ')}
            aria-current={isActive(item) ? 'page' : undefined}
          >
            <span class={styles.icon}>{item.icon()}</span>
            <span class={styles.label}>{item.label}</span>
          </A>
        )}
      </For>
    </nav>
  );
}
