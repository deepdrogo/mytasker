import type { JSX } from 'solid-js';
import { RoutinePage } from '~/features/routines/RoutinePage';
import { t } from '~/i18n';

export default function RoutineBusiness(): JSX.Element {
  return <RoutinePage kind="business" title={t('Business Routine')} subtitle={t('Your working day, block by block')} />;
}
