import { A, useLocation } from '@solidjs/router';
import {
  Bitcoin,
  BookText,
  Briefcase,
  CalendarClock,
  CalendarOff,
  CalendarRange,
  CheckCircle2,
  CircleDashed,
  Columns3,
  Coins,
  FolderKanban,
  Handshake,
  LayoutDashboard,
  LayoutGrid,
  Lightbulb,
  ListChecks,
  Pin,
  PinOff,
  Repeat,
  Rocket,
  ScrollText,
  Settings,
  Sparkles,
  Sun,
  Sunrise,
  TrendingUp,
  User,
  UserCheck,
  Users,
  X,
} from 'lucide-solid';
import type { JSX } from 'solid-js';
import { For, Show } from 'solid-js';
import { LanguageSwitch } from '~/components/shared/LanguageSwitch';
import { Logo } from '~/components/shared/Logo';
import { peopleApi } from '~/features/people/api';
import { createQuery } from '~/hooks/createQuery';
import { t } from '~/i18n';
import { authStore } from '~/stores/auth';
import { uiStore } from '~/stores/ui';
import styles from './Sidebar.module.css';

interface NavLink {
  label: string;
  href: string;
  icon: () => JSX.Element;
  end?: boolean;
  /** Dynamic entries (People) carry a display name, not a translation key. */
  raw?: boolean;
  count?: number;
}

interface NavSection {
  label?: string;
  links: NavLink[];
}

