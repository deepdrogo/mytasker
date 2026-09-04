import { A, useNavigate, useParams } from '@solidjs/router';
import type { JSX } from 'solid-js';
import { Show, Suspense, lazy } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { Page } from '~/components/shared/Page';
import { Skeleton } from '~/components/ui/Feedback';
import { t } from '~/i18n';
import { authStore } from '~/stores/auth';
import { cx } from '~/utils/cx';
import styles from './Settings.module.css';

const ALL_SECTIONS = [
  { id: 'profile', label: 'Profile', component: lazy(() => import('~/routes/settings/ProfileSection')) },
  { id: 'preferences', label: 'Preferences', component: lazy(() => import('~/routes/settings/PreferencesSection')) },
  { id: 'notifications', label: 'Notifications', component: lazy(() => import('~/routes/settings/NotificationsSection')) },
  { id: 'telegram', label: 'Telegram', component: lazy(() => import('~/routes/settings/TelegramSection')) },
  { id: 'assistants', label: 'Assistants', component: lazy(() => import('~/routes/settings/AssistantsSection')) },
  { id: 'sharing', label: 'Sharing', component: lazy(() => import('~/routes/settings/SharingSection')) },
  { id: 'security', label: 'Security', component: lazy(() => import('~/routes/settings/SecuritySection')) },
] as const;

type SectionId = (typeof ALL_SECTIONS)[number]['id'];

/** Assistant accounts only get profile (name, language, timezone); everything else is the principal's. */
const ASSISTANT_SECTIONS: readonly SectionId[] = ['profile'];

export default function Settings(): JSX.Element {
  const params = useParams<{ section?: string }>();
  const navigate = useNavigate();
  const SECTIONS = () => (authStore.isAssistant() ? ALL_SECTIONS.filter((s) => ASSISTANT_SECTIONS.includes(s.id)) : ALL_SECTIONS);
  const current = (): SectionId => {
    const raw = (params.section ?? '').split('/')[0] as SectionId;
    return SECTIONS().some((s) => s.id === raw) ? raw : 'profile';
  };
  const section = () => SECTIONS().find((s) => s.id === current()) ?? ALL_SECTIONS[0];

  return (
    <Page title={t('Settings')}>
      <div class={styles.layout}>
        <nav class={styles.nav} aria-label={t('Settings sections')}>
          <select class={styles.mobileNav} value={current()} onChange={(e) => navigate(`/settings/${e.currentTarget.value}`)}>
            {SECTIONS().map((s) => (
              <option value={s.id}>{t(s.label)}</option>
            ))}
          </select>
          <ul class={styles.navList}>
            {SECTIONS().map((s) => (
              <li>
                <A href={`/settings/${s.id}`} class={cx(styles.navLink, current() === s.id && styles.navActive)}>
                  {t(s.label)}
                </A>
              </li>
            ))}
          </ul>
        </nav>
        <div class={styles.content}>
          <Suspense fallback={<Skeleton rows={5} height={40} />}>
            <Show when={section()} keyed>
              {(s) => <Dynamic component={s.component} />}
            </Show>
          </Suspense>
        </div>
      </div>
    </Page>
  );
}
