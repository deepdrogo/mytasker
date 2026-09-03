import { A, useNavigate, useParams, useSearchParams } from '@solidjs/router';
import { ArrowLeft, Copy, History, Maximize2, Minimize2, Save, Sparkles, Star, Trash2 } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { batch, createEffect, createSignal, For, onCleanup, Show } from 'solid-js';
import { ApiError } from '~/api/client';
import { Badge } from '~/components/shared/Indicators';
import { Button } from '~/components/ui/Button';
import { Drawer } from '~/components/ui/Drawer';
import { ConfirmDialog, ErrorNote, Skeleton } from '~/components/ui/Feedback';
import { Field, Input, Select } from '~/components/ui/Input';
import { aiApi } from '~/features/ai/api';
import { projectsApi } from '~/features/projects/api';
import { copyToClipboard, promptsApi, type PromptInput } from '~/features/prompts/api';
import { createQuery } from '~/hooks/createQuery';
import { t } from '~/i18n';
import { authStore } from '~/stores/auth';
import { tx } from '~/stores/translations';
import { toast } from '~/stores/ui';
import type { PromptVersion, Visibility } from '~/types';
import { formatRelative } from '~/utils/format';
import styles from './Detail.module.css';

export default function PromptDetail(): JSX.Element {
  const params = useParams<{ id: string }>();
  const [searchParams] = useSearchParams<{ project?: string }>();
  const navigate = useNavigate();
  const isNew = () => params.id === 'new';
  const id = () => Number(params.id);

  const prompt = createQuery(
    () => (isNew() ? null : `prompts:detail:${id()}`),
    () => promptsApi.get(id()),
  );
  const projects = createQuery(
    () => 'projects:picker',
    () => projectsApi.list({ view: 'open', page_size: 200 }),
    { staleMs: 60_000 },
  );

  const [title, setTitle] = createSignal('');
  const [body, setBody] = createSignal('');
  const [description, setDescription] = createSignal('');
  const [category, setCategory] = createSignal('');
  const [tags, setTags] = createSignal('');
  const [projectId, setProjectId] = createSignal<number | null>(searchParams.project ? Number(searchParams.project) : null);
  const [visibility, setVisibility] = createSignal<Visibility>('group');
  const [dirty, setDirty] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal('');
  const [fullscreen, setFullscreen] = createSignal(false);
  const [historyOpen, setHistoryOpen] = createSignal(false);
  const [confirmDelete, setConfirmDelete] = createSignal(false);
  const [improving, setImproving] = createSignal(false);
  let textarea: HTMLTextAreaElement | undefined;

  const loaded = () => prompt.data();
  const canEdit = () => isNew() || (loaded()?.can_edit ?? false);
  const selectedProject = () => projects.data()?.results.find((p) => p.id === projectId());

  createEffect(() => {
    const p = loaded();
    if (!p) return;
    batch(() => {
      setTitle(p.title);
      setBody(p.body);
      setDescription(p.description);
      setCategory(p.category);
      setTags(p.tags.join(', '));
      setProjectId(p.project?.id ?? null);
      setVisibility(p.visibility);
      setDirty(false);
      setError('');
    });
  });

  const mark = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setDirty(true);
  };

  const save = async () => {
    if (saving()) return;
    if (!title().trim()) {
      setError(t('Title is required.'));
      return;
    }
    if (!body().trim()) {
      setError(t('Prompt body is required.'));
      return;
    }
    setSaving(true);
    setError('');
    const payload: PromptInput = {
      title: title().trim(),
      body: body(),
      description: description(),
      category: category().trim(),
      tags: tags()
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      project_id: projectId(),
      visibility: projectId() ? visibility() : null,
    };
    try {
      if (isNew()) {
        const created = await promptsApi.create(payload);
        toast(t('Prompt saved'));
        navigate(`/prompts/${created.id}`, { replace: true });
      } else {
        await promptsApi.update(id(), { ...payload, version: loaded()?.version });
        setDirty(false);
        prompt.refetch();
        toast(t('Saved'));
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.isConflict ? t('This prompt changed elsewhere. Reload to get the latest version.') : err.message);
      } else {
        setError(t('Could not save.'));
      }
    } finally {
      setSaving(false);
    }
  };

  const copy = async () => {
    const ok = await copyToClipboard(body());
    toast(ok ? t('Prompt copied') : t('Copy failed'));
  };

  const remove = async () => {
    try {
      await promptsApi.remove(id());
      toast(t('Prompt deleted'));
      navigate('/prompts');
    } catch {
      toast(t('Could not delete.'));
    } finally {
      setConfirmDelete(false);
    }
  };

  const improve = async () => {
    if (improving() || !body().trim()) return;
    if (isNew() || dirty()) {
      toast(t('Save the prompt first, then improve it - so the original stays in version history.'));
      return;
    }
    setImproving(true);
    try {
      const result = await aiApi.improvePrompt(id());
      if (result.body) {
        setBody(result.body);
        setDirty(true);
        const changes = result.changes?.length ? ` ${t('Changes: {changes}', { changes: result.changes.slice(0, 2).join('; ') })}` : '';
        toast(`${t('Improved version applied. Save to keep it.')}${changes}`, { ms: 6000 });
      }
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('AI is unavailable right now.'));
    } finally {
      setImproving(false);
    }
  };

  const onKey = (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void save();
    } else if (event.key === 'Escape' && fullscreen()) {
      setFullscreen(false);
    }
  };
  window.addEventListener('keydown', onKey);
  onCleanup(() => window.removeEventListener('keydown', onKey));

  const restore = async (version: PromptVersion) => {
    try {
      await promptsApi.restore(id(), version.number);
      prompt.refetch();
      setHistoryOpen(false);
      toast(t('Restored version {number}', { number: version.number }));
    } catch {
      toast(t('Could not restore.'));
    }
  };

  return (
    <Show when={!prompt.error()} fallback={<ErrorNote message={t('This prompt does not exist or you cannot access it.')} />}>
      <Show when={isNew() || loaded()} fallback={<Skeleton rows={8} height={40} />}>
        <div class={[styles.editor, fullscreen() ? styles.fullscreen : ''].join(' ')}>
          <header class={styles.bar}>
            <A href="/prompts" class={styles.back} aria-label={t('Back to library')}>
              <ArrowLeft size={15} />
            </A>
            <input
              class={styles.titleInput}
              placeholder={t('Prompt title')}
              value={title()}
              onInput={(e) => mark(setTitle)(e.currentTarget.value)}
              readOnly={!canEdit()}
              aria-label={t('Title')}
            />
            <div class={styles.barActions}>
              <Show when={!isNew()}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={loaded()?.is_favorite ? t('Unfavorite') : t('Favorite')}
                  onClick={() => void promptsApi.toggleFavorite(id()).then(() => prompt.refetch())}
                >
                  <Star size={15} fill={loaded()?.is_favorite ? 'currentColor' : 'none'} />
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label={t('Version history')} onClick={() => setHistoryOpen(true)}>
                  <History size={15} />
                </Button>
              </Show>
              <Button variant="ghost" size="icon-sm" aria-label={t('Copy prompt')} onClick={() => void copy()}>
                <Copy size={15} />
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label={fullscreen() ? t('Exit fullscreen') : t('Fullscreen')} onClick={() => setFullscreen((v) => !v)}>
                <Show when={fullscreen()} fallback={<Maximize2 size={15} />}>
                  <Minimize2 size={15} />
                </Show>
              </Button>
              <Show when={canEdit()}>
                <Button size="sm" onClick={save} loading={saving()} disabled={!isNew() && !dirty()}>
                  <Save size={13} />
                  {t('Save')}
                </Button>
              </Show>
            </div>
          </header>

          <Show when={error()}>
            <p class={styles.error} role="alert">
              {error()}
            </p>
          </Show>

          <div class={styles.layout}>
            <div class={styles.bodyCol}>
              <textarea
                ref={textarea}
                class={styles.body}
                placeholder={t('Write or paste the prompt. There is no length limit.')}
                value={body()}
                onInput={(e) => mark(setBody)(e.currentTarget.value)}
                readOnly={!canEdit()}
                spellcheck={false}
                aria-label={t('Prompt body')}
              />
              <div class={styles.bodyMeta}>
                <span class="mt-mono">{t('{count} chars', { count: body().length.toLocaleString() })}</span>
                <span class="mt-mono">{t('{count} words', { count: body().split(/\s+/).filter(Boolean).length.toLocaleString() })}</span>
                <Show when={loaded()}>
                  <span>v{loaded()?.version}</span>
                  <span>{t('edited {time}', { time: formatRelative(loaded()?.updated_at) })}</span>
                  <Show when={loaded()?.last_edited_by}>
                    <span>{t('by {name}', { name: loaded()?.last_edited_by?.display_name ?? '' })}</span>
                  </Show>
                </Show>
                <Show when={dirty()}>
                  <Badge variant="dashed">{t('Unsaved')}</Badge>
                </Show>
                <Show when={authStore.aiEnabled() && canEdit()}>
                  <span class={styles.spacer} />
                  <Button variant="ghost" size="sm" onClick={() => void improve()} loading={improving()}>
                    <Sparkles size={13} />
                    {t('Improve with AI')}
                  </Button>
                </Show>
              </div>
            </div>

            <Show when={!fullscreen()}>
              <aside class={styles.side}>
                <Field label={t('Description')} hint={t('Shown in the list instead of the body.')}>
                  <Input value={description()} onInput={(e) => mark(setDescription)(e.currentTarget.value)} readOnly={!canEdit()} />
                </Field>
                <Field label={t('Category')}>
                  <Input value={category()} onInput={(e) => mark(setCategory)(e.currentTarget.value)} readOnly={!canEdit()} placeholder={t('e.g. Sales')} />
                </Field>
                <Field label={t('Tags')} hint={t('Comma separated.')}>
                  <Input value={tags()} onInput={(e) => mark(setTags)(e.currentTarget.value)} readOnly={!canEdit()} placeholder={t('email, outreach')} />
                </Field>
                <Field label={t('Project')} hint={selectedProject() && selectedProject()?.mode !== 'private' ? t('Linked to a shared project.') : undefined}>
                  <Select
                    value={projectId() ?? ''}
                    onChange={(e) => mark(setProjectId)(e.currentTarget.value ? Number(e.currentTarget.value) : null)}
                    disabled={!canEdit() || (!isNew() && !loaded()?.is_owner)}
                  >
                    <option value="">{t('No project')}</option>
                    <For each={projects.data()?.results ?? []}>{(p) => <option value={p.id}>{tx('project', p.id, 'name', p.name)}</option>}</For>
                  </Select>
                </Field>
                <Show when={selectedProject()?.mode === 'group_plus'}>
                  <Field label={t('Visibility')} hint={visibility() === 'private' ? t('Only you, even inside the project.') : t('All project members can read it.')}>
                    <Select
                      value={visibility()}
                      onChange={(e) => mark(setVisibility)(e.currentTarget.value as Visibility)}
                      disabled={!canEdit() || (!isNew() && !loaded()?.is_owner)}
                    >
                      <option value="group">{t('Shared with project')}</option>
                      <option value="private">{t('Private')}</option>
                    </Select>
                  </Field>
                </Show>
                <Show when={selectedProject()?.mode === 'group'}>
                  <p class={styles.note}>{t('Group projects share every prompt with all members.')}</p>
                </Show>

                <Show when={!isNew() && loaded()?.is_owner}>
                  <div class={styles.sideActions}>
                    <Button variant="ghost" size="sm" onClick={() => void promptsApi.toggleArchive(id()).then(() => prompt.refetch())}>
                      {loaded()?.is_archived ? t('Unarchive') : t('Archive')}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
                      <Trash2 size={13} />
                      {t('Delete')}
                    </Button>
                  </div>
                </Show>
              </aside>
            </Show>
          </div>
        </div>

        <Show when={!isNew()}>
          <VersionHistory promptId={id()} open={historyOpen()} onClose={() => setHistoryOpen(false)} onRestore={restore} canEdit={canEdit()} />
        </Show>

        <ConfirmDialog
          open={confirmDelete()}
          title={t('Delete this prompt?')}
          message={t('Version history is deleted with it.')}
          confirmLabel={t('Delete')}
          destructive
          onConfirm={remove}
          onCancel={() => setConfirmDelete(false)}
        />
      </Show>
    </Show>
  );
}

