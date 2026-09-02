import { X } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { createEffect, onCleanup, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { trapFocus } from './Modal';
import styles from './Drawer.module.css';

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  side?: 'right' | 'left';
  width?: string;
  footer?: JSX.Element;
  children: JSX.Element;
}

/**
 * Side panel on desktop, bottom sheet on mobile. Used for task details, share settings,
 * notification center and project side panels.
 */
export function Drawer(props: DrawerProps): JSX.Element {
  let panel: HTMLDivElement | undefined;

  createEffect(() => {
    if (!props.open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        props.onClose();
      }
      if (event.key === 'Tab' && panel) trapFocus(event, panel);
    };
    document.addEventListener('keydown', onKey, true);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    onCleanup(() => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = previous;
    });
  });

  return (
    <Show when={props.open}>
      <Portal>
        <div
          class={styles.backdrop}
          onClick={(event) => event.target === event.currentTarget && props.onClose()}
        >
          <div
            ref={panel}
            class={[styles.panel, props.side === 'left' ? styles.left : styles.right].join(' ')}
            style={props.width ? { '--drawer-w': props.width } : undefined}
            role="dialog"
            aria-modal="true"
            aria-label={props.title}
          >
            <Show when={props.title}>
              <header class={styles.header}>
                <h2 class={styles.title}>{props.title}</h2>
                <button class={styles.close} onClick={props.onClose} aria-label="Close">
                  <X size={15} />
                </button>
              </header>
            </Show>
            <div class={styles.body}>{props.children}</div>
            <Show when={props.footer}>
              <footer class={styles.footer}>{props.footer}</footer>
            </Show>
          </div>
        </div>
      </Portal>
    </Show>
  );
}
