/** Pages the inline search can jump to. Labels are English keys (translated at render); keywords help Georgian typing. */
export interface NavTarget {
  id: string;
  label: string;
  href: string;
  keywords?: string;
  adminOnly?: boolean;
}

export const NAV_TARGETS: NavTarget[] = [
  { id: 'dashboard', label: 'Dashboard', href: '/dashboard', keywords: 'home overview დეშბორდი' },
  { id: 'today', label: 'Today', href: '/today', keywords: 'due today დღეს' },
  { id: 'tomorrow', label: 'Tomorrow', href: '/tomorrow', keywords: 'ხვალ' },
  { id: 'clients', label: 'Clients', href: '/tasks/clients', keywords: 'client customer კლიენტი კლიენტები' },
  { id: 'people', label: 'People', href: '/people', keywords: 'delegate assign ხალხი ასისტენტი', adminOnly: true },
  { id: 'all-tasks', label: 'All tasks', href: '/tasks/all', keywords: 'canvas ყველა დავალება' },
  { id: 'personal', label: 'Personal tasks', href: '/tasks/personal', keywords: 'პირადი' },
  { id: 'business', label: 'Business tasks', href: '/tasks/business', keywords: 'work ბიზნესი სამუშაო' },
  { id: 'crypto', label: 'Crypto world tasks', href: '/tasks/crypto', keywords: 'crypto კრიპტო კრიპტოსამყარო' },
  { id: 'upcoming', label: 'Upcoming', href: '/tasks/upcoming', keywords: 'მომავალი' },
  { id: 'no-date', label: 'No date', href: '/tasks/no-date', keywords: 'undated backlog თარიღის გარეშე' },
  { id: 'completed', label: 'Completed tasks', href: '/tasks/completed', keywords: 'done დასრულებული' },
  { id: 'projects', label: 'Active projects', href: '/projects/active', keywords: 'პროექტები აქტიური' },
  { id: 'all-projects', label: 'All projects', href: '/projects/all', keywords: 'ყველა პროექტი' },
  { id: 'canvas', label: 'Canvas', href: '/projects/canvas', keywords: 'board columns' },
  { id: 'startups', label: 'Startups', href: '/projects/startups', keywords: 'სტარტაპი' },
  { id: 'ideas', label: 'Project ideas', href: '/projects/ideas', keywords: 'იდეები' },
  { id: 'prompts', label: 'Prompt library', href: '/prompts', keywords: 'პრომპტები' },
  { id: 'routine', label: 'Personal routine', href: '/routine/personal', keywords: 'რუტინა' },
  { id: 'routine-b', label: 'Business routine', href: '/routine/business', keywords: 'სამუშაო რუტინა' },
  { id: 'rules', label: 'Rules', href: '/routine/rules', keywords: 'წესები' },
  { id: 'insights', label: 'Insights', href: '/insights/daily', keywords: 'analytics review ანალიტიკა' },
  { id: 'time', label: 'Time tracking', href: '/insights/time', keywords: 'timer entries დრო' },
  { id: 'settings', label: 'Settings', href: '/settings', keywords: 'preferences telegram account პარამეტრები' },
];
