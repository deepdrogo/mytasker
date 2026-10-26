import { A, useLocation } from '@solidjs/router';
import {
  Archive,
  Bitcoin,
  BookText,
  Briefcase,
  CalendarClock,
  CalendarOff,
  CalendarRange,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  CircleDot,
  Columns3,
  Coins,
  FolderKanban,
  Handshake,
  LayoutDashboard,
  LayoutGrid,
  Lightbulb,
  ListChecks,
  PenLine,
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
import { createSignal, For, Show } from 'solid-js';
import { homeRoute, prefersProjectsHome } from '~/app/home';
import { LanguageSwitch } from '~/components/shared/LanguageSwitch';
import { Logo } from '~/components/shared/Logo';
import { peopleApi } from '~/features/people/api';
import { assistantsApi } from '~/features/settings/api';
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
      { label: 'Archive', href: '/tasks/archive', icon: () => <Archive size={15} /> },
    ],
  },
  {
    label: 'Projects',
    links: [
      { label: 'Working', href: '/projects/working', icon: () => <CircleDot size={15} /> },
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
      { label: 'Working', href: '/projects/working', icon: () => <CircleDot size={15} /> },
      { label: 'All', href: '/projects/all', icon: () => <FolderKanban size={15} /> },
      { label: 'Canvas', href: '/projects/canvas', icon: () => <Columns3 size={15} /> },
      { label: 'Active', href: '/projects/active', icon: () => <CircleDashed size={15} /> },
      { label: 'Startups', href: '/projects/startups', icon: () => <Rocket size={15} /> },
    ],
  },
];

const MORE_STORAGE_KEY = 'mt_nav_more_v2';

/** Projects-home: Dashboard first, then the working board. Everything else folds under More. */
const PRIMARY_SECTION: NavSection = {
  links: [
    { label: 'Dashboard', href: '/dashboard', icon: () => <LayoutDashboard size={15} /> },
    { label: 'Working', href: '/projects/working', icon: () => <CircleDot size={15} /> },
  ],
};

const PROJECT_SECTION: NavSection = {
  label: 'Projects',
  links: [
    { label: 'All', href: '/projects/all', icon: () => <FolderKanban size={15} /> },
    { label: 'Startups', href: '/projects/startups', icon: () => <Rocket size={15} /> },
    { label: 'Ideas', href: '/projects/ideas', icon: () => <Lightbulb size={15} /> },
  ],
};

const DAY_LINKS: NavLink[] = [
  { label: 'Today', href: '/today', icon: () => <Sun size={15} /> },
  { label: 'Tomorrow', href: '/tomorrow', icon: () => <Sunrise size={15} /> },
];

const TASK_LINKS: NavLink[] = [
  { label: 'Clients', href: '/tasks/clients', icon: () => <Handshake size={15} /> },
  { label: 'All', href: '/tasks/all', icon: () => <LayoutGrid size={15} /> },
  { label: 'Personal', href: '/tasks/personal', icon: () => <User size={15} /> },
  { label: 'Business', href: '/tasks/business', icon: () => <Briefcase size={15} /> },
  { label: 'Crypto world', href: '/tasks/crypto', icon: () => <Bitcoin size={15} /> },
  { label: 'Upcoming', href: '/tasks/upcoming', icon: () => <CalendarClock size={15} /> },
  { label: 'Calendar', href: '/tasks/calendar', icon: () => <CalendarRange size={15} /> },
  { label: 'No date', href: '/tasks/no-date', icon: () => <CalendarOff size={15} /> },
  { label: 'Completed', href: '/tasks/completed', icon: () => <CheckCircle2 size={15} /> },
  { label: 'Archive', href: '/tasks/archive', icon: () => <Archive size={15} /> },
];

const MORE_PROJECT_LINKS: NavLink[] = [
  { label: 'Active', href: '/projects/active', icon: () => <CircleDashed size={15} /> },
  { label: 'Canvas', href: '/projects/canvas', icon: () => <Columns3 size={15} /> },
  { label: 'Check-ins', href: '/projects/checkins', icon: () => <ListChecks size={15} /> },
];

const ROUTINE_LINKS: NavLink[] = [
  { label: 'Personal', href: '/routine/personal', icon: () => <Repeat size={15} /> },
  { label: 'Business', href: '/routine/business', icon: () => <ListChecks size={15} /> },
  { label: 'Rules', href: '/routine/rules', icon: () => <ScrollText size={15} /> },
];

const INSIGHT_LINKS: NavLink[] = [
  { label: 'Daily', href: '/insights/daily', icon: () => <TrendingUp size={15} /> },
  { label: 'Weekly', href: '/insights/weekly', icon: () => <TrendingUp size={15} /> },
  { label: 'Monthly', href: '/insights/monthly', icon: () => <TrendingUp size={15} /> },
  { label: 'Time', href: '/insights/time', icon: () => <CalendarClock size={15} /> },
];

const PROMPT_LINK: NavLink = { label: 'Prompts', href: '/prompts', icon: () => <BookText size={15} /> };

