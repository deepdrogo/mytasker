import type { JSX } from 'solid-js';
import { For, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { t } from '~/i18n';
import { dismissToast, uiStore } from '~/stores/ui';
import { Button } from './Button';
import { Modal } from './Modal';
import styles from './Feedback.module.css';

/* ---------------------------------------------------------------- Skeleton */

interface SkeletonProps {
  rows?: number;
  height?: number;
  gap?: number;
  class?: string;
}

export function Skeleton(props: SkeletonProps): JSX.Element {
  return (
    <div
      class={[styles.skeletonGroup, props.class ?? ''].filter(Boolean).join(' ')}
      style={{ gap: `${props.gap ?? 6}px` }}
      aria-hidden="true"
    >
      <For each={Array.from({ length: props.rows ?? 3 })}>
        {() => <div class={styles.skeleton} style={{ height: `${props.height ?? 34}px` }} />}
      </For>
    </div>
  );
}

/* -------------------------------------------------------------- EmptyState */

interface EmptyStateProps {
  icon?: JSX.Element;
  title: string;
  hint?: string;
  action?: JSX.Element;
  compact?: boolean;
}

export function EmptyState(props: EmptyStateProps): JSX.Element {
  return (
    <div class={[styles.empty, props.compact ? styles.emptyCompact : ''].filter(Boolean).join(' ')}>
      <Show when={props.icon}>
        <span class={styles.emptyIcon}>{props.icon}</span>
      </Show>
      <p class={styles.emptyTitle}>{props.title}</p>
      <Show when={props.hint}>
        <p class={styles.emptyHint}>{props.hint}</p>
      </Show>
      <Show when={props.action}>
        <div class={styles.emptyAction}>{props.action}</div>
      </Show>
    </div>
  );
}

/* ---------------------------------------------------------------- ErrorNote */

export function ErrorNote(props: { message: string; onRetry?: () => void }): JSX.Element {
  return (
    <div class={styles.errorNote} role="alert">
      <span>{props.message}</span>
      <Show when={props.onRetry}>
        <Button variant="link" size="sm" onClick={props.onRetry}>
          {t('Retry')}
        </Button>
      </Show>
    </div>
  );
}

/* ------------------------------------------------------------------- Toasts */

export function ToastHost(): JSX.Element {
  return (
    <Portal>
      <div class={styles.toastHost} aria-live="polite" aria-atomic="false">
        <For each={uiStore.toasts()}>
          {(item) => (
            <div class={[styles.toast, item.tone === 'strong' ? styles.toastStrong : ''].filter(Boolean).join(' ')}>
              <span class={styles.toastMessage}>{item.message}</span>
              <Show when={item.action}>
                <button
                  class={styles.toastAction}
                  onClick={() => {
                    item.action?.run();
                    dismissToast(item.id);
                  }}
                >
                  {item.action?.label}
                </button>
              </Show>
            </div>
          )}
        </For>
      </div>
    </Portal>
  );
}

/* ------------------------------------------------------------ ConfirmDialog */

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog(props: ConfirmDialogProps): JSX.Element {
  return (
    <Modal
      open={props.open}
      onClose={props.onCancel}
      title={props.title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={props.onCancel}>
            {props.cancelLabel ?? t('Cancel')}
          </Button>
          <Button
            variant={props.destructive ? 'danger' : 'primary'}
            onClick={props.onConfirm}
            loading={props.busy}
            data-autofocus
          >
            {props.confirmLabel ?? t('Confirm')}
          </Button>
        </>
      }
    >
      <Show when={props.message}>
        <p class={styles.confirmText}>{props.message}</p>
      </Show>
    </Modal>
  );
}
