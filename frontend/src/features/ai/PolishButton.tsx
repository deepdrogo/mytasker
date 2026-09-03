import { Sparkles } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { createSignal, Show } from 'solid-js';
import { Button, type ButtonVariant } from '~/components/ui/Button';
import { polishTasks } from '~/features/ai/polish';
import { t } from '~/i18n';
import { authStore } from '~/stores/auth';
import type { ID } from '~/types';

interface PolishButtonProps {
  /** Tasks to rewrite when clicked; the button hides itself when the list is empty. */
  taskIds: () => ID[];
  label?: string;
  variant?: ButtonVariant;
  onChanged?: () => void;
}

/** Bulk "rewrite with AI" affordance for a whole list or a selection. Hidden when AI is off for this user. */
export function PolishButton(props: PolishButtonProps): JSX.Element {
  const [busy, setBusy] = createSignal(false);

  const run = async () => {
    if (busy()) return;
    setBusy(true);
    try {
      await polishTasks(props.taskIds(), props.onChanged);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Show when={authStore.aiEnabled() && props.taskIds().length > 0}>
      <Button
        variant={props.variant ?? 'secondary'}
        size="sm"
        loading={busy()}
        onClick={() => void run()}
        title={t('Rewrite these titles so they are clear and specific')}
      >
        <Sparkles size={13} />
        {props.label ?? t('Polish with AI')}
      </Button>
    </Show>
  );
}
