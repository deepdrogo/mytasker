export type ID = number;
export type ISODateTime = string;
export type ISODate = string;

export type Priority = 'critical' | 'high' | 'normal' | 'low';
export type Visibility = 'private' | 'group';
export type TaskKind = 'personal' | 'business' | 'crypto';
/** `list` tasks belong to the Personal/Business lists (optionally linked to a project); `project` tasks live only in their project. */
export type TaskOrigin = 'list' | 'project';
export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'cancelled';
export type ProjectKind = 'project' | 'active';
export type ProjectCategory = 'general' | 'startup';
export type ProjectMode = 'private' | 'group' | 'group_plus';
export type ProjectStatus = 'planned' | 'active' | 'paused' | 'completed' | 'archived';
export type Role = 'owner' | 'admin' | 'member' | 'viewer';
export type RoutineKind = 'personal' | 'business';
export type TimeCategory = 'personal' | 'business';
export type Source =
  | 'web'
  | 'mobile_web'
  | 'telegram'
  | 'team'
  | 'share_link'
  | 'ai_web'
  | 'ai_telegram'
  | 'system';

export interface UserPreferences {
  first_day_of_week: number;
  time_format: '24h' | '12h';
  default_task_type: TaskKind;
  default_reminder_minutes: number;
  business_hours_target_minutes: number;
  sleep_target_minutes: number;
  planned_bedtime: string | null;
  planned_wake_time: string | null;
  morning_summary_enabled: boolean;
  morning_summary_time: string;
  evening_summary_enabled: boolean;
  evening_summary_time: string;
  weekly_review_enabled: boolean;
  monthly_review_enabled: boolean;
  /** Run the everyday routine on Saturday and Sunday too. Off: routine pauses, rules still count. */
  routine_on_weekends: boolean;
}

export interface NotificationPreferences {
  mode: 'important' | 'all' | 'custom';
  telegram_enabled: boolean;
  in_app_enabled: boolean;
  on_task_created: boolean;
  on_task_completed: boolean;
  on_task_reopened: boolean;
  on_subtask_created: boolean;
  on_subtask_completed: boolean;
  on_comment_created: boolean;
  on_deadline_changed: boolean;
  on_assignment_changed: boolean;
  on_member_joined: boolean;
  on_member_removed: boolean;
  on_share_task_completed: boolean;
  on_share_opened: boolean;
  on_reminder: boolean;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
}

export interface Me {
  id: ID;
  email: string;
  full_name: string;
  display_name: string;
  timezone: string;
  locale: string;
  email_verified: boolean;
  telegram_linked: boolean;
  is_staff: boolean;
  /** Server-computed: provider configured AND this user is an administrator. */
  ai_enabled: boolean;
  /** Restricted login that only adds tasks on behalf of `principal`. */
  is_assistant: boolean;
  principal: UserRef | null;
  created_at: ISODateTime;
  preferences: UserPreferences;
  notification_preferences: NotificationPreferences;
}

export interface Assistant {
  id: ID;
  email: string;
  full_name: string;
  display_name: string;
  is_active: boolean;
  last_seen_at: ISODateTime | null;
  created_at: ISODateTime;
  tasks_created: number;
  /** Only present right after creation / password reset. Shown once, never stored. */
  password?: string;
}

export interface PublicConfig {
  require_email_verification: boolean;
  telegram_bot_username: string;
  /** Server-level availability only - use `authStore.aiEnabled()` for per-user access. */
  ai_enabled: boolean;
  ai_admins_only: boolean;
  site_url: string;
}

export interface UserRef {
  id: ID;
  display_name: string;
  email?: string;
}

export interface ProjectRef {
  id: ID;
  name: string;
  kind: ProjectKind;
  mode: ProjectMode;
}

export interface Task {
  id: ID;
  kind: TaskKind;
  origin: TaskOrigin;
  title: string;
  description: string;
  notes: string;
  status: TaskStatus;
  priority: Priority;
  visibility: Visibility;
  project: ProjectRef | null;
  parent: ID | null;
  assignee: UserRef | null;
  owner: UserRef;
  /** Who added the task; differs from `owner` for assistant-created and member-created tasks. */
  created_by: UserRef | null;
  start_at: ISODateTime | null;
  due_at: ISODateTime | null;
  due_has_time: boolean;
  reminder_at: ISODateTime | null;
  estimated_minutes: number | null;
  /** Long-term work: ticked once a day, completed only when the whole thing is finished. */
  is_ongoing: boolean;
  today_checked: boolean;
  /** Deliberately skipped today (recorded, breaks the streak). */
  today_skipped: boolean;
  /** All-time tally of daily check-ins: days done vs days skipped on purpose. */
  checkin_done_count: number;
  checkin_skipped_count: number;
  checkin_streak: number;
  tracked_seconds: number;
  tags: string[];
  sort_order: number;
  version: number;
  is_overdue: boolean;
  subtask_total: number;
  subtask_done: number;
  comment_count: number;
  completed_at: ISODateTime | null;
  completed_by: UserRef | null;
  completed_by_name: string | null;
  completion_source: Source | '';
  recurrence: RecurrenceRule | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
  can_edit: boolean;
  can_delete: boolean;
  /** Present when the list was requested with `include_subtasks=1` or on task detail. */
  subtasks?: Task[];
}

