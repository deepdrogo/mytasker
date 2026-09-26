import type { JSX } from 'solid-js';
import { createSignal } from 'solid-js';
import { Page } from '~/components/shared/Page';
import { TaskCalendar } from '~/features/tasks/TaskCalendar';
import { tasksApi } from '~/features/tasks/api';
import { TaskEditor } from '~/features/tasks/TaskEditor';
import { t } from '~/i18n';
import type { Task } from '~/types';

export default function TaskCalendarPage(): JSX.Element {
  const [active, setActive] = createSignal<Task | null>(null);

  return (
    <Page
      title={t('Task calendar')}
      subtitle={t('A start date through the due date marks every day in between. Today still follows the due date only.')}
    >
      <TaskCalendar onOpen={setActive} />
      <TaskEditor
        task={active()}
        open={active() !== null}
        onClose={() => setActive(null)}
        onChanged={() => {
          const current = active();
          if (current) void tasksApi.get(current.id).then(setActive).catch(() => setActive(null));
        }}
        onOpenTask={(task) => void tasksApi.get(task.id).then(setActive).catch(() => setActive(task))}
      />
    </Page>
  );
}
