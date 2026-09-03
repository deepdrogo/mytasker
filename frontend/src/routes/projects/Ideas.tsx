import { useNavigate } from '@solidjs/router';
import { ArrowRight, Lightbulb, MoreHorizontal, Plus, Trash2 } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { createSignal, For, Show } from 'solid-js';
import { ApiError } from '~/api/client';
import { PriorityMark } from '~/components/shared/Indicators';
import { Page } from '~/components/shared/Page';
import { Button } from '~/components/ui/Button';
import { Drawer } from '~/components/ui/Drawer';
import { Dropdown } from '~/components/ui/Dropdown';
import { EmptyState, ErrorNote, Skeleton } from '~/components/ui/Feedback';
import { Field, Input, Select, Textarea } from '~/components/ui/Input';
import { ideasApi, type IdeaInput } from '~/features/projects/api';
import { projectTabs } from '~/features/projects/ProjectListPage';
import { createQuery } from '~/hooks/createQuery';
import { t } from '~/i18n';
import { tx } from '~/stores/translations';
import { toast } from '~/stores/ui';
import type { Idea, Priority } from '~/types';
import { formatRelative } from '~/utils/format';
import styles from './Ideas.module.css';

export default function Ideas(): JSX.Element {
  const navigate = useNavigate();
  const [showConverted, setShowConverted] = createSignal(false);
  const [editing, setEditing] = createSignal<Idea | null | 'new'>(null);
  const [quick, setQuick] = createSignal('');

  const query = createQuery(
    () => `ideas:list:converted=${showConverted() ? 'all' : '0'}`,
    () => ideasApi.list(showConverted() ? { page_size: 200 } : { converted: '0', page_size: 200 }),
  );

  const quickAdd = async (event: Event) => {
    event.preventDefault();
    const title = quick().trim();
    if (!title) return;
    try {
      await ideasApi.create({ title });
      setQuick('');
      query.refetch();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('Could not save the idea.'));
    }
  };

  const convert = async (idea: Idea) => {
    try {
      const project = await ideasApi.convert(idea.id);
      toast(t('Idea converted to a project'));
      navigate(`/projects/${project.id}/tasks`);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('Could not convert the idea.'));
    }
  };

  const remove = async (idea: Idea) => {
    try {
      await ideasApi.remove(idea.id);
      query.refetch();
    } catch {
      toast(t('Could not delete the idea.'));
    }
  };

  const excerpt = (idea: Idea): string =>
    idea.improved_text ? tx('idea', idea.id, 'improved_text', idea.improved_text) : tx('idea', idea.id, 'raw_text', idea.raw_text);

  return (
    <>
      <Page
        title={t('Project Ideas')}
        subtitle={t('Capture first, decide later')}
        tabs={projectTabs()}
        actions={
          <Button size="sm" variant="ghost" onClick={() => setShowConverted((v) => !v)}>
            {showConverted() ? t('Hide converted') : t('Show converted')}
          </Button>
        }
      >
        <div class={styles.wrap}>
          <form class={styles.quick} onSubmit={quickAdd}>
            <Plus size={16} class={styles.quickIcon} />
            <input
              class={styles.quickInput}
              placeholder={t('New idea…')}
              value={quick()}
              onInput={(e) => setQuick(e.currentTarget.value)}
              aria-label={t('New idea')}
            />
          </form>

          <Show when={!query.error()} fallback={<ErrorNote message={t('Could not load ideas.')} onRetry={query.refetch} />}>
            <Show when={query.data()} fallback={<Skeleton rows={4} height={56} />}>
              {(data) => (
                <Show
                  when={data().results.length > 0}
                  fallback={<EmptyState icon={<Lightbulb size={22} />} title={t('No ideas yet')} hint={t('Type one above. It takes two seconds.')} />}
                >
                  <ul class={styles.list}>
                    <For each={data().results}>
                      {(idea) => (
                        <li class={[styles.row, idea.converted_project ? styles.rowConverted : ''].join(' ')}>
                          <button type="button" class={styles.main} onClick={() => setEditing(idea)}>
                            <PriorityMark priority={idea.priority} />
                            <div class={styles.text}>
                              <span class={styles.title}>{tx('idea', idea.id, 'title', idea.title)}</span>
                              <Show when={idea.improved_text || idea.raw_text}>
                                <span class={styles.excerpt}>{excerpt(idea)}</span>
                              </Show>
                            </div>
                            <span class={styles.meta}>
                              <Show when={idea.category}>
                                <span>{tx('idea', idea.id, 'category', idea.category)}</span>
                              </Show>
                              <span>{formatRelative(idea.created_at)}</span>
                            </span>
                          </button>
                          <div class={styles.actions}>
                            <Show
                              when={!idea.converted_project}
                              fallback={
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => navigate(`/projects/${idea.converted_project?.id}/tasks`)}
                                >
                                  {t('Open project')}
                                </Button>
                              }
                            >
                              <Button variant="secondary" size="sm" onClick={() => void convert(idea)}>
                                <ArrowRight size={13} />
                                {t('Convert')}
                              </Button>
                            </Show>
                            <Dropdown
                              label={t('Idea actions')}
                              items={[
                                { label: t('Edit'), onSelect: () => setEditing(idea) },
                                { label: t('Delete'), icon: <Trash2 size={14} />, danger: true, onSelect: () => void remove(idea) },
                              ]}
                              trigger={(menu) => (
                                <Button variant="ghost" size="icon-sm" onClick={menu.toggle} aria-label={t('More')}>
                                  <MoreHorizontal size={15} />
                                </Button>
                              )}
                            />
                          </div>
                        </li>
                      )}
                    </For>
                  </ul>
                </Show>
              )}
            </Show>
          </Show>
        </div>
      </Page>

      <IdeaEditor
        idea={editing() === 'new' ? null : (editing() as Idea | null)}
        open={editing() !== null}
        onClose={() => setEditing(null)}
        onSaved={() => query.refetch()}
        onConvert={convert}
      />
    </>
  );
}

