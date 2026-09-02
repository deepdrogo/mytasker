import { MessageSquare, Send } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { createSignal, For, Show } from 'solid-js';
import { ApiError } from '~/api/client';
import { Button } from '~/components/ui/Button';
import { EmptyState, ErrorNote, Skeleton } from '~/components/ui/Feedback';
import { Textarea } from '~/components/ui/Input';
import { collabApi } from '~/features/collab/api';
import { createQuery } from '~/hooks/createQuery';
import { toast } from '~/stores/ui';
import type { Comment, ID } from '~/types';
import { formatRelative } from '~/utils/format';
import styles from './Comments.module.css';

interface CommentsProps {
  task?: ID;
  project?: ID;
  canComment?: boolean;
}

export function Comments(props: CommentsProps): JSX.Element {
  const [draft, setDraft] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [editing, setEditing] = createSignal<Comment | null>(null);
  const [editBody, setEditBody] = createSignal('');

  const target = () => (props.task ? { task: props.task } : { project: props.project });
  const query = createQuery(
    () => `comments:${props.task ? `task-${props.task}` : `project-${props.project}`}`,
    () => collabApi.comments(target()),
  );

  const submit = async (event?: Event) => {
    event?.preventDefault();
    const body = draft().trim();
    if (!body || busy()) return;
    setBusy(true);
    try {
      await collabApi.addComment(body, props.task ? { task_id: props.task } : { project_id: props.project });
      setDraft('');
      query.refetch();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not post the comment.');
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async () => {
    const current = editing();
    if (!current) return;
    try {
      await collabApi.editComment(current.id, editBody().trim());
      setEditing(null);
      query.refetch();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not save.');
    }
  };

  const remove = async (comment: Comment) => {
    try {
      await collabApi.deleteComment(comment.id);
      query.refetch();
    } catch {
      toast('Could not delete the comment.');
    }
  };

  return (
    <div class={styles.wrap}>
      <Show when={!query.error()} fallback={<ErrorNote message="Could not load comments." onRetry={query.refetch} />}>
        <Show when={query.data()} fallback={<Skeleton rows={2} height={44} />}>
          {(comments) => (
            <Show
              when={comments().length > 0}
              fallback={<EmptyState compact icon={<MessageSquare size={18} />} title="No comments yet" />}
            >
              <ul class={styles.list}>
                <For each={comments()}>
                  {(comment) => (
                    <li class={styles.comment}>
                      <div class={styles.head}>
                        <span class={styles.author}>{comment.author.display_name}</span>
                        <span class={styles.time}>
                          {formatRelative(comment.created_at)}
                          <Show when={comment.edited_at}> · edited</Show>
                        </span>
                        <span class={styles.actions}>
                          <Show when={comment.can_edit}>
                            <button
                              type="button"
                              class={styles.linkBtn}
                              onClick={() => {
                                setEditing(comment);
                                setEditBody(comment.body);
                              }}
                            >
                              Edit
                            </button>
                          </Show>
                          <Show when={comment.can_delete}>
                            <button type="button" class={styles.linkBtn} onClick={() => void remove(comment)}>
                              Delete
                            </button>
                          </Show>
                        </span>
                      </div>
                      <Show
                        when={editing()?.id !== comment.id}
                        fallback={
                          <div class={styles.editBox}>
                            <Textarea rows={3} value={editBody()} onInput={(e) => setEditBody(e.currentTarget.value)} />
                            <div class={styles.editActions}>
                              <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
                                Cancel
                              </Button>
                              <Button size="sm" onClick={saveEdit}>
                                Save
                              </Button>
                            </div>
                          </div>
                        }
                      >
                        <p class={styles.body}>{comment.body}</p>
                      </Show>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          )}
        </Show>
      </Show>

      <Show when={props.canComment !== false}>
        <form class={styles.composer} onSubmit={submit}>
          <Textarea
            rows={2}
            placeholder="Write a comment… (Ctrl+Enter to send)"
            value={draft()}
            onInput={(e) => setDraft(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void submit();
            }}
          />
          <Button type="submit" size="sm" loading={busy()} disabled={!draft().trim()}>
            <Send size={13} />
            Send
          </Button>
        </form>
      </Show>
    </div>
  );
}
