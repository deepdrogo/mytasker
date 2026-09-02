import { api, type CursorPage, type QueryParams } from '~/api/client';
import { invalidate } from '~/hooks/createQuery';
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

/** Human sentence for an activity event. Keeps payload shape knowledge in one place. */
export function describeActivity(item: ActivityItem): string {
  const p = item.payload as Record<string, string | number | undefined>;
  const title = (p.title as string) || (p.task_title as string) || '';
  const q = (s: string) => (s ? `“${s}”` : '');
  switch (item.name) {
    case 'task.created':
      return `created task ${q(title)}`;
    case 'task.completed':
      return `completed ${q(title)}`;
    case 'task.reopened':
      return `reopened ${q(title)}`;
    case 'task.deleted':
      return `deleted ${q(title)}`;
    case 'task.updated':
      return `updated ${q(title)}`;
    case 'task.deadline_changed':
      return `changed the deadline of ${q(title)}`;
    case 'task.assigned':
      return `assigned ${q(title)}${p.assignee ? ` to ${p.assignee}` : ''}`;
    case 'subtask.created':
      return `added subtask ${q(title)}`;
    case 'subtask.completed':
      return `completed subtask ${q(title)}`;
    case 'subtask.reopened':
      return `reopened subtask ${q(title)}`;
    case 'comment.created':
      return `commented on ${q(title || (p.project_name as string))}`;
    case 'project.created':
      return `created project ${q(p.name as string)}`;
    case 'project.updated':
      return `updated project ${q(p.name as string)}`;
    case 'project.mode_changed':
      return `switched the project to ${String(p.mode ?? '').replace('_', ' ')}`;
    case 'project.member_invited':
      return `invited ${p.email}`;
    case 'project.member_joined':
      return `joined the project`;
    case 'project.member_removed':
      return `removed ${p.member ?? 'a member'}`;
    case 'project.member_role_changed':
      return `changed ${p.member ?? 'a member'} to ${p.role}`;
    case 'prompt.created':
      return `added prompt ${q(title)}`;
    case 'prompt.updated':
      return `edited prompt ${q(title)}`;
    case 'prompt.visibility_changed':
      return `changed visibility of prompt ${q(title)}`;
    case 'timer.started':
      return `started a timer${title ? ` on ${q(title)}` : ''}`;
    case 'timer.stopped':
      return `stopped a timer${title ? ` on ${q(title)}` : ''}`;
    case 'share.created':
      return `shared ${p.task_count ?? ''} task(s)`;
    case 'share.opened':
      return `opened a shared link`;
    case 'share.guest_identified':
      return `identified as a guest`;
    case 'share.task_completed':
      return `completed ${q(title)} via share link`;
    case 'share.task_reopened':
      return `reopened ${q(title)} via share link`;
    default:
      return item.name.replace('.', ' ');
  }
}
