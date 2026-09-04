import { Check, ChevronDown, ChevronUp, Flame, MoreHorizontal, Plus, ScrollText, X } from 'lucide-solid';
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
import { cx } from '~/utils/cx';
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

  // Daily self-check. Clicking the active state again clears today's mark.
  const [marking, setMarking] = createSignal<number | null>(null);
  const mark = async (rule: Rule, value: boolean) => {
    setMarking(rule.id);
    try {
      await rulesApi.markKept(rule.id, rule.today_kept === value ? null : value);
      query.refetch();
    } catch {
      toast(t('Could not update the rule.'));
    } finally {
      setMarking(null);
    }
  };
  const enabled = () => (query.data() ?? []).filter((r) => r.is_enabled);
  const keptCount = () => enabled().filter((r) => r.today_kept === true).length;
  const uncheckedCount = () => enabled().filter((r) => r.today_kept === null).length;

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

          <Show when={enabled().length > 0}>
            <div class={styles.todayCard}>
              <div class={styles.todayHead}>
                <span class={styles.todayLabel}>{t('Today')}</span>
                <span class={styles.todayCount}>
                  {keptCount()}/{enabled().length} {t('kept')}
                </span>
              </div>
              <div class={styles.segments} aria-hidden="true">
                <For each={enabled()}>
                  {(rule) => <span class={cx(styles.seg, rule.today_kept === true && styles.segKept, rule.today_kept === false && styles.segBroken)} />}
                </For>
              </div>
              <p class={styles.todayHint}>
                <Show when={uncheckedCount() > 0} fallback={t('All rules checked for today.')}>
                  {t('{count} still to check today', { count: uncheckedCount() })}
                </Show>
              </p>
            </div>
          </Show>

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
                        <li class={cx(styles.row, !rule.is_enabled && styles.disabled, rule.today_kept === true && styles.kept, rule.today_kept === false && styles.broken)}>
                          <span class={styles.index}>{index() + 1}</span>
                          <button type="button" class={styles.main} onClick={() => setEditing(rule)}>
                            <span class={styles.textLine}>
                              <span class={styles.text}>{tx('rule', rule.id, 'text', rule.text)}</span>
                              <Show when={rule.streak > 1}>
                                <span class={styles.streak} title={t('{count} days in a row', { count: rule.streak })}>
                                  <Flame size={11} /> {rule.streak}
                                </span>
                              </Show>
                            </span>
                            <Show when={rule.description}>
                              <span class={styles.description}>{tx('rule', rule.id, 'description', rule.description)}</span>
                            </Show>
                          </button>
                          <Show when={rule.is_enabled}>
                            <div class={styles.check} role="group" aria-label={t('Today')}>
                              <button
                                type="button"
                                class={cx(styles.checkBtn, rule.today_kept === true && styles.checkKept)}
                                disabled={marking() === rule.id}
                                onClick={() => void mark(rule, true)}
                                aria-pressed={rule.today_kept === true}
                                title={t('Kept today')}
                                aria-label={t('Kept today')}
                              >
                                <Check size={14} />
                              </button>
                              <button
                                type="button"
                                class={cx(styles.checkBtn, rule.today_kept === false && styles.checkBroken)}
                                disabled={marking() === rule.id}
                                onClick={() => void mark(rule, false)}
                                aria-pressed={rule.today_kept === false}
                                title={t('Broken today')}
                                aria-label={t('Broken today')}
                              >
                                <X size={14} />
                              </button>
                            </div>
                          </Show>
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