function IdeaEditor(props: {
  idea: Idea | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  onConvert: (idea: Idea) => void;
}): JSX.Element {
  const [form, setForm] = createSignal<IdeaInput>({});
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal('');

  const reset = () => {
    const i = props.idea;
    setForm({
      title: i?.title ?? '',
      raw_text: i?.raw_text ?? '',
      improved_text: i?.improved_text ?? '',
      notes: i?.notes ?? '',
      category: i?.category ?? '',
      priority: i?.priority ?? 'normal',
    });
    setError('');
  };

  const update = <K extends keyof IdeaInput>(key: K, value: IdeaInput[K]) => setForm((f) => ({ ...f, [key]: value }));

  const save = async () => {
    if (saving()) return;
    if (!form().title?.trim()) {
      setError(t('Title is required.'));
      return;
    }
    setSaving(true);
    try {
      if (props.idea) await ideasApi.update(props.idea.id, form());
      else await ideasApi.create(form());
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
      title={props.idea ? t('Idea') : t('New idea')}
      footer={
        <div class={styles.footer}>
          <Show when={props.idea && !props.idea.converted_project}>
            <Button variant="secondary" size="sm" onClick={() => props.idea && props.onConvert(props.idea)}>
              <ArrowRight size={13} />
              {t('Convert to project')}
            </Button>
          </Show>
          <div class={styles.footerRight}>
            <Button variant="ghost" onClick={props.onClose}>
              {t('Cancel')}
            </Button>
            <Button onClick={save} loading={saving()}>
              {t('Save')}
            </Button>
          </div>
        </div>
      }
    >
      <Show when={props.open} keyed>
        {(() => {
          reset();
          return (
            <div class={styles.form}>
              <Field label={t('Title')} required error={error()}>
                <Input value={form().title ?? ''} onInput={(e) => update('title', e.currentTarget.value)} autofocus />
              </Field>
              <div class={styles.grid}>
                <Field label={t('Category')}>
                  <Input value={form().category ?? ''} onInput={(e) => update('category', e.currentTarget.value)} />
                </Field>
                <Field label={t('Priority')}>
                  <Select value={form().priority ?? 'normal'} onChange={(e) => update('priority', e.currentTarget.value as Priority)}>
                    <option value="critical">{t('Critical')}</option>
                    <option value="high">{t('High')}</option>
                    <option value="normal">{t('Normal')}</option>
                    <option value="low">{t('Low')}</option>
                  </Select>
                </Field>
              </div>
              <Field label={t('Raw idea')} hint={t('Brain dump. Unstructured is fine.')}>
                <Textarea rows={5} value={form().raw_text ?? ''} onInput={(e) => update('raw_text', e.currentTarget.value)} />
              </Field>
              <Field label={t('Refined version')} hint={t('Use AI › Improve, or write it yourself.')}>
                <Textarea rows={5} value={form().improved_text ?? ''} onInput={(e) => update('improved_text', e.currentTarget.value)} />
              </Field>
              <Field label={t('Notes')}>
                <Textarea rows={3} value={form().notes ?? ''} onInput={(e) => update('notes', e.currentTarget.value)} />
              </Field>
            </div>
          );
        })()}
      </Show>
    </Drawer>
  );
}
