/**
 * Monochrome state indicators.
 * Meaning is carried by icon, border weight, opacity and text - never by hue.
 */

import { AlertTriangle, ChevronsUp, Minus, MoveDown, MoveUp } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import type { Priority, Source, Visibility } from '~/types';
import { percent } from '~/utils/format';
import styles from './Indicators.module.css';

const PRIORITY_META: Record<Priority, { label: string; icon: () => JSX.Element; className: string }> = {
  critical: { label: 'Critical', icon: () => <ChevronsUp size={12} />, className: 'critical' },
  high: { label: 'High', icon: () => <MoveUp size={12} />, className: 'high' },
  normal: { label: 'Normal', icon: () => <Minus size={12} />, className: 'normal' },
  low: { label: 'Low', icon: () => <MoveDown size={12} />, className: 'low' },
};

export function PriorityMark(props: { priority: Priority; withLabel?: boolean }): JSX.Element {
  const meta = () => PRIORITY_META[props.priority];
  return (
    <span
      class={[styles.priority, styles[meta().className]].join(' ')}
      title={`${meta().label} priority`}
      aria-label={`${meta().label} priority`}
    >
      {meta().icon()}
      <Show when={props.withLabel}>
        <span>{meta().label}</span>
      </Show>
    </span>
  );
}

export function Badge(props: {
  children: JSX.Element;
  variant?: 'default' | 'outline' | 'solid' | 'dashed';
  title?: string;
}): JSX.Element {
  return (
    <span class={[styles.badge, styles[`badge-${props.variant ?? 'default'}`]].join(' ')} title={props.title}>
      {props.children}
    </span>
  );
}

export function OverdueMark(props: { withLabel?: boolean }): JSX.Element {
  return (
    <span class={styles.overdue} title="Overdue">
      <AlertTriangle size={12} />
      <Show when={props.withLabel}>
        <span>Overdue</span>
      </Show>
    </span>
  );
}

export function VisibilityMark(props: { visibility: Visibility; mode?: string }): JSX.Element {
  return (
    <Show when={props.visibility === 'private'}>
      <Badge variant="dashed" title="Private - visible only to you">
        Private
      </Badge>
    </Show>
  );
}

const SOURCE_LABEL: Record<Source, string> = {
  web: 'Web',
  mobile_web: 'Mobile',
  telegram: 'Telegram',
  team: 'Team',
  share_link: 'Share link',
  ai_web: 'AI',
  ai_telegram: 'AI · Telegram',
  system: 'System',
};

export function SourceLabel(props: { source: Source | '' }): JSX.Element {
  return <Show when={props.source}>{(s) => <span class={styles.source}>{SOURCE_LABEL[s() as Source] ?? s()}</span>}</Show>;
}

export function ProgressBar(props: { value: number; max?: number; label?: string }): JSX.Element {
  const pct = () => percent(props.value, props.max ?? 100);
  return (
    <div
      class={styles.progress}
      role="progressbar"
      aria-valuenow={pct()}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={props.label ?? 'Progress'}
    >
      <div class={styles.progressFill} style={{ width: `${pct()}%` }} />
    </div>
  );
}

export function Dot(): JSX.Element {
  return (
    <span class={styles.dot} aria-hidden="true">
      ·
    </span>
  );
}

export function Meta(props: { children: JSX.Element }): JSX.Element {
  return <span class={styles.meta}>{props.children}</span>;
}
