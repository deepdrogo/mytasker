import { A, useLocation } from '@solidjs/router';
import type { JSX } from 'solid-js';
import { For, Show } from 'solid-js';
import styles from './Page.module.css';

interface PageProps {
  title: string;
  subtitle?: string;
  actions?: JSX.Element;
  tabs?: Array<{ label: string; href: string; count?: number }>;
  toolbar?: JSX.Element;
  children: JSX.Element;
  /** Content scrolls internally (default). Set false for pages managing their own layout. */
  scroll?: boolean;
}

export function Page(props: PageProps): JSX.Element {
  const location = useLocation();
  return (
    <div class={styles.page}>
      <header class={styles.header}>
        <div class={styles.headRow}>
          <div class={styles.titleBlock}>
            <h1 class={styles.title}>{props.title}</h1>
            <Show when={props.subtitle}>
              <p class={styles.subtitle}>{props.subtitle}</p>
            </Show>
          </div>
          <Show when={props.actions}>
            <div class={styles.actions}>{props.actions}</div>
          </Show>
        </div>

        <Show when={props.tabs?.length}>
          <nav class={styles.tabs} aria-label="Section">
            <For each={props.tabs}>
              {(tab) => (
                <A
                  href={tab.href}
                  class={[styles.tab, location.pathname === tab.href ? styles.tabActive : ''].filter(Boolean).join(' ')}
                >
                  {tab.label}
                  <Show when={tab.count !== undefined}>
                    <span class={styles.tabCount}>{tab.count}</span>
                  </Show>
                </A>
              )}
            </For>
          </nav>
        </Show>

        <Show when={props.toolbar}>
          <div class={styles.toolbar}>{props.toolbar}</div>
        </Show>
      </header>

      <div class={props.scroll === false ? styles.bodyStatic : styles.body}>{props.children}</div>
    </div>
  );
}

export function PageSection(props: {
  title?: string;
  action?: JSX.Element;
  children: JSX.Element;
  dense?: boolean;
}): JSX.Element {
  return (
    <section class={[styles.section, props.dense ? styles.sectionDense : ''].filter(Boolean).join(' ')}>
      <Show when={props.title || props.action}>
        <div class={styles.sectionHead}>
          <Show when={props.title}>
            <h2 class={styles.sectionTitle}>{props.title}</h2>
          </Show>
          <Show when={props.action}>
            <div class={styles.sectionAction}>{props.action}</div>
          </Show>
        </div>
      </Show>
      {props.children}
    </section>
  );
}

export function Card(props: { children: JSX.Element; class?: string; padded?: boolean }): JSX.Element {
  return (
    <div class={[styles.card, props.padded === false ? '' : styles.cardPadded, props.class ?? ''].filter(Boolean).join(' ')}>
      {props.children}
    </div>
  );
}