const PRIMARY_HREFS = ['/dashboard', '/projects/working', '/projects/all', '/projects/startups', '/projects/ideas'];

function readShowMore(): boolean {
  try {
    return localStorage.getItem(MORE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

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
  // Whom I write tasks for as a linked assistant: one "For <name>" link each, while the link exists.
  const helping = createQuery(
    () => 'assistants:helping',
    () => (authStore.isAssistant() ? Promise.resolve([]) : assistantsApi.helping()),
    { staleMs: 30_000 },
  );
  const sections = (): NavSection[] => {
    const out = authStore.isAssistant() ? [...ASSISTANT_SECTIONS] : [...SECTIONS];
    let at = authStore.isAssistant() ? 1 : 2;
    const from = (delegators.data() ?? []).filter((row) => row.open_count + row.done_count > 0);
    if (from.length > 0) {
      out.splice(at, 0, {
        label: 'From',
        links: from.map((row) => ({
          label: row.user.display_name,
          href: `/from/${row.user.id}`,
          icon: () => <UserCheck size={15} />,
          raw: true,
          count: row.open_count,
        })),
      });
      at += 1;
    }
    const writingFor = helping.data() ?? [];
    if (writingFor.length > 0) {
      out.splice(at, 0, {
        label: 'Writing for',
        links: writingFor.map((row) => ({
          label: row.user.display_name,
          href: `/for/${row.user.id}`,
          icon: () => <PenLine size={15} />,
          raw: true,
          count: row.open_count,
        })),
      });
      at += 1;
    }
    if (authStore.isAdmin() && !authStore.isAssistant()) out.splice(at, 0, { links: [PEOPLE_LINK] });
    return out;
  };

  // Projects-home users (the owner) see Dashboard, then Working. More opens as labeled shelves.
  // Everyone else keeps the full, flat navigation.
  const projectsHome = () => prefersProjectsHome();
  const moreSections = (): NavSection[] => {
    if (authStore.isAssistant()) {
      return sections().filter((section) => section.label !== 'Projects');
    }
    const from = (delegators.data() ?? []).filter((row) => row.open_count + row.done_count > 0);
    const writingFor = helping.data() ?? [];
    const out: NavSection[] = [{ label: 'Day', links: DAY_LINKS }];
    if (from.length > 0) {
      out.push({
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
    out.push({ label: 'Tasks', links: TASK_LINKS });
    if (writingFor.length > 0) {
      out.push({
        label: 'Writing for',
        links: writingFor.map((row) => ({
          label: row.user.display_name,
          href: `/for/${row.user.id}`,
          icon: () => <PenLine size={15} />,
          raw: true,
          count: row.open_count,
        })),
      });
    }
    if (authStore.isAdmin()) out.push({ links: [PEOPLE_LINK] });
    out.push(
      { label: 'Projects', links: MORE_PROJECT_LINKS },
      { links: [PROMPT_LINK] },
      { label: 'Routine', links: ROUTINE_LINKS },
      { label: 'Insights', links: INSIGHT_LINKS },
    );
    return out;
  };

  const [showMore, setShowMore] = createSignal(readShowMore());
  // Keep "More" open whenever the active route lives there, so the current page is never hidden.
  const onPrimaryRoute = () =>
    location.pathname === '/' || PRIMARY_HREFS.some((href) => location.pathname === href || location.pathname.startsWith(`${href}/`));
  const moreOpen = () => showMore() || !onPrimaryRoute();
  const toggleMore = () => {
    const next = !moreOpen();
    setShowMore(next);
    try {
      localStorage.setItem(MORE_STORAGE_KEY, next ? '1' : '0');
    } catch {
      /* private mode */
    }
  };

  const renderSection = (section: NavSection): JSX.Element => (
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
  );

  const footerLinks = () => {
    if (authStore.isAssistant()) return [SETTINGS_LINK];
    return authStore.isAdmin() ? [AI_LINK, ...FOOTER_LINKS] : FOOTER_LINKS;
  };

  return (
    <aside class={styles.sidebar} aria-label={t('Main navigation')}>
      <div class={styles.brand}>
        <A href={homeRoute()} class={styles.brandLink} onClick={props.onNavigate} aria-label={t('MyTasker - Home')}>
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
        <Show when={projectsHome()} fallback={<For each={sections()}>{(section) => renderSection(section)}</For>}>
          {renderSection(PRIMARY_SECTION)}
          {renderSection(PROJECT_SECTION)}
          <button
            type="button"
            class={styles.moreToggle}
            onClick={toggleMore}
            aria-expanded={moreOpen()}
            aria-controls="sidebar-more"
          >
            <Show when={moreOpen()} fallback={<ChevronRight size={13} />}>
              <ChevronDown size={13} />
            </Show>
            <span>{t('More')}</span>
          </button>
          <Show when={moreOpen()}>
            <div id="sidebar-more" class={styles.morePanel}>
              <For each={moreSections()}>{(section) => renderSection(section)}</For>
            </div>
          </Show>
        </Show>
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