export interface RecurrenceRule {
  id?: ID;
  freq: 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'custom';
  interval: number;
  byweekday: number[];
  bymonthday: number | null;
  until: ISODate | null;
}

export interface Project {
  id: ID;
  name: string;
  description: string;
  kind: ProjectKind;
  category: ProjectCategory;
  mode: ProjectMode;
  status: ProjectStatus;
  priority: Priority;
  start_date: ISODate | null;
  deadline: ISODate | null;
  notes: string;
  owner: UserRef;
  role: Role | null;
  /** Percent of top-level tasks done; `null` until the project has at least one task. */
  progress: number | null;
  task_total: number;
  task_done: number;
  open_tasks: number;
  member_count: number;
  prompt_count: number;
  tracked_seconds: number;
  version: number;
  created_at: ISODateTime;
  updated_at: ISODateTime;
  capabilities: Record<string, boolean>;
}

export interface ProjectMember {
  id: ID;
  user: UserRef | null;
  invited_email: string;
  role: Role;
  accepted_at: ISODateTime | null;
  created_at: ISODateTime;
}

export interface Idea {
  id: ID;
  title: string;
  raw_text: string;
  improved_text: string;
  notes: string;
  category: string;
  priority: Priority;
  converted_project: ProjectRef | null;
  converted_at: ISODateTime | null;
  created_at: ISODateTime;
}

export interface PromptListItem {
  id: ID;
  title: string;
  snippet: string;
  description: string;
  category: string;
  tags: string[];
  project: ProjectRef | null;
  visibility: Visibility;
  is_favorite: boolean;
  is_archived: boolean;
  body_length: number;
  version: number;
  updated_at: ISODateTime;
  created_at: ISODateTime;
  is_owner: boolean;
}

export interface Prompt extends PromptListItem {
  body: string;
  created_by: UserRef | null;
  last_edited_by: UserRef | null;
  version_count: number;
  can_edit: boolean;
}

export interface PromptVersion {
  id: ID;
  number: number;
  title: string;
  snippet: string;
  edited_by: UserRef | null;
  created_at: ISODateTime;
}

export interface RoutineItem {
  id: ID;
  routine: ID;
  kind: RoutineKind;
  name: string;
  description: string;
  target_minutes: number;
  start_time: string | null;
  end_time: string | null;
  repeat_days: number;
  order: number;
  counts_as_business: boolean;
  is_active: boolean;
  today_completed: boolean;
  today_minutes: number;
}

export interface Rule {
  id: ID;
  text: string;
  description: string;
  order: number;
  is_enabled: boolean;
  /** Daily self-check: null = not checked today, true = kept, false = broken. */
  today_kept: boolean | null;
  /** Consecutive days kept (counted from yesterday when today is not checked yet). */
  streak: number;
}

export interface TimeEntry {
  id: ID;
  category: TimeCategory;
  project: ProjectRef | null;
  task: { id: ID; title: string } | null;
  routine_item: { id: ID; name: string } | null;
  started_at: ISODateTime;
  ended_at: ISODateTime | null;
  duration_seconds: number;
  note: string;
  is_manual: boolean;
  is_running: boolean;
  source: Source;
}

export interface SleepSession {
  id: ID;
  started_at: ISODateTime;
  ended_at: ISODateTime | null;
  duration_seconds: number;
  is_running: boolean;
  is_manual: boolean;
  note: string;
}

export interface Comment {
  id: ID;
  author: UserRef;
  body: string;
  task: ID | null;
  project: ID | null;
  edited_at: ISODateTime | null;
  created_at: ISODateTime;
  can_edit: boolean;
  can_delete: boolean;
}

export interface ActivityItem {
  id: ID;
  name: string;
  actor_display: string;
  actor_kind: 'user' | 'guest' | 'ai' | 'telegram' | 'system';
  source: Source;
  target_type: string;
  target_id: ID;
  project: ProjectRef | null;
  payload: Record<string, unknown>;
  created_at: ISODateTime;
}

export interface ShareLink {
  id: ID;
  title: string;
  url: string;
  token_prefix: string;
  requires_password: boolean;
  expires_at: ISODateTime | null;
  ask_guest_name: boolean;
  allow_complete: boolean;
  allow_reopen: boolean;
  one_time: boolean;
  max_uses: number | null;
  use_count: number;
  is_active: boolean;
  revoked_at: ISODateTime | null;
  last_opened_at: ISODateTime | null;
  task_count: number;
  created_at: ISODateTime;
}

