import type { JSX } from 'solid-js';
import { For, Show } from 'solid-js';
import { t } from '~/i18n';
import { cx } from '~/utils/cx';
import styles from './Charts.module.css';

export interface BarDatum {
  label: string;
  value: number;
  /** Optional secondary value drawn as a thin outline bar behind (e.g. target). */
  reference?: number;
  muted?: boolean;
  title?: string;
}

interface BarChartProps {
  data: BarDatum[];
  height?: number;
  format?: (value: number) => string;
  /** Show the value above each bar. */
  showValues?: boolean;
}

/** Pure-SVG monochrome bar chart: white fills, grey reference outlines, no color. */
export function BarChart(props: BarChartProps): JSX.Element {
  const height = () => props.height ?? 120;
  const max = () => Math.max(1, ...props.data.map((d) => Math.max(d.value, d.reference ?? 0)));
  const fmt = (v: number) => (props.format ? props.format(v) : String(v));
  const count = () => Math.max(1, props.data.length);
  const slot = () => 100 / count();
  const barW = () => slot() * 0.62;

  return (
    <div class={styles.chart}>
      <svg class={styles.svg} style={{ height: `${height()}px` }} viewBox={`0 0 100 ${height()}`} preserveAspectRatio="none" aria-hidden="true">
        <line x1="0" y1={height() - 0.5} x2="100" y2={height() - 0.5} class={styles.axis} vector-effect="non-scaling-stroke" />
        <For each={props.data}>
          {(d, i) => {
            const x = () => i() * slot() + (slot() - barW()) / 2;
            const h = () => (d.value / max()) * (height() - 4);
            const refH = () => ((d.reference ?? 0) / max()) * (height() - 4);
            return (
              <g>
                <Show when={d.reference !== undefined}>
                  <rect x={x()} y={height() - refH()} width={barW()} height={refH()} class={styles.reference} vector-effect="non-scaling-stroke" />
                </Show>
                <rect x={x()} y={height() - h()} width={barW()} height={h()} class={cx(styles.bar, d.muted && styles.barMuted)}>
                  <title>{d.title ?? `${d.label}: ${fmt(d.value)}`}</title>
                </rect>
              </g>
            );
          }}
        </For>
      </svg>
      <Show when={props.showValues}>
        <div class={styles.values}>
          <For each={props.data}>{(d) => <span style={{ width: `${slot()}%` }}>{d.value ? fmt(d.value) : ''}</span>}</For>
        </div>
      </Show>
      <div class={styles.labels}>
        <For each={props.data}>
          {(d) => (
            <span style={{ width: `${slot()}%` }} class={cx(d.muted && styles.labelMuted)}>
              {d.label}
            </span>
          )}
        </For>
      </div>
    </div>
  );
}

interface SparklineProps {
  values: number[];
  height?: number;
}

/** Thin line for trends; used inside stat cards. */
export function Sparkline(props: SparklineProps): JSX.Element {
  const height = () => props.height ?? 28;
  const points = () => {
    const vals = props.values;
    if (vals.length < 2) return '';
    const max = Math.max(1, ...vals);
    const step = 100 / (vals.length - 1);
    return vals.map((v, i) => `${i * step},${height() - (v / max) * (height() - 2) - 1}`).join(' ');
  };
  return (
    <svg class={styles.spark} style={{ height: `${height()}px` }} viewBox={`0 0 100 ${height()}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points()} class={styles.sparkLine} vector-effect="non-scaling-stroke" />
    </svg>
  );
}

interface StatProps {
  label: string;
  value: string;
  delta?: number | null;
  deltaFormat?: (d: number) => string;
  invertDelta?: boolean;
  spark?: number[];
}

/** Metric tile with an optional signed delta against the previous period. */
export function Stat(props: StatProps): JSX.Element {
  const deltaText = () => {
    const d = props.delta;
    if (d === null || d === undefined || d === 0) return d === 0 ? '±0' : '';
    const text = props.deltaFormat ? props.deltaFormat(Math.abs(d)) : String(Math.abs(d));
    return `${d > 0 ? '+' : '−'}${text}`;
  };
  const good = () => {
    const d = props.delta ?? 0;
    return props.invertDelta ? d < 0 : d > 0;
  };
  return (
    <div class={styles.stat}>
      <span class={styles.statLabel}>{props.label}</span>
      <span class={styles.statValue}>{props.value}</span>
      <Show when={deltaText()}>
        <span class={cx(styles.statDelta, good() && styles.statDeltaGood)}>{t('{delta} vs previous', { delta: deltaText() })}</span>
      </Show>
      <Show when={props.spark && props.spark.length > 1}>
        <Sparkline values={props.spark ?? []} />
      </Show>
    </div>
  );
}

interface MeterProps {
  label: string;
  value: number;
  max: number;
  format?: (v: number) => string;
}

/** Horizontal fill meter for progress-vs-target. */
export function Meter(props: MeterProps): JSX.Element {
  const pct = () => (props.max > 0 ? Math.min(100, Math.round((props.value / props.max) * 100)) : 0);
  const fmt = (v: number) => (props.format ? props.format(v) : String(v));
  return (
    <div class={styles.meter}>
      <div class={styles.meterHead}>
        <span>{props.label}</span>
        <span class={styles.mono}>
          {fmt(props.value)} / {fmt(props.max)} · {pct()}%
        </span>
      </div>
      <div class={styles.meterTrack} role="progressbar" aria-valuenow={pct()} aria-valuemin={0} aria-valuemax={100}>
        <div class={styles.meterFill} style={{ width: `${pct()}%` }} />
      </div>
    </div>
  );
}

interface BreakdownProps {
  rows: Array<{ label: string; value: number }>;
  format?: (v: number) => string;
  emptyText?: string;
}

/** Ranked horizontal bars (e.g. minutes by project). */
export function Breakdown(props: BreakdownProps): JSX.Element {
  const max = () => Math.max(1, ...props.rows.map((r) => r.value));
  const fmt = (v: number) => (props.format ? props.format(v) : String(v));
  return (
    <Show when={props.rows.length > 0} fallback={<p class={styles.empty}>{props.emptyText ?? t('No data.')}</p>}>
      <ul class={styles.breakdown}>
        <For each={props.rows}>
          {(r) => (
            <li class={styles.breakdownRow}>
              <span class={styles.breakdownLabel}>{r.label}</span>
              <span class={styles.breakdownTrack}>
                <span class={styles.breakdownFill} style={{ width: `${(r.value / max()) * 100}%` }} />
              </span>
              <span class={styles.mono}>{fmt(r.value)}</span>
            </li>
          )}
        </For>
      </ul>
    </Show>
  );
}
