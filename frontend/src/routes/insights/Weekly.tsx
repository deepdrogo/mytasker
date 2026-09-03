import type { JSX } from 'solid-js';
import { createSignal } from 'solid-js';
import { BarChart, Breakdown, Stat } from '~/features/insights/Charts';
import { Block, InsightsPage, StatGrid, TwoCol, minutesFmt, shortDate, shortDay } from '~/features/insights/InsightsPage';
import { analyticsApi, isoDay, shiftDays } from '~/features/today/api';
import { createQuery } from '~/hooks/createQuery';
import { t } from '~/i18n';
import { tx } from '~/stores/translations';
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
  const tot = () => d()?.totals;
  const p = () => d()?.previous_totals;
  const days = () => d()?.days ?? [];

  const projectRows = () => {
    const review = d();
    if (!review) return [];
    return Object.entries(review.totals.project_minutes)
      .map(([id, minutes]) => {
        const name = review.projects[id];
        return { label: name ? tx('project', Number(id), 'name', name) : t('Project {id}', { id }), value: minutes };
      })
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  };

  return (
    <InsightsPage
      title={t('Insights')}
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
          label={t('Completed')}
          value={String(tot()?.tasks_completed ?? 0)}
          delta={(tot()?.tasks_completed ?? 0) - (p()?.tasks_completed ?? 0)}
          spark={days().map((x) => x.tasks_completed)}
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
          spark={days().map((x) => x.business_minutes)}
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
          spark={days().map((x) => x.sleep_minutes)}
        />
        <Stat label={t('Routine')} value={`${tot()?.routine_rate ?? 0}%`} delta={(tot()?.routine_rate ?? 0) - (p()?.routine_rate ?? 0)} deltaFormat={(v) => `${v}%`} />
        <Stat label={t('Active days')} value={`${tot()?.active_days ?? 0}/7`} />
      </StatGrid>

      <TwoCol>
        <Block title={t('Tasks completed per day')}>
          <BarChart
            height={130}
            showValues
            data={days().map((x) => ({ label: shortDay(x.date), value: x.tasks_completed, reference: x.tasks_planned, muted: x.date > today }))}
          />
        </Block>
        <Block title={t('Business hours per day')} hint={t('dashed = target')}>
          <BarChart
            height={130}
            format={minutesFmt}
            data={days().map((x) => ({ label: shortDay(x.date), value: x.business_minutes, reference: x.business_target_minutes, muted: x.date > today }))}
          />
        </Block>
      </TwoCol>

      <TwoCol>
        <Block title={t('Sleep per night')} hint={t('dashed = target')}>
          <BarChart
            height={110}
            format={minutesFmt}
            data={days().map((x) => ({ label: shortDay(x.date), value: x.sleep_minutes, reference: x.sleep_target_minutes, muted: x.date > today }))}
          />
        </Block>
        <Block title={t('Routine completion')}>
          <BarChart
            height={110}
            format={(v) => `${v}%`}
            data={days().map((x) => ({ label: shortDay(x.date), value: x.routine_rate, muted: x.date > today }))}
          />
        </Block>
      </TwoCol>

      <TwoCol>
        <Block title={t('Time by project')}>
          <Breakdown rows={projectRows()} format={minutesFmt} emptyText={t('No project time this week.')} />
        </Block>
        <Block title={t('Completed by area')}>
          <Breakdown
            rows={[
              { label: t('Personal'), value: tot()?.personal_completed ?? 0 },
              { label: t('Business'), value: tot()?.business_completed ?? 0 },
              { label: t('Team'), value: tot()?.team_completed ?? 0 },
              { label: t('Guests'), value: tot()?.guest_completed ?? 0 },
            ].filter((r) => r.value > 0)}
            emptyText={t('Nothing completed this week.')}
          />
        </Block>
      </TwoCol>
    </InsightsPage>
  );
}
