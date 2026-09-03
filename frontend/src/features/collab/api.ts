import { api, type CursorPage, type QueryParams } from '~/api/client';
import { invalidate } from '~/hooks/createQuery';
import { t } from '~/i18n';
import type { ActivityItem, Comment, ID } from '~/types';

export const collabApi = {
  comments: (target: { task?: ID; project?: ID }) => api.get<Comment[]>('/comments/', { params: target }),
  addComment: async (body: string, target: { task_id?: ID; project_id?: ID }) => {
    const comment = await api.post<Comment>('/comments/', { body, ...target });
    invalidate('comments', 'activity', 'tasks');
    return comment;
  },
  editComment: async (id: ID, body: string) => {
    const comment = await api.patch<Comment>(`/comments/${id}/`, { body });
    invalidate('comments');
    return comment;
  },
  deleteComment: async (id: ID) => {
    await api.delete(`/comments/${id}/`);
    invalidate('comments', 'tasks');
  },
  activity: (params: QueryParams & { project?: ID; task?: ID; cursor?: string }) =>
    api.get<CursorPage<ActivityItem>>('/activity/', { params }),
};

/**
 * Human sentence for an activity event. Keeps payload shape knowledge in one place.
 * Reactive (calls `t()`) - evaluate it inside JSX so it re-renders on locale change.
 * Titles/names come from the event payload snapshot, so they are quoted verbatim and never translated.
 */
export function describeActivity(item: ActivityItem): string {
  const p = item.payload as Record<string, string | number | undefined>;
  const rawTitle = (p.title as string) || (p.task_title as string) || '';
  const q = (s: unknown) => (s ? `“${String(s)}”` : '');
  const title = q(rawTitle);
  const name = q(p.name);
  const member = p.member ? String(p.member) : t('a member');

  const line = (): string => {
    switch (item.name) {
      case 'task.created':
        return t('created task {title}', { title });
      case 'task.completed':
        return t('completed {title}', { title });
      case 'task.reopened':
        return t('reopened {title}', { title });
      case 'task.deleted':
        return t('deleted {title}', { title });
      case 'task.updated':
        return t('updated {title}', { title });
      case 'task.deadline_changed':
        return t('changed the deadline of {title}', { title });
      case 'task.assigned':
        return p.assignee ? t('assigned {title} to {assignee}', { title, assignee: String(p.assignee) }) : t('assigned {title}', { title });
      case 'subtask.created':
        return t('added subtask {title}', { title });
      case 'subtask.completed':
        return t('completed subtask {title}', { title });
      case 'subtask.reopened':
        return t('reopened subtask {title}', { title });
      case 'comment.created':
        return t('commented on {title}', { title: q(rawTitle || p.project_name) });
      case 'project.created':
        return t('created project {name}', { name });
      case 'project.updated':
        return t('updated project {name}', { name });
      case 'project.mode_changed':
        return t('switched the project to {mode}', { mode: String(p.mode ?? '').replace('_', ' ') });
      case 'project.member_invited':
        return t('invited {email}', { email: String(p.email ?? '') });
      case 'project.member_joined':
        return t('joined the project');
      case 'project.member_removed':
        return t('removed {member}', { member });
      case 'project.member_role_changed':
        return t('changed {member} to {role}', { member, role: String(p.role ?? '') });
      case 'prompt.created':
        return t('added prompt {title}', { title });
      case 'prompt.updated':
        return t('edited prompt {title}', { title });
      case 'prompt.visibility_changed':
        return t('changed visibility of prompt {title}', { title });
      case 'timer.started':
        return title ? t('started a timer on {title}', { title }) : t('started a timer');
      case 'timer.stopped':
        return title ? t('stopped a timer on {title}', { title }) : t('stopped a timer');
      case 'share.created':
        return t('shared {count} task(s)', { count: p.task_count ?? '' });
      case 'share.opened':
        return t('opened a shared link');
      case 'share.guest_identified':
        return t('identified as a guest');
      case 'share.task_completed':
        return t('completed {title} via share link', { title });
      case 'share.task_reopened':
        return t('reopened {title} via share link', { title });
      default:
        return item.name.replace('.', ' ');
    }
  };

  // A missing title leaves a dangling separator ("created task ") - tidy the whitespace.
  return line().replace(/\s{2,}/g, ' ').trim();
}