function VersionHistory(props: {
  promptId: number;
  open: boolean;
  onClose: () => void;
  onRestore: (v: PromptVersion) => void;
  canEdit: boolean;
}): JSX.Element {
  const versions = createQuery(
    () => (props.open ? `prompts:versions:${props.promptId}` : null),
    () => promptsApi.versions(props.promptId),
  );
  const [preview, setPreview] = createSignal<{ number: number; body: string } | null>(null);

  const open = async (v: PromptVersion) => {
    const detail = await promptsApi.version(props.promptId, v.number);
    setPreview({ number: v.number, body: detail.body });
  };

  return (
    <Drawer open={props.open} onClose={props.onClose} title={t('Version history')} width="560px">
      <Show when={versions.data()} fallback={<Skeleton rows={4} height={44} />}>
        {(list) => (
          <Show when={list().length > 0} fallback={<p class="mt-dim">{t('No previous versions. Each save of the title or body creates one.')}</p>}>
            <ul class={styles.versions}>
              <For each={list()}>
                {(v) => (
                  <li class={styles.version}>
                    <button type="button" class={styles.versionMain} onClick={() => void open(v)}>
                      <span class={styles.versionNumber}>v{v.number}</span>
                      <span class={styles.versionTitle}>{v.title}</span>
                      <span class={styles.versionMeta}>
                        {formatRelative(v.created_at)}
                        <Show when={v.edited_by}> · {v.edited_by?.display_name}</Show>
                      </span>
                      <span class={styles.versionSnippet}>{v.snippet}</span>
                    </button>
                    <Show when={props.canEdit}>
                      <Button variant="ghost" size="sm" onClick={() => props.onRestore(v)}>
                        {t('Restore')}
                      </Button>
                    </Show>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        )}
      </Show>
      <Show when={preview()}>
        {(p) => (
          <div class={styles.preview}>
            <div class={styles.previewHead}>
              <span>{t('Version {number}', { number: p().number })}</span>
              <Button variant="ghost" size="sm" onClick={() => void copyToClipboard(p().body).then(() => toast(t('Copied')))}>
                <Copy size={13} />
                {t('Copy')}
              </Button>
            </div>
            <pre class={styles.previewBody}>{p().body}</pre>
          </div>
        )}
      </Show>
    </Drawer>
  );
}
