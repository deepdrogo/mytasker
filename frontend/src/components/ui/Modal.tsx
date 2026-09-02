import { X } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { createEffect, onCleanup, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import styles from './Modal.module.css';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  size?: 'sm' | 'md' | 'lg' | 'full';
  footer?: JSX.Element;
  children: JSX.Element;
  closeOnBackdrop?: boolean;
}

export function Modal(props: ModalProps): JSX.Element {
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
    const focusTimer = window.setTimeout(() => {
      panel?.querySelector<HTMLElement>('[data-autofocus], input, textarea, button')?.focus();
    }, 20);
    onCleanup(() => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = previous;
      window.clearTimeout(focusTimer);
    });
  });

  return (
    <Show when={props.open}>
      <Portal>
        <div
          class={styles.backdrop}
          onClick={(event) => {
            if (event.target === event.currentTarget && props.closeOnBackdrop !== false) props.onClose();
          }}
        >
          <div
            ref={panel}
            class={[styles.panel, styles[props.size ?? 'md']].join(' ')}
            role="dialog"
            aria-modal="true"
            aria-label={props.title}
          >
            <Show when={props.title}>
              <header class={styles.header}>
                <div class={styles.titleWrap}>
                  <h2 class={styles.title}>{props.title}</h2>
                  <Show when={props.description}>
                    <p class={styles.description}>{props.description}</p>
                  </Show>
                </div>
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

export function trapFocus(event: KeyboardEvent, container: HTMLElement): void {
  const focusable = container.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
  );
  if (focusable.length === 0) return;
  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
