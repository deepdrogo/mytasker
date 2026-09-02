import type { JSX } from 'solid-js';
import { createSignal } from 'solid-js';
import { BarChart, Breakdown, Stat } from '~/features/insights/Charts';
import { Block, InsightsPage, StatGrid, TwoCol, minutesFmt, monthLabel, shortDate } from '~/features/insights/InsightsPage';
import { analyticsApi, isoDay, shiftMonths } from '~/features/today/api';
import { createQuery } from '~/hooks/createQuery';
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
  const t = () => d()?.totals;
  const p = () => d()?.previous_totals;
  const days = () => d()?.days ?? [];
  const weeks = () => d()?.weeks ?? [];

  const projectRows = () => {
    const review = d();
    if (!review) return [];
    return Object.entries(review.totals.project_minutes)
      .map(([id, minutes]) => ({ label: review.projects[id] ?? `Project ${id}`, value: minutes }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  };

  return (
    <InsightsPage
      title="Insights"
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
        <Stat label="Completed" value={String(t()?.tasks_completed ?? 0)} delta={(t()?.tasks_completed ?? 0) - (p()?.tasks_completed ?? 0)} spark={weeks().map((w) => w.tasks_completed)} />
        <Stat label="Completion" value={`${t()?.completion_rate ?? 0}%`} delta={(t()?.completion_rate ?? 0) - (p()?.completion_rate ?? 0)} deltaFormat={(v) => `${v}%`} />
        <Stat label="Missed" value={String(t()?.tasks_missed ?? 0)} delta={(t()?.tasks_missed ?? 0) - (p()?.tasks_missed ?? 0)} invertDelta />
        <Stat label="Business time" value={minutesFmt(t()?.business_minutes ?? 0)} delta={(t()?.business_minutes ?? 0) - (p()?.business_minutes ?? 0)} deltaFormat={minutesFmt} spark={weeks().map((w) => w.business_minutes)} />
        <Stat label="Avg business / day" value={minutesFmt(t()?.avg_business_minutes ?? 0)} delta={(t()?.avg_business_minutes ?? 0) - (p()?.avg_business_minutes ?? 0)} deltaFormat={minutesFmt} />
        <Stat label="Avg sleep" value={minutesFmt(t()?.avg_sleep_minutes ?? 0)} delta={(t()?.avg_sleep_minutes ?? 0) - (p()?.avg_sleep_minutes ?? 0)} deltaFormat={minutesFmt} />
        <Stat label="Routine" value={`${t()?.routine_rate ?? 0}%`} delta={(t()?.routine_rate ?? 0) - (p()?.routine_rate ?? 0)} deltaFormat={(v) => `${v}%`} />
        <Stat label="Active days" value={`${t()?.active_days ?? 0}/${days().length}`} />
      </StatGrid>

      <Block title="Tasks completed per day" hint="dashed = planned">
        <BarChart
          height={140}
          data={days().map((x) => ({
            label: x.date.slice(8).replace(/^0/, ''),
            value: x.tasks_completed,
            reference: x.tasks_planned,
            muted: x.date > today,
            title: `${shortDate(x.date)}: ${x.tasks_completed} done / ${x.tasks_planned} planned`,
          }))}
        />
      </Block>

      <TwoCol>
        <Block title="Business hours per week" hint="dashed = target">
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
        <Block title="Completed per week">
          <BarChart
            height={130}
            showValues
            data={weeks().map((w) => ({ label: shortDate(w.start_date), value: w.tasks_completed, reference: w.tasks_planned, muted: w.start_date > today }))}
          />
        </Block>
      </TwoCol>

      <TwoCol>
        <Block title="Time by project">
          <Breakdown rows={projectRows()} format={minutesFmt} emptyText="No project time this month." />
        </Block>
        <Block title="Sleep per night">
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
