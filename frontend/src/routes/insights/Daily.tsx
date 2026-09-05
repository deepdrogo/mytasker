import type { JSX } from 'solid-js';
import { createSignal } from 'solid-js';
import { BarChart, Breakdown, Meter, Stat } from '~/features/insights/Charts';
import { Block, InsightsPage, StatGrid, TwoCol, longDate, minutesFmt } from '~/features/insights/InsightsPage';
import { analyticsApi, isoDay, shiftDays } from '~/features/dashboard/api';
import { createQuery } from '~/hooks/createQuery';
import { t } from '~/i18n';
import { tx } from '~/stores/translations';
import type { DailyReview } from '~/types';

export default function InsightsDaily(): JSX.Element {
  const today = isoDay(new Date());
  const [date, setDate] = createSignal(today);
  const query = createQuery<DailyReview>(
    () => `analytics:daily:${date()}`,
    () => analyticsApi.daily(date()),
    { staleMs: 30_000 },
  );
  const d = () => query.data();
  const m = () => d()?.metrics;
  const prev = () => d()?.previous;

  const projectRows = () => {
    const review = d();
    if (!review) return [];
    return Object.entries(review.metrics.project_minutes)
      .map(([id, minutes]) => {
        const name = review.projects[id];
        return { label: name ? tx('project', Number(id), 'name', name) : t('Project {id}', { id }), value: minutes };
      })
      .sort((a, b) => b.value - a.value);
  };

  return (
    <InsightsPage
      title={t('Insights')}
      periodLabel={date() === today ? t('Today') : longDate(date())}
      onPrev={() => setDate(shiftDays(date(), -1))}
      onNext={() => setDate(shiftDays(date(), 1))}
      onToday={() => setDate(today)}
      nextDisabled={date() >= today}
      loading={query.loading() && !d()}
      error={query.error()}
      onRetry={query.refetch}
    >
      <StatGrid>
        <Stat label={t('Completed')} value={String(m()?.tasks_completed ?? 0)} delta={(m()?.tasks_completed ?? 0) - (prev()?.tasks_completed ?? 0)} />
        <Stat label={t('Planned')} value={String(m()?.tasks_planned ?? 0)} delta={(m()?.tasks_planned ?? 0) - (prev()?.tasks_planned ?? 0)} />
        <Stat label={t('Missed')} value={String(m()?.tasks_missed ?? 0)} delta={(m()?.tasks_missed ?? 0) - (prev()?.tasks_missed ?? 0)} invertDelta />
        <Stat
          label={t('Completion')}
          value={`${m()?.completion_rate ?? 0}%`}
          delta={(m()?.completion_rate ?? 0) - (prev()?.completion_rate ?? 0)}
          deltaFormat={(v) => `${v}%`}
        />
        <Stat
          label={t('Business time')}
          value={minutesFmt(m()?.business_minutes ?? 0)}
          delta={(m()?.business_minutes ?? 0) - (prev()?.business_minutes ?? 0)}
          deltaFormat={minutesFmt}
        />
        <Stat label={t('Sleep')} value={minutesFmt(m()?.sleep_minutes ?? 0)} delta={(m()?.sleep_minutes ?? 0) - (prev()?.sleep_minutes ?? 0)} deltaFormat={minutesFmt} />
      </StatGrid>

      <TwoCol>
        <Block title={t('Targets')}>
          <Meter label={t('Business hours')} value={m()?.business_minutes ?? 0} max={m()?.business_target_minutes ?? 0} format={minutesFmt} />
          <Meter label={t('Sleep')} value={m()?.sleep_minutes ?? 0} max={m()?.sleep_target_minutes ?? 0} format={minutesFmt} />
          <Meter label={t('Routine')} value={m()?.routine_items_completed ?? 0} max={m()?.routine_items_total ?? 0} />
        </Block>

        <Block title={t('Completed by area')}>
          <BarChart
            height={110}
            showValues
            data={[
              { label: t('Personal'), value: m()?.personal_completed ?? 0 },
              { label: t('Business'), value: m()?.business_completed ?? 0 },
              { label: t('Team'), value: m()?.team_completed ?? 0 },
              { label: t('Guests'), value: m()?.guest_completed ?? 0 },
            ]}
          />
        </Block>
      </TwoCol>

      <Block title={t('Time by project')} hint={minutesFmt(projectRows().reduce((s, r) => s + r.value, 0))}>
        <Breakdown rows={projectRows()} format={minutesFmt} emptyText={t('No project time tracked this day.')} />
      </Block>
    </InsightsPage>
  );
}
