import type { JSX } from 'solid-js';
import { RoutinePage } from '~/features/routines/RoutinePage';
import { t } from '~/i18n';

export default function RoutinePersonal(): JSX.Element {
  return <RoutinePage kind="personal" title={t('Personal Routine')} subtitle={t('The blocks that keep you healthy and sane')} />;
}
