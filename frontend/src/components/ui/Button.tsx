import type { JSX } from 'solid-js';
import { splitProps } from 'solid-js';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm';

interface ButtonProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  block?: boolean;
}

export function Button(props: ButtonProps): JSX.Element {
  const [local, rest] = splitProps(props, ['variant', 'size', 'loading', 'block', 'class', 'children', 'disabled']);
  return (
    <button
      {...rest}
      class={[
        styles.btn,
        styles[local.variant ?? 'secondary'],
        styles[`size-${local.size ?? 'md'}`],
        local.block ? styles.block : '',
        local.loading ? styles.loading : '',
        local.class ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      disabled={local.disabled || local.loading}
      aria-busy={local.loading ? 'true' : undefined}
    >
      {local.children}
    </button>
  );
}