export interface GuestTask {
  id: ID;
  title: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  due_at: ISODateTime | null;
  completed_at: ISODateTime | null;
  completed_by_name: string | null;
  subtasks: GuestTask[];
}

export interface GuestShareView {
  title: string;
  requires_password: boolean;
  ask_guest_name: boolean;
  allow_complete: boolean;
  allow_reopen: boolean;
  guest_name: string | null;
  authenticated: boolean;
  tasks: GuestTask[];
  expires_at: ISODateTime | null;
}

export interface AppNotification {
  id: ID;
  category: string;
  event_name: string;
  title: string;
  body: string;
  url: string;
  payload: Record<string, unknown>;
  read_at: ISODateTime | null;
  created_at: ISODateTime;
}

export interface DayMetrics {
  date: ISODate;
  tasks_planned: number;
  tasks_completed: number;
  tasks_missed: number;
  personal_completed: number;
  business_completed: number;
  team_completed: number;
  guest_completed: number;
  business_minutes: number;
  personal_minutes: number;
  business_target_minutes: number;
  sleep_minutes: number;
  sleep_target_minutes: number;
  routine_items_total: number;
  routine_items_completed: number;
  project_minutes: Record<string, number>;
  completion_rate: number;
  routine_rate: number;
  business_target_pct: number;
}

export interface PeriodTotals extends Omit<DayMetrics, 'date'> {
  active_days: number;
  avg_business_minutes: number;
  avg_sleep_minutes: number;
}

export interface TodayData {
  date: ISODate;
  now: ISODateTime;
  metrics: DayMetrics;
  streak: number;
  timer: { running: TimeEntry | null; sleep: SleepSession | null };
  tasks: {
    overdue: Task[];
    due_today: Task[];
    focus: Task[];
    ongoing: Task[];
    personal: Task[];
    business: Task[];
    upcoming: Task[];
    completed: Task[];
  };
  routine: {
    /** Weekend with the everyday routine switched off (Preferences); rules are unaffected. */
    paused: boolean;
    current_item_id: ID | null;
    business: RoutineItem[];
    personal: RoutineItem[];
  };
  rules: Rule[];
  active_projects: TodayProject[];
}

export interface TodayProject {
  id: ID;
  name: string;
  priority: Priority;
  kind: ProjectKind;
  category: ProjectCategory;
  status: ProjectStatus;
  deadline: ISODate | null;
  task_total: number | null;
  task_done: number | null;
  task_open: number | null;
  next_tasks: Array<{ id: ID; title: string; priority: Priority; due_at: ISODateTime | null; status: TaskStatus }>;
}

export interface DailyReview {
  date: ISODate;
  metrics: DayMetrics;
  previous: DayMetrics;
  projects: Record<string, string>;
}

export interface WeeklyReview {
  start_date: ISODate;
  end_date: ISODate;
  days: DayMetrics[];
  totals: PeriodTotals;
  previous_totals: PeriodTotals;
  projects: Record<string, string>;
}

export interface MonthlyReview extends WeeklyReview {
  weeks: Array<PeriodTotals & { start_date: ISODate; end_date: ISODate }>;
}

export interface TimeTotals {
  business: number;
  personal: number;
  total: number;
  sleep: number;
  start_date: ISODate;
  end_date: ISODate;
  by_project: Array<{ project_id: ID; seconds: number }>;
  by_task: Array<{ task_id: ID; seconds: number }>;
  by_routine_item: Array<{ routine_item_id: ID; seconds: number }>;
}

export interface AIToolCall {
  name: string;
  input: Record<string, unknown>;
  status?: 'ok' | 'error' | 'proposed';
  result?: unknown;
  error?: string;
}

export interface AIPending {
  tool: string;
  input: Record<string, unknown>;
  preview: { kind: string; items: string[]; summary: string };
}

export type AIActionStatus = 'pending' | 'proposed' | 'executed' | 'rejected' | 'failed';

export interface AICommandResult {
  action_id: ID;
  status: AIActionStatus;
  reply: string;
  tool_calls: AIToolCall[];
  pending_action_id: ID | null;
  pending: AIPending | null;
  changed: boolean;
}

export interface AIAction {
  id: ID;
  status: AIActionStatus;
  input_text: string;
  reply_text: string;
  tool_calls: AIToolCall[];
  result: Record<string, unknown>;
  requires_confirmation: boolean;
  error: string;
  source: Source;
  created_at: ISODateTime;
  duration_ms: number;
}

export interface SearchResults {
  tasks: Task[];
  projects: Project[];
  prompts: PromptListItem[];
  ideas: Idea[];
  routine_items: RoutineItem[];
}

export interface DonationAddress {
  id: ID;
  asset: string;
  network: string;
  address: string;
  memo: string;
  note: string;
}

export interface TelegramStatus {
  linked: boolean;
  username?: string;
  first_name?: string;
  bot_username: string;
  configured: boolean;
  linked_at?: ISODateTime | null;
  last_interaction_at?: ISODateTime | null;
}
