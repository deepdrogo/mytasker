// MyTasker — a project's face. Its logo (from a catalog or its website's favicon) when there is one; otherwise
// a generated one that is always the same for the same project: a grey gradient, a motif and its initials.

import type { JSX } from 'solid-js';
import { Show, createSignal } from 'solid-js';
import type { Project } from '~/types';
import { cx } from '~/utils/cx';
import styles from './ProjectAvatar.module.css';

type AvatarProject = Pick<Project, 'id' | 'name'> & Partial<Pick<Project, 'icon_url'>>;

/** Georgian has no everyday capitals: upper-casing would turn ჩ into Mtavruli Ჩ, which most fonts lack. */
const upper = (text: string) => Array.from(text, (ch) => (/[\u10D0-\u10FF]/.test(ch) ? ch : ch.toUpperCase())).join('');

/** "Masting AI" → "MA", "Replika" → "RE", "LAST EXIT / Trust And Game" → "LE". */
export function initials(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return upper(Array.from(words[0]!).slice(0, 2).join(''));
  return upper(Array.from(words[0]!)[0]! + Array.from(words[1]!)[0]!);
}

/** Small stable hash so the motif does not follow the hue. */
export function seed(id: number, name: string): number {
  let h = id * 2654435761;
  for (const ch of name) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return Math.abs(h);
}

const MOTIFS = 5;
let uid = 0;

export function ProjectAvatar(props: { project: AvatarProject; size?: number; class?: string }): JSX.Element {
  const [broken, setBroken] = createSignal(false);
  const size = () => props.size ?? 32;
  const showIcon = () => Boolean(props.project.icon_url) && !broken();

  return (
    <span
      class={cx(styles.avatar, showIcon() && styles.withIcon, props.class)}
      style={{ width: `${size()}px`, height: `${size()}px`, 'border-radius': `${Math.round(size() * 0.3)}px` }}
      aria-hidden="true"
    >
      <Show when={showIcon()} fallback={<Generated project={props.project} />}>
        <img
          src={props.project.icon_url!}
          alt=""
          loading="lazy"
          decoding="async"
          width={size()}
          height={size()}
          class={styles.icon}
          onError={() => setBroken(true)}
        />
      </Show>
    </span>
  );
}

function Generated(props: { project: AvatarProject }): JSX.Element {
  const id = `pa${++uid}`;
  const hash = () => seed(props.project.id, props.project.name);
  const motif = () => hash() % MOTIFS;
  // Monochrome, like the rest of the app: projects differ by shade, light direction, motif and initials.
  const top = () => 20 + (Math.floor(hash() / MOTIFS) % 5) * 4;
  const flip = () => Math.floor(hash() / 25) % 2 === 1;
  const text = () => initials(props.project.name);
  return (
    <svg viewBox="0 0 64 64" class={styles.svg}>
      <defs>
        <linearGradient id={`${id}g`} x1={flip() ? '1' : '0'} y1="0" x2={flip() ? '0' : '1'} y2="1">
          <stop offset="0" stop-color={`hsl(0 0% ${top()}%)`} />
          <stop offset="1" stop-color="hsl(0 0% 6%)" />
        </linearGradient>
        <radialGradient id={`${id}l`} cx="0.25" cy="0.1" r="0.9">
          <stop offset="0" stop-color="#fff" stop-opacity="0.35" />
          <stop offset="0.6" stop-color="#fff" stop-opacity="0" />
        </radialGradient>
      </defs>
      <rect width="64" height="64" fill={`url(#${id}g)`} />
      <g fill="none" stroke="#fff" stroke-opacity="0.14" stroke-width="3">
        <Show when={motif() === 0}>
          <circle cx="54" cy="56" r="22" />
          <circle cx="54" cy="56" r="12" />
        </Show>
        <Show when={motif() === 1}>
          <path d="M-8 52 L28 16 M8 72 L56 24 M28 80 L76 32" />
        </Show>
        <Show when={motif() === 2}>
          <rect x="34" y="-6" width="36" height="36" rx="8" transform="rotate(18 52 12)" />
        </Show>
        <Show when={motif() === 3}>
          <path d="M-4 48 Q16 34 32 48 T68 48" />
          <path d="M-4 60 Q16 46 32 60 T68 60" />
        </Show>
        <Show when={motif() === 4}>
          <polygon points="50,4 66,32 34,32" />
          <circle cx="12" cy="56" r="9" />
        </Show>
      </g>
      <rect width="64" height="64" fill={`url(#${id}l)`} />
      <text
        x="32"
        y="33"
        text-anchor="middle"
        dominant-baseline="central"
        class={styles.initials}
        font-size={text().length > 1 ? '24' : '30'}
      >
        {text()}
      </text>
    </svg>
  );
}
