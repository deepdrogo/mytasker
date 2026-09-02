import { ChevronLeft, ChevronRight } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import { Page } from '~/components/shared/Page';
import { Button } from '~/components/ui/Button';
import { ErrorNote, Skeleton } from '~/components/ui/Feedback';
import styles from './InsightsPage.module.css';

export const INSIGHTS_TABS = [
  { label: 'Daily', href: '/insights/daily' },
  { label: 'Weekly', href: '/insights/weekly' },
  { label: 'Monthly', href: '/insights/monthly' },
  { label: 'Time', href: '/insights/time' },
];

interface InsightsPageProps {
  title: string;
  periodLabel: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  nextDisabled?: boolean;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  actions?: JSX.Element;
  children: JSX.Element;
}

export function InsightsPage(props: InsightsPageProps): JSX.Element {
  return (
    <Page
      title={props.title}
      tabs={INSIGHTS_TABS}
      toolbar={
        <div class={styles.toolbar}>
          <div class={styles.nav}>
            <Button variant="ghost" size="sm" onClick={props.onPrev} aria-label="Previous">
              <ChevronLeft size={14} />
            </Button>
            <span class={styles.period}>{props.periodLabel}</span>
            <Button variant="ghost" size="sm" onClick={props.onNext} disabled={props.nextDisabled} aria-label="Next">
              <ChevronRight size={14} />
            </Button>
            <Button variant="ghost" size="sm" onClick={props.onToday}>
              Today
            </Button>
          </div>
          {props.actions}
        </div>
      }
    >
      <Show when={!props.error} fallback={<ErrorNote message="Could not load insights." onRetry={props.onRetry} />}>
        <Show when={!props.loading} fallback={<Skeleton rows={6} height={48} />}>
          <div class={styles.content}>{props.children}</div>
        </Show>
      </Show>
    </Page>
  );
}

export function Block(props: { title: string; hint?: string; children: JSX.Element }): JSX.Element {
  return (
    <section class={styles.block}>
      <header class={styles.blockHead}>
        <h2>{props.title}</h2>
        <Show when={props.hint}>
          <span>{props.hint}</span>
        </Show>
      </header>
      {props.children}
    </section>
  );
}

export function StatGrid(props: { children: JSX.Element }): JSX.Element {
  return <div class={styles.statGrid}>{props.children}</div>;
}

export function TwoCol(props: { children: JSX.Element }): JSX.Element {
  return <div class={styles.twoCol}>{props.children}</div>;
}

export const minutesFmt = (m: number): string => {
  const h = Math.floor(m / 60);
  const mm = Math.round(m % 60);
  return h ? `${h}h ${mm ? `${mm}m` : ''}`.trim() : `${mm}m`;
};

export const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function shortDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  return WEEKDAY_SHORT[(date.getDay() + 6) % 7] ?? '';
}

export function longDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
}

export function shortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function monthLabel(iso: string): string {
  const [y, m] = iso.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}
