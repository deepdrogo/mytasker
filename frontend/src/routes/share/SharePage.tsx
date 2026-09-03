import { useParams } from '@solidjs/router';
import { Check, Circle, Lock, RotateCcw } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { For, Show, createResource, createSignal } from 'solid-js';
import { ApiError } from '~/api/client';
import { PriorityMark } from '~/components/shared/Indicators';
import { Button } from '~/components/ui/Button';
import { Input } from '~/components/ui/Input';
import { guestApi } from '~/features/sharing/api';
import { t } from '~/i18n';
import type { GuestShareView, GuestTask } from '~/types';
import { formatDueDate, formatRelative } from '~/utils/format';
import styles from './SharePage.module.css';
import { cx } from '~/utils/cx';
import { Logo } from '~/components/shared/Logo';

/** Public guest page. Deliberately minimal and self-contained: no app shell, no auth. */
export default function SharePage(): JSX.Element {
  const params = useParams<{ token: string }>();
  const [view, setView] = createSignal<GuestShareView | null>(null);
  const [error, setError] = createSignal<{ code: string; message: string } | null>(null);
  const [password, setPassword] = createSignal('');
  const [name, setName] = createSignal('');
  const [busy, setBusy] = createSignal<number | 'unlock' | 'name' | null>(null);
  const [nameError, setNameError] = createSignal('');

  const apply = (data: GuestShareView) => {
    setView(data);
    setError(null);
  };

  const fail = (err: unknown) => {
    if (err instanceof ApiError) setError({ code: err.code, message: err.message });
    else setError({ code: 'network_error', message: t('Could not load this link.') });
  };

  const [initial] = createResource(
    () => params.token,
    async (token) => {
      try {
        apply(await guestApi.view(token));
      } catch (err) {
        fail(err);
      }
      return true;
    },
  );

  const unlock = async () => {
    setBusy('unlock');
    try {
      apply(await guestApi.unlock(params.token, password()));
      setPassword('');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'share_wrong_password') setError({ code: err.code, message: t('Wrong password.') });
      else fail(err);
    } finally {
      setBusy(null);
    }
  };

  const identify = async () => {
    if (!name().trim()) {
      setNameError(t('Please enter your name.'));
      return;
    }
    setBusy('name');
    try {
      apply(await guestApi.identify(params.token, name().trim()));
      setNameError('');
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  const needsName = () => {
    const v = view();
    return Boolean(v && v.authenticated && v.ask_guest_name && !v.guest_name);
  };

  const toggle = async (task: GuestTask) => {
    const v = view();
    if (!v || busy() !== null) return;
    if (task.status === 'done' ? !v.allow_reopen : !v.allow_complete) return;
    if (needsName()) {
      setNameError(t('Tell us your name first so the owner knows who did it.'));
      return;
    }
    setBusy(task.id);
    try {
      apply(task.status === 'done' ? await guestApi.reopen(params.token, task.id) : await guestApi.complete(params.token, task.id));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  const done = () => view()?.tasks.filter((task) => task.status === 'done').length ?? 0;

  return (
    <div class={styles.page}>
      <header class={styles.header}>
        <Logo size={20} class={styles.brand} />
        <Show when={view()}>
          <span class={styles.meta}>{t('{done}/{total} done', { done: done(), total: view()?.tasks.length ?? 0 })}</span>
        </Show>
      </header>

      <main class={styles.main}>
        <Show when={!initial.loading} fallback={<p class={styles.dim}>{t('Loading…')}</p>}>
          <Show when={!(error() && !view())}>
            <h1 class={styles.title}>{view()?.title}</h1>
          </Show>

          <Show when={error() && !view()}>
            <div class={styles.blocked}>
              <h1 class={styles.title}>{t('This link is not available')}</h1>
              <p class={styles.dim}>{error()?.message}</p>
            </div>
          </Show>

          <Show when={view() && !view()!.authenticated}>
            <form
              class={styles.card}
              onSubmit={(e) => {
                e.preventDefault();
                void unlock();
              }}
            >
              <div class={styles.cardHead}>
                <Lock size={14} /> {t('This link is password protected')}
              </div>
              <Input
                type="password"
                placeholder={t('Password')}
                value={password()}
                onInput={(e) => setPassword(e.currentTarget.value)}
                autofocus
                invalid={error()?.code === 'share_wrong_password'}
              />
              <Show when={error()?.code === 'share_wrong_password'}>
                <p class={styles.error}>{error()?.message}</p>
              </Show>
              <Button variant="primary" type="submit" loading={busy() === 'unlock'} disabled={!password()}>
                {t('Unlock')}
              </Button>
            </form>
          </Show>

          <Show when={needsName()}>
            <form
              class={styles.card}
              onSubmit={(e) => {
                e.preventDefault();
                void identify();
              }}
            >
              <div class={styles.cardHead}>{t('Your name')}</div>
              <p class={styles.dim}>{t('The owner will see who completed each task.')}</p>
              <Input placeholder={t('e.g. Nino')} value={name()} onInput={(e) => setName(e.currentTarget.value)} maxLength={80} invalid={Boolean(nameError())} />
              <Show when={nameError()}>
                <p class={styles.error}>{nameError()}</p>
              </Show>
              <Button variant="primary" type="submit" loading={busy() === 'name'}>
                {t('Continue')}
              </Button>
            </form>
          </Show>

          <Show when={view()?.authenticated}>
            <Show when={view()?.guest_name}>
              <p class={styles.dim}>
                {t('Working as')} <strong>{view()?.guest_name}</strong>
              </p>
            </Show>
            <Show when={error() && view()?.authenticated}>
              <p class={styles.error}>{error()?.message}</p>
            </Show>
            <ul class={styles.list}>
              <For each={view()?.tasks ?? []}>
                {(task) => (
                  <li class={cx(styles.item, task.status === 'done' && styles.done)}>
                    <button
                      type="button"
                      class={styles.check}
                      disabled={busy() !== null || (task.status === 'done' ? !view()?.allow_reopen : !view()?.allow_complete)}
                      onClick={() => void toggle(task)}
                      aria-label={task.status === 'done' ? t('Reopen') : t('Complete')}
                    >
                      <Show when={task.status === 'done'} fallback={<Circle size={18} />}>
                        <Check size={18} />
                      </Show>
                    </button>
                    <div class={styles.body}>
                      <div class={styles.row}>
                        <span class={styles.taskTitle}>{task.title}</span>
                        <Show when={task.priority !== 'normal'}>
                          <PriorityMark priority={task.priority} />
                        </Show>
                      </div>
                      <Show when={task.description}>
                        <p class={styles.desc}>{task.description}</p>
                      </Show>
                      <div class={styles.sub}>
                        <Show when={task.due_at}>
                          <span>{formatDueDate(task.due_at, true)}</span>
                        </Show>
                        <Show when={task.status === 'done'}>
                          <span>
                            {task.completed_by_name ? t('Done by {name}', { name: task.completed_by_name }) : t('Done')} {formatRelative(task.completed_at)}
                          </span>
                        </Show>
                      </div>
                      <Show when={task.subtasks.length > 0}>
                        <ul class={styles.subtasks}>
                          <For each={task.subtasks}>
                            {(sub) => (
                              <li class={cx(sub.status === 'done' && styles.done)}>
                                <button
                                  type="button"
                                  class={styles.checkSmall}
                                  disabled={busy() !== null || (sub.status === 'done' ? !view()?.allow_reopen : !view()?.allow_complete)}
                                  onClick={() => void toggle(sub)}
                                  aria-label={sub.status === 'done' ? t('Reopen') : t('Complete')}
                                >
                                  <Show when={sub.status === 'done'} fallback={<Circle size={13} />}>
                                    <Check size={13} />
                                  </Show>
                                </button>
                                <span>{sub.title}</span>
                              </li>
                            )}
                          </For>
                        </ul>
                      </Show>
                    </div>
                    <Show when={task.status === 'done' && view()?.allow_reopen}>
                      <RotateCcw size={13} class={styles.reopenHint} />
                    </Show>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </Show>
      </main>

      <footer class={styles.footer}>
        {t('Shared via')} <a href="/">mytasker.io</a> — {t('a free control center for life and business.')}
      </footer>
    </div>
  );
}
