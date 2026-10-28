// MyTasker — Working projects. A dense board of the projects in progress, sorted into groups you name.

import type { JSX } from 'solid-js';
import { Page } from '~/components/shared/Page';
import { WorkingBoard } from '~/features/projects/WorkingBoard';
import { t } from '~/i18n';

export default function Working(): JSX.Element {
  return (
    <Page title={t('Working projects')}>
      <WorkingBoard />
    </Page>
  );
}
