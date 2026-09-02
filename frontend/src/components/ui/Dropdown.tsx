import type { JSX } from 'solid-js';
import { createEffect, createSignal, For, onCleanup, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import styles from './Dropdown.module.css';

export interface MenuItem {
  label: string;
  icon?: JSX.Element;
  onSelect?: () => void;
  danger?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
  shortcut?: string;
  checked?: boolean;
}

interface DropdownProps {
  trigger: (api: { toggle: (event: MouseEvent) => void; open: boolean }) => JSX.Element;
  items: MenuItem[];
  align?: 'start' | 'end';
  label?: string;
}

export function Dropdown(props: DropdownProps): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const [pos, setPos] = createSignal({ x: 0, y: 0, alignEnd: false });
  let menu: HTMLDivElement | undefined;

  const toggle = (event: MouseEvent) => {
    event.stopPropagation();
    if (open()) {
      setOpen(false);
      return;
    }
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const alignEnd = props.align !== 'start';
    setPos({ x: alignEnd ? rect.right : rect.left, y: rect.bottom + 4, alignEnd });
    setOpen(true);
  };

  createEffect(() => {
    if (!open()) return;
    const close = (event: MouseEvent) => {
      if (menu && !menu.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onScroll = () => setOpen(false);
    window.setTimeout(() => document.addEventListener('click', close), 0);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onScroll);
    window.addEventListener('scroll', onScroll, true);
    onCleanup(() => {
      document.removeEventListener('click', close);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('scroll', onScroll, true);
    });
  });

  return (
    <>
      {props.trigger({ toggle, open: open() })}
      <Show when={open()}>
        <Portal>
          <div
            ref={menu}
            class={styles.menu}
            role="menu"
            aria-label={props.label}
            style={{
              top: `${pos().y}px`,
              ...(pos().alignEnd
                ? { right: `${window.innerWidth - pos().x}px` }
                : { left: `${pos().x}px` }),
            }}
          >
            <For each={props.items}>
              {(item) => (
                <>
                  <Show when={item.separatorBefore}>
                    <div class={styles.separator} role="separator" />
                  </Show>
                  <button
                    role="menuitem"
                    class={[styles.item, item.danger ? styles.danger : ''].filter(Boolean).join(' ')}
                    disabled={item.disabled}
                    onClick={() => {
                      setOpen(false);
                      item.onSelect?.();
                    }}
                  >
                    <Show when={item.icon}>
                      <span class={styles.icon}>{item.icon}</span>
                    </Show>
                    <span class={styles.label}>{item.label}</span>
                    <Show when={item.checked}>
                      <span class={styles.check} aria-hidden="true">
                        ✓
                      </span>
                    </Show>
                    <Show when={item.shortcut}>
                      <kbd class={styles.shortcut}>{item.shortcut}</kbd>
                    </Show>
                  </button>
                </>
              )}
            </For>
          </div>
        </Portal>
      </Show>
    </>
  );
}
