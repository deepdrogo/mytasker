import { A, useLocation } from '@solidjs/router';
import {
  BookText,
  Briefcase,
  CalendarClock,
  CheckCircle2,
  CircleDashed,
  Coins,
  FolderKanban,
  Home,
  Lightbulb,
  ListChecks,
  Repeat,
  Rocket,
  ScrollText,
  Settings,
  Sparkles,
  TrendingUp,
  User,
} from 'lucide-solid';
import type { JSX } from 'solid-js';
import { For, Show } from 'solid-js';
import { LanguageSwitch } from '~/components/shared/LanguageSwitch';
import { Logo } from '~/components/shared/Logo';
import { t } from '~/i18n';
import { authStore } from '~/stores/auth';
import styles from './Sidebar.module.css';

interface NavLink {
  label: string;
  href: string;
  icon: () => JSX.Element;
  end?: boolean;
}

interface NavSection {
  label?: string;
  links: NavLink[];
}

const SECTIONS: NavSection[] = [
  {
    links: [{ label: 'Today', href: '/today', icon: () => <Home size={15} /> }],
  },
  {
    label: 'Tasks',
    links: [
      { label: 'Personal', href: '/tasks/personal', icon: () => <User size={15} /> },
      { label: 'Business', href: '/tasks/business', icon: () => <Briefcase size={15} /> },
      { label: 'Upcoming', href: '/tasks/upcoming', icon: () => <CalendarClock size={15} /> },
      { label: 'Completed', href: '/tasks/completed', icon: () => <CheckCircle2 size={15} /> },
    ],
  },
  {
    label: 'Projects',
    links: [
      { label: 'Active', href: '/projects/active', icon: () => <CircleDashed size={15} /> },
      { label: 'Startups', href: '/projects/startups', icon: () => <Rocket size={15} /> },
      { label: 'All', href: '/projects/all', icon: () => <FolderKanban size={15} /> },
      { label: 'Ideas', href: '/projects/ideas', icon: () => <Lightbulb size={15} /> },
    ],
  },
  {
    links: [{ label: 'Prompts', href: '/prompts', icon: () => <BookText size={15} /> }],
  },
  {
    label: 'Routine',
    links: [
      { label: 'Personal', href: '/routine/personal', icon: () => <Repeat size={15} /> },
      { label: 'Business', href: '/routine/business', icon: () => <ListChecks size={15} /> },
      { label: 'Rules', href: '/routine/rules', icon: () => <ScrollText size={15} /> },
    ],
  },
  {
    label: 'Insights',
    links: [
      { label: 'Daily', href: '/insights/daily', icon: () => <TrendingUp size={15} /> },
      { label: 'Weekly', href: '/insights/weekly', icon: () => <TrendingUp size={15} /> },
      { label: 'Monthly', href: '/insights/monthly', icon: () => <TrendingUp size={15} /> },
      { label: 'Time', href: '/insights/time', icon: () => <CalendarClock size={15} /> },
    ],
  },
];

const AI_LINK: NavLink = { label: 'AI', href: '/ai', icon: () => <Sparkles size={15} /> };
const FOOTER_LINKS: NavLink[] = [
  { label: 'Donate', href: '/donate', icon: () => <Coins size={15} /> },
  { label: 'Settings', href: '/settings', icon: () => <Settings size={15} /> },
];

export function Sidebar(props: { onNavigate?: () => void }): JSX.Element {
  const location = useLocation();
  const isActive = (href: string) => location.pathname === href || location.pathname.startsWith(`${href}/`);
  const footerLinks = () => (authStore.isAdmin() ? [AI_LINK, ...FOOTER_LINKS] : FOOTER_LINKS);

  return (
    <aside class={styles.sidebar} aria-label={t('Main navigation')}>
      <div class={styles.brand}>
        <A href="/today" class={styles.brandLink} onClick={props.onNavigate} aria-label={t('MyTasker - Today')}>
          <Logo size={22} />
        </A>
      </div>

      <nav class={styles.nav}>
        <For each={SECTIONS}>
          {(section) => (
            <div class={styles.section}>
              <Show when={section.label}>
                <p class={styles.sectionLabel}>{t(section.label!)}</p>
              </Show>
              <For each={section.links}>
                {(link) => (
                  <A
                    href={link.href}
                    class={[styles.link, isActive(link.href) ? styles.linkActive : ''].filter(Boolean).join(' ')}
                    onClick={props.onNavigate}
                    aria-current={isActive(link.href) ? 'page' : undefined}
                  >
                    <span class={styles.linkIcon}>{link.icon()}</span>
                    <span class={styles.linkLabel}>{t(link.label)}</span>
                  </A>
                )}
              </For>
            </div>
          )}
        </For>
      </nav>

      <div class={styles.footer}>
        <For each={footerLinks()}>
          {(link) => (
            <A
              href={link.href}
              class={[styles.link, isActive(link.href) ? styles.linkActive : ''].filter(Boolean).join(' ')}
              onClick={props.onNavigate}
            >
              <span class={styles.linkIcon}>{link.icon()}</span>
              <span class={styles.linkLabel}>{t(link.label)}</span>
            </A>
          )}
        </For>
        <Show when={props.onNavigate}>
          <div class={styles.langRow}>
            <LanguageSwitch compact />
          </div>
        </Show>
        <Show when={authStore.user()}>
          {(user) => (
            <A href="/settings/profile" class={styles.account} onClick={props.onNavigate}>
              <span class={styles.avatar} aria-hidden="true">
                {user().display_name.charAt(0).toUpperCase()}
              </span>
              <span class={styles.accountName}>{user().display_name}</span>
            </A>
          )}
        </Show>
      </div>
    </aside>
  );
}
