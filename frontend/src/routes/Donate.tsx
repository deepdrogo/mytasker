import type { JSX } from 'solid-js';
import { Page } from '~/components/shared/Page';
import { DonateContent } from '~/features/donations/DonateContent';

export default function Donate(): JSX.Element {
  return (
    <Page title="Donate" subtitle="MyTasker is free and has no premium tier. If it saves you time, you can support hosting and development.">
      <DonateContent />
    </Page>
  );
}
