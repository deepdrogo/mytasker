import { ChevronDown, ChevronUp, MoreHorizontal, Plus, ScrollText } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { createSignal, For, Show } from 'solid-js';
import { ApiError } from '~/api/client';
import { Page } from '~/components/shared/Page';
import { Button } from '~/components/ui/Button';
import { Drawer } from '~/components/ui/Drawer';
import { Dropdown } from '~/components/ui/Dropdown';
import { EmptyState, ErrorNote, Skeleton } from '~/components/ui/Feedback';
import { Checkbox, Field, Input, Textarea } from '~/components/ui/Input';
import { rulesApi, type RuleInput } from '~/features/routines/api';
import { routineTabs } from '~/features/routines/RoutinePage';
import { createQuery } from '~/hooks/createQuery';
import { t } from '~/i18n';
import { tx } from '~/stores/translations';
import { toast } from '~/stores/ui';
import type { Rule } from '~/types';
import styles from './Rules.module.css';

export default function Rules(): JSX.Element {
  const query = createQuery(
    () => 'rules:list',
    () => rulesApi.list(),
  );
  const [quick, setQuick] = createSignal('');
  const [editing, setEditing] = createSignal<Rule | null>(null);

  const quickAdd = async (event: Event) => {
    event.preventDefault();
    const text = quick().trim();
    if (!text) return;
    try {
      await rulesApi.create({ text });
      setQuick('');
      query.refetch();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('Could not save the rule.'));
    }
  };

  const move = async (rule: Rule, direction: -1 | 1) => {
    const ids = (query.data() ?? []).map((r) => r.id);
    const index = ids.indexOf(rule.id);
    const target = index + direction;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target] as number, ids[index] as number];
    await rulesApi.reorder(ids);
    query.refetch();
  };

  const toggle = async (rule: Rule) => {
    await rulesApi.update(rule.id, { is_enabled: !rule.is_enabled });
    query.refetch();
  };

  const remove = async (rule: Rule) => {
    await rulesApi.remove(rule.id);
    query.refetch();
  };

  return (
    <>
      <Page title={t('Rules')} subtitle={t('Principles you have decided to live by. Not tasks.')} tabs={routineTabs()}>
        <div class={styles.wrap}>
          <form class={styles.quick} onSubmit={quickAdd}>
            <Plus size={16} class={styles.quickIcon} />
            <input
              class={styles.quickInput}
              placeholder={t('New rule, e.g. “No email before 10:00”')}
              value={quick()}
              onInput={(e) => setQuick(e.currentTarget.value)}
              aria-label={t('New rule')}
            />
          </form>

          <Show when={!query.error()} fallback={<ErrorNote message={t('Could not load rules.')} onRetry={query.refetch} />}>
            <Show when={query.data()} fallback={<Skeleton rows={4} height={48} />}>
              {(rules) => (
                <Show
                  when={rules().length > 0}
                  fallback={<EmptyState icon={<ScrollText size={22} />} title={t('No rules yet')} hint={t('Rules are the constraints that make the rest of the system work.')} />}
                >
                  <ol class={styles.list}>
                    <For each={rules()}>
                      {(rule, index) => (
                        <li class={[styles.row, rule.is_enabled ? '' : styles.disabled].join(' ')}>
                          <span class={styles.index}>{index() + 1}</span>
                          <button type="button" class={styles.main} onClick={() => setEditing(rule)}>
                            <span class={styles.text}>{tx('rule', rule.id, 'text', rule.text)}</span>
                            <Show when={rule.description}>
                              <span class={styles.description}>{tx('rule', rule.id, 'description', rule.description)}</span>
                            </Show>
                          </button>
                          <Dropdown
                            label={t('Rule actions')}
                            items={[
                              { label: t('Edit'), onSelect: () => setEditing(rule) },
                              { label: rule.is_enabled ? t('Disable') : t('Enable'), onSelect: () => void toggle(rule) },
                              { label: t('Move up'), icon: <ChevronUp size={14} />, disabled: index() === 0, onSelect: () => void move(rule, -1) },
                              { label: t('Move down'), icon: <ChevronDown size={14} />, disabled: index() === rules().length - 1, onSelect: () => void move(rule, 1) },
                              { label: t('Delete'), danger: true, separatorBefore: true, onSelect: () => void remove(rule) },
                            ]}
                            trigger={(menu) => (
                              <Button variant="ghost" size="icon-sm" onClick={menu.toggle} aria-label={t('More')}>
                                <MoreHorizontal size={15} />
                              </Button>
                            )}
                          />
                        </li>
                      )}
                    </For>
                  </ol>
                </Show>
              )}
            </Show>
          </Show>
        </div>
      </Page>

      <RuleEditor rule={editing()} open={editing() !== null} onClose={() => setEditing(null)} onSaved={() => query.refetch()} />
    </>
  );
}

function RuleEditor(props: { rule: Rule | null; open: boolean; onClose: () => void; onSaved: () => void }): JSX.Element {
  const [form, setForm] = createSignal<RuleInput>({});
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal('');

  const reset = () => {
    setForm({ text: props.rule?.text ?? '', description: props.rule?.description ?? '', is_enabled: props.rule?.is_enabled ?? true });
    setError('');
  };

  const save = async () => {
    if (!props.rule || saving()) return;
    if (!form().text?.trim()) {
      setError(t('Rule text is required.'));
      return;
    }
    setSaving(true);
    try {
      await rulesApi.update(props.rule.id, form());
      props.onSaved();
      props.onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('Could not save.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open={props.open}
      onClose={props.onClose}
      title={t('Rule')}
      footer={
        <>
          <Button variant="ghost" onClick={props.onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={save} loading={saving()}>
            {t('Save')}
          </Button>
        </>
      }
    >
      <Show when={props.open} keyed>
        {(() => {
          reset();
          return (
            <div class={styles.form}>
              <Field label={t('Rule')} required error={error()}>
                <Input value={form().text ?? ''} onInput={(e) => setForm((f) => ({ ...f, text: e.currentTarget.value }))} autofocus />
              </Field>
              <Field label={t('Why')} hint={t('A sentence about the reason makes rules stick.')}>
                <Textarea rows={4} value={form().description ?? ''} onInput={(e) => setForm((f) => ({ ...f, description: e.currentTarget.value }))} />
              </Field>
              <Checkbox label={t('Enabled')} checked={form().is_enabled ?? true} onChange={(e) => setForm((f) => ({ ...f, is_enabled: e.currentTarget.checked }))} />
            </div>
          );
        })()}
      </Show>
    </Drawer>
  );
}
