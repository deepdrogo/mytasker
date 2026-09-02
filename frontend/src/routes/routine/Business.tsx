import type { JSX } from 'solid-js';
import { RoutinePage } from '~/features/routines/RoutinePage';

export default function RoutineBusiness(): JSX.Element {
  return <RoutinePage kind="business" title="Business Routine" subtitle="Your working day, block by block" />;
}
