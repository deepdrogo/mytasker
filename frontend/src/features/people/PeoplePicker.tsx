// MyTasker — PeoplePicker: toggle chips over the administrator's People; several can be picked at once.
// Built by drogoz · https://github.com/deepdrogo/mytasker

import { Check } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { For, Show } from 'solid-js';
import { peopleApi } from '~/features/people/api';
import { createQuery } from '~/hooks/createQuery';
import { t } from '~/i18n';
import { authStore } from '~/stores/auth';
import type { ID, Person, UserRef } from '~/types';
import { cx } from '~/utils/cx';
import styles from './PeoplePicker.module.css';

interface PeoplePickerProps {
  /** Selected user ids (not Person row ids). */
  value: ID[];
  onChange: (value: ID[]) => void;
  disabled?: boolean;
  /** Assignees already on the task who are not on the People list (e.g. project members) - kept selectable. */
  extra?: UserRef[];
  compact?: boolean;
}

/** Renders nothing for non-administrators or when there is nobody to pick. */
export function PeoplePicker(props: PeoplePickerProps): JSX.Element {
  const query = createQuery(() => (authStore.isAdmin() ? 'people:list' : null), () => peopleApi.list(), { staleMs: 30_000 });
  const people = (): Person[] => query.data() ?? [];
  const options = () => {
    const known = new Set(people().map((person) => person.user.id));
    const extras = (props.extra ?? []).filter((user) => !known.has(user.id)).map((user) => ({ id: user.id, name: user.display_name, note: '' }));
    return [...people().map((person) => ({ id: person.user.id, name: person.user.display_name, note: person.note })), ...extras];
  };
  const selected = (id: ID) => props.value.includes(id);
  const toggle = (id: ID) => {
    if (props.disabled) return;
    props.onChange(selected(id) ? props.value.filter((item) => item !== id) : [...props.value, id]);
  };

  return (
    <Show when={authStore.isAdmin() && options().length > 0}>
      <div class={cx(styles.chips, props.compact && styles.compact)} role="group" aria-label={t('Hand to')}>
        <For each={options()}>
          {(option) => (
            <button
              type="button"
              class={cx(styles.chip, selected(option.id) && styles.chipOn)}
              aria-pressed={selected(option.id)}
              disabled={props.disabled}
              onClick={() => toggle(option.id)}
              title={option.note || option.name}
            >
              <span class={styles.avatar} aria-hidden="true">
                <Show when={selected(option.id)} fallback={option.name.charAt(0).toUpperCase()}>
                  <Check size={10} />
                </Show>
              </span>
              <span class={styles.name}>{option.name}</span>
              <Show when={option.note && !props.compact}>
                <span class={styles.note}>{option.note}</span>
              </Show>
            </button>
          )}
        </For>
      </div>
    </Show>
  );
}
