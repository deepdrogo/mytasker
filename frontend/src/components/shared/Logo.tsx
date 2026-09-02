// MyTasker — logo mark and wordmark. One path, every size.
// Built by drogoz · https://github.com/deepdrogo/mytasker

import type { JSX } from 'solid-js';
import { Show, splitProps } from 'solid-js';
import styles from './Logo.module.css';

/**
 * MyTasker mark: an "M" whose last stroke resolves into a checkmark - one continuous line.
 * Geometry lives in a 64x64 box; all sizes scale from it so the favicon and the hero share one shape.
 */
const MARK_PATH = 'M14 48V18L31 37L53 13';

interface LogoMarkProps extends JSX.SvgSVGAttributes<SVGSVGElement> {
  size?: number;
  /** `tile` draws the rounded plate behind the stroke; `glyph` is just the stroke in currentColor. */
  variant?: 'tile' | 'glyph';
}

export function LogoMark(props: LogoMarkProps): JSX.Element {
  const [local, rest] = splitProps(props, ['size', 'variant', 'class']);
  const size = () => local.size ?? 24;
  const variant = () => local.variant ?? 'tile';
  const id = `mt-logo-${Math.random().toString(36).slice(2, 8)}`;

  return (
    <svg
      width={size()}
      height={size()}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      class={[styles.mark, local.class].filter(Boolean).join(' ')}
      aria-hidden="true"
      {...rest}
    >
      <Show when={variant() === 'tile'}>
        <defs>
          <linearGradient id={`${id}-plate`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#3a3a3a" />
            <stop offset="0.55" stop-color="#141414" />
            <stop offset="1" stop-color="#060606" />
          </linearGradient>
          <linearGradient id={`${id}-rim`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#ffffff" stop-opacity="0.6" />
            <stop offset="0.5" stop-color="#ffffff" stop-opacity="0.14" />
            <stop offset="1" stop-color="#ffffff" stop-opacity="0.05" />
          </linearGradient>
          <linearGradient id={`${id}-ink`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#ffffff" />
            <stop offset="1" stop-color="#bdbdbd" />
          </linearGradient>
          <radialGradient id={`${id}-sheen`} cx="0.3" cy="0" r="0.9">
            <stop offset="0" stop-color="#ffffff" stop-opacity="0.16" />
            <stop offset="1" stop-color="#ffffff" stop-opacity="0" />
          </radialGradient>
        </defs>
        <rect x="1" y="1" width="62" height="62" rx="17" fill={`url(#${id}-plate)`} />
        <rect x="1" y="1" width="62" height="62" rx="17" fill={`url(#${id}-sheen)`} />
        <rect x="1.5" y="1.5" width="61" height="61" rx="16.5" stroke={`url(#${id}-rim)`} stroke-width="1.2" />
        <path
          d={MARK_PATH}
          stroke={`url(#${id}-ink)`}
          stroke-width="8.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </Show>
      <Show when={variant() === 'glyph'}>
        <path d={MARK_PATH} stroke="currentColor" stroke-width="8.5" stroke-linecap="round" stroke-linejoin="round" />
      </Show>
    </svg>
  );
}

interface LogoProps {
  size?: number;
  /** Hide the wordmark and show only the tile. */
  markOnly?: boolean;
  class?: string;
}

/** Mark + "MyTasker" wordmark, vertically centred. */
export function Logo(props: LogoProps): JSX.Element {
  const size = () => props.size ?? 24;
  return (
    <span class={[styles.logo, props.class].filter(Boolean).join(' ')} style={{ '--logo-size': `${size()}px` }}>
      <LogoMark size={size()} />
      <Show when={!props.markOnly}>
        <span class={styles.word}>
          My<span class={styles.wordAccent}>Tasker</span>
        </span>
      </Show>
    </span>
  );
}
