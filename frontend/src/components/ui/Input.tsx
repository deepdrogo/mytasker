import type { JSX } from 'solid-js';
import { Show, createEffect, splitProps } from 'solid-js';
import styles from './Input.module.css';

interface FieldProps {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  id?: string;
  children: JSX.Element;
}

let uid = 0;
export function nextId(prefix = 'f'): string {
  return `${prefix}-${++uid}`;
}

export function Field(props: FieldProps): JSX.Element {
  return (
    <div class={styles.field}>
      <Show when={props.label}>
        <label class={styles.label} for={props.id}>
          {props.label}
          <Show when={props.required}>
            <span aria-hidden="true" class={styles.req}>
              *
            </span>
          </Show>
        </label>
      </Show>
      {props.children}
      <Show when={props.error}>
        <p class={styles.error} role="alert">
          {props.error}
        </p>
      </Show>
      <Show when={props.hint && !props.error}>
        <p class={styles.hint}>{props.hint}</p>
      </Show>
    </div>
  );
}

interface InputProps extends JSX.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  sizeVariant?: 'sm' | 'md' | 'lg';
}

export function Input(props: InputProps): JSX.Element {
  const [local, rest] = splitProps(props, ['invalid', 'sizeVariant', 'class']);
  return (
    <input
      {...rest}
      class={[styles.input, styles[local.sizeVariant ?? 'md'], local.invalid ? styles.invalid : '', local.class ?? '']
        .filter(Boolean)
        .join(' ')}
      aria-invalid={local.invalid ? 'true' : undefined}
    />
  );
}

interface TextareaProps extends JSX.TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
  mono?: boolean;
}

export function Textarea(props: TextareaProps): JSX.Element {
  const [local, rest] = splitProps(props, ['invalid', 'mono', 'class']);
  return (
    <textarea
      {...rest}
      class={[styles.textarea, local.mono ? styles.monoText : '', local.invalid ? styles.invalid : '', local.class ?? '']
        .filter(Boolean)
        .join(' ')}
      aria-invalid={local.invalid ? 'true' : undefined}
    />
  );
}

interface SelectProps extends JSX.SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
  sizeVariant?: 'sm' | 'md';
}

export function Select(props: SelectProps): JSX.Element {
  const [local, rest] = splitProps(props, ['invalid', 'sizeVariant', 'class', 'children', 'ref']);
  let el: HTMLSelectElement | undefined;
  // Spread props land before the <option>s exist, so a controlled `value` would be dropped by the browser.
  // Re-apply it once the children are in place (and whenever it changes).
  createEffect(() => {
    const value = rest.value;
    if (el && value !== undefined && value !== null) el.value = String(value);
  });
  return (
    <select
      {...rest}
      ref={(node) => {
        el = node;
        if (typeof local.ref === 'function') local.ref(node);
      }}
      class={[styles.select, styles[local.sizeVariant ?? 'md'], local.invalid ? styles.invalid : '', local.class ?? '']
        .filter(Boolean)
        .join(' ')}
    >
      {local.children}
    </select>
  );
}

interface CheckboxProps extends Omit<JSX.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string;
}

export function Checkbox(props: CheckboxProps): JSX.Element {
  const [local, rest] = splitProps(props, ['label', 'class']);
  return (
    <label class={[styles.checkboxWrap, local.class ?? ''].filter(Boolean).join(' ')}>
      <input {...rest} type="checkbox" class={styles.checkbox} />
      <Show when={local.label}>
        <span>{local.label}</span>
      </Show>
    </label>
  );
}
