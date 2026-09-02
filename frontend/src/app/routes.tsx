import { Navigate, type RouteDefinition } from '@solidjs/router';
import { lazy } from 'solid-js';
import { AuthLayout } from '~/layouts/AuthLayout';
import { ProtectedLayout } from '~/app/ProtectedLayout';

const Today = lazy(() => import('~/routes/Today'));
const TasksPersonal = lazy(() => import('~/routes/tasks/Personal'));
const TasksBusiness = lazy(() => import('~/routes/tasks/Business'));
const TasksUpcoming = lazy(() => import('~/routes/tasks/Upcoming'));
const TasksCompleted = lazy(() => import('~/routes/tasks/Completed'));
const ProjectsActive = lazy(() => import('~/routes/projects/Active'));
const ProjectsAll = lazy(() => import('~/routes/projects/All'));
const Ideas = lazy(() => import('~/routes/projects/Ideas'));
const ProjectDetail = lazy(() => import('~/routes/projects/Detail'));
const Prompts = lazy(() => import('~/routes/prompts/List'));
const PromptDetail = lazy(() => import('~/routes/prompts/Detail'));
const RoutinePersonal = lazy(() => import('~/routes/routine/Personal'));
const RoutineBusiness = lazy(() => import('~/routes/routine/Business'));
const Rules = lazy(() => import('~/routes/routine/Rules'));
const InsightsDaily = lazy(() => import('~/routes/insights/Daily'));
const InsightsWeekly = lazy(() => import('~/routes/insights/Weekly'));
const InsightsMonthly = lazy(() => import('~/routes/insights/Monthly'));
const InsightsTime = lazy(() => import('~/routes/insights/Time'));
const AIPage = lazy(() => import('~/routes/AI'));
const Settings = lazy(() => import('~/routes/settings/Settings'));
const Donate = lazy(() => import('~/routes/Donate'));
const Login = lazy(() => import('~/routes/auth/Login'));
const Register = lazy(() => import('~/routes/auth/Register'));
const ForgotPassword = lazy(() => import('~/routes/auth/ForgotPassword'));
const ResetPassword = lazy(() => import('~/routes/auth/ResetPassword'));
const VerifyEmail = lazy(() => import('~/routes/auth/VerifyEmail'));
const SharePage = lazy(() => import('~/routes/share/SharePage'));
const Landing = lazy(() => import('~/routes/Landing'));
const NotFound = lazy(() => import('~/routes/NotFound'));

export const routes: RouteDefinition[] = [
  // Public landing; signed-in users are bounced straight to /today inside the component.
  { path: '/', component: Landing },
  {
    path: '/',
    component: ProtectedLayout,
    children: [
      { path: '/today', component: Today },
      { path: '/tasks', component: () => <Navigate href="/tasks/personal" /> },
      { path: '/tasks/personal', component: TasksPersonal },
      { path: '/tasks/business', component: TasksBusiness },
      { path: '/tasks/upcoming', component: TasksUpcoming },
      { path: '/tasks/completed', component: TasksCompleted },
      { path: '/projects', component: () => <Navigate href="/projects/active" /> },
      { path: '/projects/active', component: ProjectsActive },
      { path: '/projects/all', component: ProjectsAll },
      { path: '/projects/ideas', component: Ideas },
      { path: '/projects/:id/*tab', component: ProjectDetail },
      { path: '/prompts', component: Prompts },
      { path: '/prompts/:id', component: PromptDetail },
      { path: '/routine', component: () => <Navigate href="/routine/personal" /> },
      { path: '/routine/personal', component: RoutinePersonal },
      { path: '/routine/business', component: RoutineBusiness },
      { path: '/routine/rules', component: Rules },
      { path: '/insights', component: () => <Navigate href="/insights/daily" /> },
      { path: '/insights/daily', component: InsightsDaily },
      { path: '/insights/weekly', component: InsightsWeekly },
      { path: '/insights/monthly', component: InsightsMonthly },
      { path: '/insights/time', component: InsightsTime },
      { path: '/ai', component: AIPage },
      { path: '/donate', component: Donate },
      { path: '/settings/*section', component: Settings },
      { path: '/settings', component: Settings },
    ],
  },
  {
    path: '/auth',
    component: AuthLayout,
    children: [
      { path: '/', component: () => <Navigate href="/auth/login" /> },
      { path: '/login', component: Login },
      { path: '/register', component: Register },
      { path: '/forgot', component: ForgotPassword },
      { path: '/reset', component: ResetPassword },
      { path: '/verify', component: VerifyEmail },
    ],
  },
  { path: '/s/:token', component: SharePage },
  { path: '*404', component: NotFound },
];
