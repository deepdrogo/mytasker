import { useNavigate, useSearchParams } from '@solidjs/router';
import { Plus, Search } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { createSignal, For, Show } from 'solid-js';
import { Page } from '~/components/shared/Page';
import { Button } from '~/components/ui/Button';
import { Input, Select } from '~/components/ui/Input';
import { promptListKey, promptsApi, type PromptListParams } from '~/features/prompts/api';
import { PromptList } from '~/features/prompts/PromptList';
import { createQuery } from '~/hooks/createQuery';
import styles from './List.module.css';

const SORTS = [
  { value: '-updated', label: 'Recently updated' },
  { value: '-created', label: 'Recently created' },
  { value: 'title', label: 'Title' },
  { value: '-favorite', label: 'Favorites first' },
  { value: '-length', label: 'Longest' },
];

type View = 'all' | 'favorites' | 'mine' | 'shared' | 'archived';

export default function Prompts(): JSX.Element {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams<{ q?: string; category?: string; tag?: string; view?: string }>();
  const [ordering, setOrdering] = createSignal('-updated');
  const [page, setPage] = createSignal(1);
  const [q, setQ] = createSignal(searchParams.q ?? '');
  let debounce: number | undefined;

  const view = (): View => (searchParams.view as View) || 'all';

  const params = (): PromptListParams => ({
    q: searchParams.q || undefined,
    category: searchParams.category || undefined,
    tag: searchParams.tag || undefined,
    favorite: view() === 'favorites' ? true : undefined,
    owned: view() === 'mine' ? true : view() === 'shared' ? false : undefined,
    archived: view() === 'archived' ? true : undefined,
    ordering: ordering(),
    page: page(),
    page_size: 30,
  });

  const query = createQuery(
    () => promptListKey('library', params()),
    () => promptsApi.list(params()),
  );
  const facets = createQuery(
    () => 'prompts:facets',
    () => promptsApi.facets(),
    { staleMs: 30_000 },
  );

  const onSearch = (value: string) => {
    setQ(value);
    window.clearTimeout(debounce);
    debounce = window.setTimeout(() => {
      setPage(1);
      setSearchParams({ q: value.trim() || undefined });
    }, 220);
  };

  const setView = (next: View) => {
    setPage(1);
    setSearchParams({ view: next === 'all' ? undefined : next });
  };

  return (
    <Page
      title="Prompt Library"
      subtitle="Your reusable prompts, with history"
      actions={
        <Button size="sm" onClick={() => navigate('/prompts/new')}>
          <Plus size={14} />
          New prompt
        </Button>
      }
      toolbar={
        <div class={styles.toolbar}>
          <div class={styles.search}>
            <Search size={14} class={styles.searchIcon} />
            <Input
              sizeVariant="sm"
              placeholder="Search title, body, tags…"
              value={q()}
              onInput={(e) => onSearch(e.currentTarget.value)}
              aria-label="Search prompts"
            />
          </div>
          <Select sizeVariant="sm" value={view()} onChange={(e) => setView(e.currentTarget.value as View)} aria-label="View">
            <option value="all">All</option>
            <option value="favorites">Favorites</option>
            <option value="mine">Mine</option>
            <option value="shared">Shared with me</option>
            <option value="archived">Archived</option>
          </Select>
          <Select
            sizeVariant="sm"
            value={searchParams.category ?? ''}
            onChange={(e) => {
              setPage(1);
              setSearchParams({ category: e.currentTarget.value || undefined });
            }}
            aria-label="Category"
          >
            <option value="">Any category</option>
            <For each={facets.data()?.categories ?? []}>
              {(c) => (
                <option value={c.category}>
                  {c.category} ({c.count})
                </option>
              )}
            </For>
          </Select>
          <Select sizeVariant="sm" value={ordering()} onChange={(e) => setOrdering(e.currentTarget.value)} aria-label="Sort">
            <For each={SORTS}>{(s) => <option value={s.value}>{s.label}</option>}</For>
          </Select>
        </div>
      }
    >
      <div class={styles.wrap}>
        <Show when={(facets.data()?.tags.length ?? 0) > 0}>
          <div class={styles.tags}>
            <For each={facets.data()?.tags.slice(0, 20)}>
              {(tag) => (
                <button
                  type="button"
                  class={[styles.tag, searchParams.tag === tag.slug ? styles.tagActive : ''].join(' ')}
                  onClick={() => {
                    setPage(1);
                    setSearchParams({ tag: searchParams.tag === tag.slug ? undefined : tag.slug });
                  }}
                >
                  #{tag.name} <span class="mt-dim">{tag.count}</span>
                </button>
              )}
            </For>
          </div>
        </Show>

        <PromptList
          prompts={query.data()?.results}
          loading={query.loading()}
          error={query.error()}
          onRetry={query.refetch}
          onChanged={query.refetch}
          emptyTitle={searchParams.q ? 'No prompts match' : 'Your library is empty'}
          emptyHint={searchParams.q ? 'Try a different search.' : 'Save the prompts you keep re-typing. Long ones are welcome.'}
          emptyAction={
            <Show when={!searchParams.q}>
              <Button size="sm" onClick={() => navigate('/prompts/new')}>
                Create your first prompt
              </Button>
            </Show>
          }
        />

        <Show when={(query.data()?.count ?? 0) > 30}>
          <div class={styles.pager}>
            <Button variant="ghost" size="sm" disabled={page() === 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <span class="mt-mono mt-dim">
              {page()} / {Math.ceil((query.data()?.count ?? 0) / 30)}
            </span>
            <Button variant="ghost" size="sm" disabled={!query.data()?.next} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </Show>
      </div>
    </Page>
  );
}