const SECTIONS: NavSection[] = [
  {
    links: [
      { label: 'Dashboard', href: '/dashboard', icon: () => <LayoutDashboard size={15} /> },
      { label: 'Today', href: '/today', icon: () => <Sun size={15} /> },
      { label: 'Tomorrow', href: '/tomorrow', icon: () => <Sunrise size={15} /> },
    ],
  },
  {
    label: 'Tasks',
    links: [
      { label: 'Clients', href: '/tasks/clients', icon: () => <Handshake size={15} /> },
      { label: 'All', href: '/tasks/all', icon: () => <LayoutGrid size={15} /> },
      { label: 'Personal', href: '/tasks/personal', icon: () => <User size={15} /> },
      { label: 'Business', href: '/tasks/business', icon: () => <Briefcase size={15} /> },
      { label: 'Crypto world', href: '/tasks/crypto', icon: () => <Bitcoin size={15} /> },
      { label: 'Upcoming', href: '/tasks/upcoming', icon: () => <CalendarClock size={15} /> },
      { label: 'Calendar', href: '/tasks/calendar', icon: () => <CalendarRange size={15} /> },
      { label: 'No date', href: '/tasks/no-date', icon: () => <CalendarOff size={15} /> },
      { label: 'Completed', href: '/tasks/completed', icon: () => <CheckCircle2 size={15} /> },
    ],
  },
  {
    label: 'Projects',
    links: [
      { label: 'All', href: '/projects/all', icon: () => <FolderKanban size={15} /> },
      { label: 'Canvas', href: '/projects/canvas', icon: () => <Columns3 size={15} /> },
      { label: 'Active', href: '/projects/active', icon: () => <CircleDashed size={15} /> },
      { label: 'Startups', href: '/projects/startups', icon: () => <Rocket size={15} /> },
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

/** What an assistant login gets: the principal's task lists and projects, nothing else. */
const ASSISTANT_SECTIONS: NavSection[] = [
  {
    label: 'Tasks',
    links: [
      { label: 'Clients', href: '/tasks/clients', icon: () => <Handshake size={15} /> },
      { label: 'All', href: '/tasks/all', icon: () => <LayoutGrid size={15} /> },
      { label: 'Personal', href: '/tasks/personal', icon: () => <User size={15} /> },
      { label: 'Business', href: '/tasks/business', icon: () => <Briefcase size={15} /> },
      { label: 'Crypto world', href: '/tasks/crypto', icon: () => <Bitcoin size={15} /> },
      { label: 'Upcoming', href: '/tasks/upcoming', icon: () => <CalendarClock size={15} /> },
      { label: 'Calendar', href: '/tasks/calendar', icon: () => <CalendarRange size={15} /> },
      { label: 'No date', href: '/tasks/no-date', icon: () => <CalendarOff size={15} /> },
      { label: 'Completed', href: '/tasks/completed', icon: () => <CheckCircle2 size={15} /> },
    ],
  },
  {
    label: 'Projects',
    links: [
      { label: 'All', href: '/projects/all', icon: () => <FolderKanban size={15} /> },
      { label: 'Canvas', href: '/projects/canvas', icon: () => <Columns3 size={15} /> },
      { label: 'Active', href: '/projects/active', icon: () => <CircleDashed size={15} /> },
      { label: 'Startups', href: '/projects/startups', icon: () => <Rocket size={15} /> },
    ],
  },
];

const AI_LINK: NavLink = { label: 'AI', href: '/ai', icon: () => <Sparkles size={15} /> };
const PEOPLE_LINK: NavLink = { label: 'People', href: '/people', icon: () => <Users size={15} /> };
const SETTINGS_LINK: NavLink = { label: 'Settings', href: '/settings', icon: () => <Settings size={15} /> };
const FOOTER_LINKS: NavLink[] = [{ label: 'Donate', href: '/donate', icon: () => <Coins size={15} /> }, SETTINGS_LINK];

export function Sidebar(props: {
  /** Slide-over mode: called after a link is chosen so the panel can close. Absent when docked. */
  onNavigate?: () => void;
  /** Desktop: is the sidebar docked (pinned) right now? */
  pinned?: boolean;
  /** Desktop: pin / unpin control. Absent on phones, where docking makes no sense. */
  onTogglePin?: () => void;
}): JSX.Element {
  const location = useLocation();
  const isActive = (href: string) => location.pathname === href || location.pathname.startsWith(`${href}/`);
  // Who has handed me work: one "From <name>" link each, only while they have given me something.
  const delegators = createQuery(() => 'people:delegators', () => peopleApi.delegators(), { staleMs: 10_000 });
  const sections = (): NavSection[] => {
    const out = authStore.isAssistant() ? [...ASSISTANT_SECTIONS] : [...SECTIONS];
    const from = (delegators.data() ?? []).filter((row) => row.open_count + row.done_count > 0);
    if (from.length > 0) {
      out.splice(authStore.isAssistant() ? 1 : 2, 0, {
        label: 'From',
        links: from.map((row) => ({
          label: row.user.display_name,
          href: `/from/${row.user.id}`,
          icon: () => <UserCheck size={15} />,
          raw: true,
          count: row.open_count,
        })),
      });
    }
    if (authStore.isAdmin() && !authStore.isAssistant()) out.splice(from.length > 0 ? 3 : 2, 0, { links: [PEOPLE_LINK] });
    return out;
  };
  const footerLinks = () => {
    if (authStore.isAssistant()) return [SETTINGS_LINK];
    return authStore.isAdmin() ? [AI_LINK, ...FOOTER_LINKS] : FOOTER_LINKS;
  };

  return (
    <aside class={styles.sidebar} aria-label={t('Main navigation')}>
      <div class={styles.brand}>
        <A href="/dashboard" class={styles.brandLink} onClick={props.onNavigate} aria-label={t('MyTasker - Dashboard')}>
          <Logo size={22} />
        </A>
        <div class={styles.brandActions}>
          <Show when={props.onTogglePin}>
            <button
              type="button"
              class={[styles.closeBtn, props.pinned ? styles.pinActive : ''].filter(Boolean).join(' ')}
              onClick={props.onTogglePin}
              aria-pressed={props.pinned}
              aria-label={props.pinned ? t('Unpin sidebar') : t('Pin sidebar')}
              title={props.pinned ? t('Unpin sidebar - it slides over again') : t('Pin sidebar - keep it open')}
            >
              <Show when={props.pinned} fallback={<Pin size={15} />}>
                <PinOff size={15} />
              </Show>
            </button>
          </Show>
          <Show when={props.onNavigate}>
            <button type="button" class={styles.closeBtn} onClick={props.onNavigate} aria-label={t('Close navigation')}>
              <X size={16} />
            </button>
          </Show>
        </div>
      </div>

      <nav class={styles.nav}>
        <Show when={authStore.isAssistant() && authStore.principal()}>
          {(principal) => (
            <p class={styles.sectionLabel} title={t('You are adding tasks on behalf of {name}', { name: principal().display_name })}>
              {t('Assistant of {name}', { name: principal().display_name })}
            </p>
          )}
        </Show>
        <For each={sections()}>
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
                    <span class={styles.linkLabel}>{link.raw ? link.label : t(link.label)}</span>
                    <Show when={link.count}>
                      <span class={styles.linkCount}>{link.count}</span>
                    </Show>
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
            <Show
              when={link.label === 'AI'}
              fallback={
                <A
                  href={link.href}
                  class={[styles.link, isActive(link.href) ? styles.linkActive : ''].filter(Boolean).join(' ')}
                  onClick={props.onNavigate}
                >
                  <span class={styles.linkIcon}>{link.icon()}</span>
                  <span class={styles.linkLabel}>{t(link.label)}</span>
                </A>
              }
            >
              <button
                type="button"
                class={styles.link}
                onClick={() => {
                  props.onNavigate?.();
                  uiStore.openAI();
                }}
              >
                <span class={styles.linkIcon}>{link.icon()}</span>
                <span class={styles.linkLabel}>{t(link.label)}</span>
              </button>
            </Show>
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
