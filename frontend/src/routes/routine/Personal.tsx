import type { JSX } from 'solid-js';
import { RoutinePage } from '~/features/routines/RoutinePage';

export default function RoutinePersonal(): JSX.Element {
  return <RoutinePage kind="personal" title="Personal Routine" subtitle="The blocks that keep you healthy and sane" />;
}
