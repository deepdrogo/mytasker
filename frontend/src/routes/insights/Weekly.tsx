import type { JSX } from 'solid-js';
import { createSignal } from 'solid-js';
import { BarChart, Breakdown, Stat } from '~/features/insights/Charts';
import { Block, InsightsPage, StatGrid, TwoCol, minutesFmt, shortDate, shortDay } from '~/features/insights/InsightsPage';
import { analyticsApi, isoDay, shiftDays } from '~/features/today/api';
import { createQuery } from '~/hooks/createQuery';
import type { WeeklyReview } from '~/types';

export default function InsightsWeekly(): JSX.Element {
  const today = isoDay(new Date());
  const [date, setDate] = createSignal(today);
  const query = createQuery<WeeklyReview>(
    () => `analytics:weekly:${date()}`,
    () => analyticsApi.weekly(date()),
    { staleMs: 30_000 },
  );
  const d = () => query.data();
  const t = () => d()?.totals;
  const p = () => d()?.previous_totals;
  const days = () => d()?.days ?? [];

  const projectRows = () => {
    const review = d();
    if (!review) return [];
    return Object.entries(review.totals.project_minutes)
      .map(([id, minutes]) => ({ label: review.projects[id] ?? `Project ${id}`, value: minutes }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  };

  return (
    <InsightsPage
      title="Insights"
      periodLabel={d() ? `${shortDate(d()!.start_date)} – ${shortDate(d()!.end_date)}` : '…'}
      onPrev={() => setDate(shiftDays(date(), -7))}
      onNext={() => setDate(shiftDays(date(), 7))}
      onToday={() => setDate(today)}
      nextDisabled={date() >= today}
      loading={query.loading() && !d()}
      error={query.error()}
      onRetry={query.refetch}
    >
      <StatGrid>
        <Stat
          label="Completed"
          value={String(t()?.tasks_completed ?? 0)}
          delta={(t()?.tasks_completed ?? 0) - (p()?.tasks_completed ?? 0)}
          spark={days().map((x) => x.tasks_completed)}
        />
        <Stat label="Completion" value={`${t()?.completion_rate ?? 0}%`} delta={(t()?.completion_rate ?? 0) - (p()?.completion_rate ?? 0)} deltaFormat={(v) => `${v}%`} />
        <Stat label="Missed" value={String(t()?.tasks_missed ?? 0)} delta={(t()?.tasks_missed ?? 0) - (p()?.tasks_missed ?? 0)} invertDelta />
        <Stat
          label="Business time"
          value={minutesFmt(t()?.business_minutes ?? 0)}
          delta={(t()?.business_minutes ?? 0) - (p()?.business_minutes ?? 0)}
          deltaFormat={minutesFmt}
          spark={days().map((x) => x.business_minutes)}
        />
        <Stat label="Avg business / day" value={minutesFmt(t()?.avg_business_minutes ?? 0)} delta={(t()?.avg_business_minutes ?? 0) - (p()?.avg_business_minutes ?? 0)} deltaFormat={minutesFmt} />
        <Stat label="Avg sleep" value={minutesFmt(t()?.avg_sleep_minutes ?? 0)} delta={(t()?.avg_sleep_minutes ?? 0) - (p()?.avg_sleep_minutes ?? 0)} deltaFormat={minutesFmt} spark={days().map((x) => x.sleep_minutes)} />
        <Stat label="Routine" value={`${t()?.routine_rate ?? 0}%`} delta={(t()?.routine_rate ?? 0) - (p()?.routine_rate ?? 0)} deltaFormat={(v) => `${v}%`} />
        <Stat label="Active days" value={`${t()?.active_days ?? 0}/7`} />
      </StatGrid>

      <TwoCol>
        <Block title="Tasks completed per day">
          <BarChart
            height={130}
            showValues
            data={days().map((x) => ({ label: shortDay(x.date), value: x.tasks_completed, reference: x.tasks_planned, muted: x.date > today }))}
          />
        </Block>
        <Block title="Business hours per day" hint="dashed = target">
          <BarChart
            height={130}
            format={minutesFmt}
            data={days().map((x) => ({ label: shortDay(x.date), value: x.business_minutes, reference: x.business_target_minutes, muted: x.date > today }))}
          />
        </Block>
      </TwoCol>

      <TwoCol>
        <Block title="Sleep per night" hint="dashed = target">
          <BarChart
            height={110}
            format={minutesFmt}
            data={days().map((x) => ({ label: shortDay(x.date), value: x.sleep_minutes, reference: x.sleep_target_minutes, muted: x.date > today }))}
          />
        </Block>
        <Block title="Routine completion">
          <BarChart
            height={110}
            format={(v) => `${v}%`}
            data={days().map((x) => ({ label: shortDay(x.date), value: x.routine_rate, muted: x.date > today }))}
          />
        </Block>
      </TwoCol>

      <TwoCol>
        <Block title="Time by project">
          <Breakdown rows={projectRows()} format={minutesFmt} emptyText="No project time this week." />
        </Block>
        <Block title="Completed by area">
          <Breakdown
            rows={[
              { label: 'Personal', value: t()?.personal_completed ?? 0 },
              { label: 'Business', value: t()?.business_completed ?? 0 },
              { label: 'Team', value: t()?.team_completed ?? 0 },
              { label: 'Guests', value: t()?.guest_completed ?? 0 },
            ].filter((r) => r.value > 0)}
            emptyText="Nothing completed this week."
          />
        </Block>
      </TwoCol>
    </InsightsPage>
  );
}
