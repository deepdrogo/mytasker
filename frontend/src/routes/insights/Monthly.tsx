import type { JSX } from 'solid-js';
import { createSignal } from 'solid-js';
import { BarChart, Breakdown, Stat } from '~/features/insights/Charts';
import { Block, InsightsPage, StatGrid, TwoCol, minutesFmt, monthLabel, shortDate } from '~/features/insights/InsightsPage';
import { analyticsApi, isoDay, shiftMonths } from '~/features/today/api';
import { createQuery } from '~/hooks/createQuery';
import { t } from '~/i18n';
import { tx } from '~/stores/translations';
import type { MonthlyReview } from '~/types';

export default function InsightsMonthly(): JSX.Element {
  const today = isoDay(new Date());
  const [date, setDate] = createSignal(today.slice(0, 8) + '01');
  const query = createQuery<MonthlyReview>(
    () => `analytics:monthly:${date()}`,
    () => analyticsApi.monthly(date()),
    { staleMs: 60_000 },
  );
  const d = () => query.data();
  const tot = () => d()?.totals;
  const p = () => d()?.previous_totals;
  const days = () => d()?.days ?? [];
  const weeks = () => d()?.weeks ?? [];

  const projectRows = () => {
    const review = d();
    if (!review) return [];
    return Object.entries(review.totals.project_minutes)
      .map(([id, minutes]) => {
        const name = review.projects[id];
        return { label: name ? tx('project', Number(id), 'name', name) : t('Project {id}', { id }), value: minutes };
      })
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  };

  return (
    <InsightsPage
      title={t('Insights')}
      periodLabel={monthLabel(date())}
      onPrev={() => setDate(shiftMonths(date(), -1))}
      onNext={() => setDate(shiftMonths(date(), 1))}
      onToday={() => setDate(today.slice(0, 8) + '01')}
      nextDisabled={date().slice(0, 7) >= today.slice(0, 7)}
      loading={query.loading() && !d()}
      error={query.error()}
      onRetry={query.refetch}
    >
      <StatGrid>
        <Stat
          label={t('Completed')}
          value={String(tot()?.tasks_completed ?? 0)}
          delta={(tot()?.tasks_completed ?? 0) - (p()?.tasks_completed ?? 0)}
          spark={weeks().map((w) => w.tasks_completed)}
        />
        <Stat
          label={t('Completion')}
          value={`${tot()?.completion_rate ?? 0}%`}
          delta={(tot()?.completion_rate ?? 0) - (p()?.completion_rate ?? 0)}
          deltaFormat={(v) => `${v}%`}
        />
        <Stat label={t('Missed')} value={String(tot()?.tasks_missed ?? 0)} delta={(tot()?.tasks_missed ?? 0) - (p()?.tasks_missed ?? 0)} invertDelta />
        <Stat
          label={t('Business time')}
          value={minutesFmt(tot()?.business_minutes ?? 0)}
          delta={(tot()?.business_minutes ?? 0) - (p()?.business_minutes ?? 0)}
          deltaFormat={minutesFmt}
          spark={weeks().map((w) => w.business_minutes)}
        />
        <Stat
          label={t('Avg business / day')}
          value={minutesFmt(tot()?.avg_business_minutes ?? 0)}
          delta={(tot()?.avg_business_minutes ?? 0) - (p()?.avg_business_minutes ?? 0)}
          deltaFormat={minutesFmt}
        />
        <Stat
          label={t('Avg sleep')}
          value={minutesFmt(tot()?.avg_sleep_minutes ?? 0)}
          delta={(tot()?.avg_sleep_minutes ?? 0) - (p()?.avg_sleep_minutes ?? 0)}
          deltaFormat={minutesFmt}
        />
        <Stat label={t('Routine')} value={`${tot()?.routine_rate ?? 0}%`} delta={(tot()?.routine_rate ?? 0) - (p()?.routine_rate ?? 0)} deltaFormat={(v) => `${v}%`} />
        <Stat label={t('Active days')} value={`${tot()?.active_days ?? 0}/${days().length}`} />
      </StatGrid>

      <Block title={t('Tasks completed per day')} hint={t('dashed = planned')}>
        <BarChart
          height={140}
          data={days().map((x) => ({
            label: x.date.slice(8).replace(/^0/, ''),
            value: x.tasks_completed,
            reference: x.tasks_planned,
            muted: x.date > today,
            title: t('{date}: {done} done / {planned} planned', { date: shortDate(x.date), done: x.tasks_completed, planned: x.tasks_planned }),
          }))}
        />
      </Block>

      <TwoCol>
        <Block title={t('Business hours per week')} hint={t('dashed = target')}>
          <BarChart
            height={130}
            format={minutesFmt}
            showValues
            data={weeks().map((w) => ({
              label: shortDate(w.start_date),
              value: w.business_minutes,
              reference: w.business_target_minutes,
              muted: w.start_date > today,
            }))}
          />
        </Block>
        <Block title={t('Completed per week')}>
          <BarChart
            height={130}
            showValues
            data={weeks().map((w) => ({ label: shortDate(w.start_date), value: w.tasks_completed, reference: w.tasks_planned, muted: w.start_date > today }))}
          />
        </Block>
      </TwoCol>

      <TwoCol>
        <Block title={t('Time by project')}>
          <Breakdown rows={projectRows()} format={minutesFmt} emptyText={t('No project time this month.')} />
        </Block>
        <Block title={t('Sleep per night')}>
          <BarChart
            height={110}
            format={minutesFmt}
            data={days().map((x) => ({
              label: x.date.slice(8).replace(/^0/, ''),
              value: x.sleep_minutes,
              reference: x.sleep_target_minutes,
              muted: x.date > today,
              title: `${shortDate(x.date)}: ${minutesFmt(x.sleep_minutes)}`,
            }))}
          />
        </Block>
      </TwoCol>
    </InsightsPage>
  );
}
