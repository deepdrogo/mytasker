// MyTasker — date + time picker that always shows the clock the user asked for (24h by default).
// Native <input type="datetime-local"> follows the OS locale and shows AM/PM on many devices; this
// splits the value into a date field and a 24-hour (or 12-hour, per preference) time select.
// Built by drogoz · https://github.com/deepdrogo/mytasker

import type { JSX } from 'solid-js';
import { For, Show, createMemo, splitProps } from 'solid-js';
import { Input, Select } from '~/components/ui/Input';
import { t } from '~/i18n';
import { authStore } from '~/stores/auth';
import styles from './DateTimeInput.module.css';

interface DateTimeInputProps {
  /** Local value in `YYYY-MM-DDTHH:MM` form (same shape as datetime-local), or '' for none. */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Hide the time select and edit only the date; the time part of `value` is preserved. */
  dateOnly?: boolean;
  /** Minutes between time options. */
  step?: 5 | 10 | 15 | 30 | 60;
  sizeVariant?: 'sm' | 'md';
  /** Time used when a date is picked and no time exists yet. */
  defaultTime?: string;
  class?: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

function labelFor(hhmm: string, use12h: boolean): string {
  if (!use12h) return hhmm;
  const h = Number(hhmm.slice(0, 2));
  const m = Number(hhmm.slice(3, 5));
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`;
}

export function DateTimeInput(props: DateTimeInputProps): JSX.Element {
  const [local] = splitProps(props, ['value', 'onChange', 'disabled', 'dateOnly', 'step', 'sizeVariant', 'defaultTime', 'class']);
  const use12h = () => authStore.user()?.preferences.time_format === '12h';
  const datePart = () => local.value.slice(0, 10);
  const timePart = () => (local.value.length >= 16 ? local.value.slice(11, 16) : '');

  const options = createMemo(() => {
    const step = local.step ?? 15;
    const list: string[] = [];
    for (let minutes = 0; minutes < 24 * 60; minutes += step) list.push(`${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`);
    // Keep an off-grid stored time (e.g. 18:07 set via AI) selectable instead of silently rounding it.
    const current = timePart();
    if (current && !list.includes(current)) list.push(current);
    return list.sort();
  });

  const setDate = (date: string) => {
    if (!date) {
      local.onChange('');
      return;
    }
    local.onChange(`${date}T${timePart() || local.defaultTime || '09:00'}`);
  };

  const setTime = (time: string) => {
    const date = datePart() || todayISO();
    local.onChange(`${date}T${time}`);
  };

  return (
    <div class={[styles.wrap, local.dateOnly ? styles.dateOnly : '', local.class ?? ''].filter(Boolean).join(' ')}>
      <Input
        type="date"
        sizeVariant={local.sizeVariant}
        value={datePart()}
        onInput={(e) => setDate(e.currentTarget.value)}
        disabled={local.disabled}
        aria-label={t('Date')}
        class={styles.date}
      />
      <Show when={!local.dateOnly}>
        <Select
          sizeVariant={local.sizeVariant}
          value={timePart()}
          onChange={(e) => setTime(e.currentTarget.value)}
          disabled={local.disabled}
          aria-label={t('Time')}
          class={styles.time}
        >
          <Show when={!timePart()}>
            <option value="">--:--</option>
          </Show>
          <For each={options()}>{(hhmm) => <option value={hhmm}>{labelFor(hhmm, use12h())}</option>}</For>
        </Select>
      </Show>
    </div>
  );
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
