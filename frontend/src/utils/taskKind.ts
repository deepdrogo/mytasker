import { t } from '~/i18n';
import type { TaskKind } from '~/types';

export function taskKindLabel(kind: TaskKind | string): string {
  if (kind === 'business') return t('Business');
  if (kind === 'crypto') return t('Crypto world');
  return t('Personal');
}

export function taskKindHref(kind: TaskKind | string): string {
  if (kind === 'business') return '/tasks/business';
  if (kind === 'crypto') return '/tasks/crypto';
  return '/tasks/personal';
}
