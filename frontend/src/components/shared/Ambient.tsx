// MyTasker — the ambient backdrop behind every screen: blurred monochrome scenes that cross-fade slowly.
// The images live in /public/ambient (never in the bundle). Cards are translucent over it, so they read as
// frosted glass without paying for backdrop-filter.

import type { JSX } from 'solid-js';
import { onCleanup, onMount } from 'solid-js';
import styles from './Ambient.module.css';

const SCENES = ['/ambient/scene-1.webp', '/ambient/scene-2.webp', '/ambient/scene-3.webp', '/ambient/scene-4.webp'];
const INTERVAL_MS = 45_000;

/** Low-effects mode (weak device, Save-Data, user choice) and reduced motion keep a single still scene. */
function still(): boolean {
  return (
    document.documentElement.dataset.fx === 'low' ||
    (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)
  );
}

export function Ambient(): JSX.Element {
  let first!: HTMLImageElement;
  let second!: HTMLImageElement;
  // A different opening scene each hour.
  let index = new Date().getHours() % SCENES.length;
  let busy = false;

  onMount(() => {
    first.src = SCENES[index]!;
    const advance = async () => {
      if (busy || document.hidden || still()) return;
      busy = true;
      const front = first.classList.contains(styles.on!) ? first : second;
      const back = front === first ? second : first;
      const next = (index + 1) % SCENES.length;
      back.src = SCENES[next]!;
      try {
        await back.decode();
      } catch {
        busy = false;
        return;
      }
      if (!document.hidden) {
        back.classList.add(styles.on!);
        front.classList.remove(styles.on!);
        index = next;
      }
      busy = false;
    };
    const timer = window.setInterval(() => void advance(), INTERVAL_MS);
    onCleanup(() => window.clearInterval(timer));
  });

  return (
    <div class={styles.ambient} aria-hidden="true">
      <img ref={first} class={`${styles.layer} ${styles.on}`} alt="" decoding="async" fetchpriority="low" />
      <img ref={second} class={styles.layer} alt="" decoding="async" fetchpriority="low" />
      <div class={styles.veil} />
      <div class={styles.grain} />
    </div>
  );
}
