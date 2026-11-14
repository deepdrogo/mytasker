// MyTasker — this week's time: totals per activity and a seven-day strip, each day stacked by activity.

import { A } from '@solidjs/router';
import type { JSX } from 'solid-js';
import { For, Show, createMemo } from 'solid-js';
import { api } from '~/api/client';
import { createQuery } from '~/hooks/createQuery';
import { intlLocale, t } from '~/i18n';
import type { CycleKind, WeekTimeSummary } from '~/types';
import { cx } from '~/utils/cx';
import { formatDate, formatDuration } from '~/utils/format';
import styles from './WeekCard.module.css';

const KINDS: Array<{ kind: CycleKind; label: string }> = [
  { kind: 'sleep', label: 'Sleep' },
  { kind: 'business', label: 'Work' },
  { kind: 'fun', label: 'Fun' },
  { kind: 'exercise', label: 'Exercise' },
  { kind: 'personal', label: 'Other' },
];

export const KIND_TONE: Record<CycleKind, string> = {
  sleep: styles.kSleep!,
  business: styles.kWork!,
  fun: styles.kFun!,
  exercise: styles.kExercise!,
  personal: styles.kOther!,
};

const DAY_SECONDS = 24 * 3600;

/** ISO dates are calendar days; parse them as local dates so the weekday never slips across midnight UTC. */
function localDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

const dur = (seconds: number) => (seconds < 60 ? '0' : formatDuration(seconds));

export function WeekCard(): JSX.Element {
  const query = createQuery<WeekTimeSummary>(() => 'timer:week', () => api.get<WeekTimeSummary>('/timer/week/'));
  const data = () => query.data();
  /** Other only shows up once something was logged under it. */
  const kinds = createMemo(() => KINDS.filter((item) => item.kind !== 'personal' || (data()?.seconds.personal ?? 0) > 0));
  const biggest = createMemo(() => Math.max(1, ...kinds().map((item) => data()?.seconds[item.kind] ?? 0)));

  return (
    <section class={styles.card} aria-label={t('This week')}>
      <header class={styles.head}>
        <span class={styles.title}>{t('This week')}</span>
        <Show when={data()}>
          {(week) => (
            <span class={styles.range}>
              {formatDate(week().start)} – {formatDate(week().end)}
            </span>
          )}
        </Show>
        <span class={styles.total}>{dur(data()?.total ?? 0)}</span>
      </header>

      <Show when={data()} fallback={<div class={styles.placeholder} />}>
        {(week) => (
          <>
            <ul class={styles.rows}>
              <For each={kinds()}>
                {(item) => {
                  const seconds = () => week().seconds[item.kind] ?? 0;
                  return (
                    <li class={cx(styles.row, KIND_TONE[item.kind])}>
                      <i class={styles.key} />
                      <span class={styles.name}>{t(item.label)}</span>
                      <span class={styles.bar}>
                        <span class={styles.fill} style={{ width: `${(seconds() / biggest()) * 100}%` }} />
                      </span>
                      <span class={styles.value}>{dur(seconds())}</span>
                    </li>
                  );
                }}
              </For>
            </ul>

            {/* Seven columns, each a full day tall; today outlined, days ahead left empty. */}
            <div class={styles.days} role="img" aria-label={t('Time per day this week')}>
              <For each={week().days}>
                {(day) => {
                  const date = localDate(day.date);
                  const isToday = day.date === week().today;
                  const ahead = day.date > week().today;
                  return (
                    <div class={cx(styles.day, isToday && styles.today, ahead && styles.ahead)} title={`${formatDate(day.date)} · ${dur(day.total)}`}>
                      <div class={styles.stack}>
                        <For each={kinds()}>
                          {(item) => (
                            <span
                              class={cx(styles.piece, KIND_TONE[item.kind])}
                              style={{ height: `${((day.seconds[item.kind] ?? 0) / DAY_SECONDS) * 100}%` }}
                            />
                          )}
                        </For>
                      </div>
                      <span class={styles.dayLabel}>{date.toLocaleDateString(intlLocale(), { weekday: 'narrow' })}</span>
                    </div>
                  );
                }}
              </For>
            </div>

            <A href="/time/history" class={styles.link}>
              {t('Full time history')} →
            </A>
          </>
        )}
      </Show>
    </section>
  );
}
