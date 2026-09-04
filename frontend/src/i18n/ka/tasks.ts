// Georgian UI strings — tasks feature (editor, list page). Keys are the English source strings.
export const tasks: Record<string, string> = {
  // Task editor drawer
  Task: 'დავალება',
  'Delete task': 'დავალების წაშლა',
  Reopen: 'დაბრუნება',
  Complete: 'დასრულება',
  Timer: 'ტაიმერი',
  'Tracked {tracked}': 'აღრიცხულია {tracked}',
  'Tracked {tracked} of {estimate} estimated': 'აღრიცხულია {tracked} შეფასებული {estimate}-დან',
  Title: 'სათაური',
  Description: 'აღწერა',
  Priority: 'პრიორიტეტი',
  'Estimate (min)': 'შეფასება (წთ)',
  Due: 'ვადა',
  Reminder: 'შეხსენება',
  'Due at a specific time': 'ვადა კონკრეტულ დროზე',
  Project: 'პროექტი',
  Visibility: 'ხილვადობა',
  'Private tasks in a Group Plus project stay invisible to members.':
    'Group Plus პროექტში პირადი დავალებები წევრებისთვის უხილავი რჩება.',
  'Visible to project members': 'ხილულია პროექტის წევრებისთვის',
  'Private to me': 'მხოლოდ ჩემთვის',
  Repeat: 'გამეორება',
  'Does not repeat': 'არ მეორდება',
  Weekdays: 'სამუშაო დღეები',
  'The next occurrence is created when you complete this task.':
    'შემდეგი გამეორება ამ დავალების დასრულებისას შეიქმნება.',
  Notes: 'შენიშვნები',
  Subtasks: 'ქვედავალებები',
  'Add a subtask…': 'დაამატე ქვედავალება…',
  Comments: 'კომენტარები',
  'Created {date}': 'შეიქმნა {date}',
  'Completed by {name}': 'დაასრულა {name}',
  Saved: 'შენახულია',
  'Could not save the task.': 'დავალების შენახვა ვერ მოხერხდა.',
  'This task changed elsewhere. Close and reopen to get the latest.':
    'ეს დავალება სხვაგან შეიცვალა. დახურე და თავიდან გახსენი უახლესი ვერსიისთვის.',
  'Delete task?': 'წავშალოთ დავალება?',
  'The task and its subtasks will be removed.': 'დავალება და მისი ქვედავალებები წაიშლება.',

  // Task list page
  'Sort tasks': 'დავალებების დალაგება',
  Manual: 'ხელით',
  Deadline: 'ვადა',
  'Recently created': 'ბოლოს შექმნილი',
  'Recently updated': 'ბოლოს განახლებული',
  '{count} selected': '{count} მონიშნული',
  'Clear selection': 'მონიშვნის გასუფთავება',
  Previous: 'წინა',
  Next: 'შემდეგი',

  // Business
  'Work tasks across all projects.': 'სამუშაო დავალებები ყველა პროექტიდან.',
  'Work tasks you add here. Pick a project to file a task there as well.':
    'სამუშაო დავალებები, რომლებსაც აქ ამატებ. აირჩიე პროექტი და დავალება იქაც გამოჩნდება.',
  'Add a business task…': 'დაამატე სამუშაო დავალება…',
  'No open business tasks.': 'ღია სამუშაო დავალებები არ არის.',
  'Tasks created inside a project appear here as well.': 'პროექტში შექმნილი დავალებებიც აქ ჩანს.',
  'Add one above. Tasks created inside a project stay in that project.':
    'დაამატე ზემოთ. პროექტში შექმნილი დავალებები იმ პროექტში რჩება.',
  'Also file this task under a project': 'ეს დავალება პროექტშიც გამოჩნდეს',

  // AI polish
  'Polish with AI': 'AI-ით გასწორება',
  'Polish all with AI': 'ყველას გასწორება AI-ით',
  'Polish selected': 'მონიშნულების გასწორება',
  'Polish {title} with AI': 'AI-ით გასწორება: {title}',
  'Rewrite these titles so they are clear and specific': 'გადაწერე სათაურები გასაგებად და კონკრეტულად',
  'Rewritten: “{title}”': 'გადაიწერა: „{title}“',
  '{count} rewritten': 'გადაიწერა {count}',
  'Already clear - nothing to rewrite.': 'უკვე გასაგებია — გადასაწერი არაფერია.',
  'These tasks cannot be edited.': 'ამ დავალებების რედაქტირება შეუძლებელია.',
  Restored: 'აღდგა',
  'Could not restore the previous titles.': 'წინა სათაურების აღდგენა ვერ მოხერხდა.',

  // Bulk deadline
  'Selected tasks': 'მონიშნული დავალებები',
  'Set date': 'ვადის დაყენება',
  'Set deadline for selected tasks': 'მონიშნული დავალებების ვადის დაყენება',
  'Next Monday': 'შემდეგ ორშაბათს',
  'In a week': 'ერთ კვირაში',
  'Pick a date…': 'თარიღის არჩევა…',
  'Clear deadline': 'ვადის მოხსნა',
  Apply: 'გამოყენება',
  '{count} moved to {date}': '{count} გადავიდა {date}-ზე',
  'Deadline cleared for {count}': 'ვადა მოეხსნა: {count}',
  'Could not restore the previous deadlines.': 'წინა ვადების აღდგენა ვერ მოხერხდა.',
  'Could not change the deadline.': 'ვადის შეცვლა ვერ მოხერხდა.',

  // Personal
  'Life tasks, no project needed.': 'პირადი საქმეები, პროექტის გარეშე.',
  'Add a personal task…': 'დაამატე პირადი დავალება…',
  'Nothing personal pending.': 'პირადი დავალებები არ გელოდება.',
  'Add a task above or press N anywhere.': 'დაამატე დავალება ზემოთ ან დააჭირე N-ს ნებისმიერ ადგილას.',

  // Upcoming
  'Everything due after today.': 'ყველაფერი, რასაც დღეის შემდეგ აქვს ვადა.',
  'Nothing scheduled ahead.': 'წინ არაფერია დაგეგმილი.',
  'Tasks with a future deadline will show up here.': 'მომავალი ვადის დავალებები აქ გამოჩნდება.',

  // Completed
  'Done is done. Reopen anything by mistake.': 'რაც შესრულდა, შესრულდა. შემთხვევით დასრულებული დააბრუნე.',
  'No completed tasks yet.': 'დასრულებული დავალებები ჯერ არ არის.',

  // Bulk selection
  'Complete selected': 'მონიშნულების შესრულება',
  'Delete selected': 'მონიშნულების წაშლა',
  'Delete {count}?': 'წავშალო {count}?',
  'Subtasks are deleted together with their parent. This cannot be undone.': 'ქვედავალებები მშობელთან ერთად იშლება. ეს ვერ დაბრუნდება.',
  'Select all {count}': 'ყველას მონიშვნა ({count})',
  '{count} completed': '{count} შესრულდა',
  '{count} completed, {skipped} skipped': '{count} შესრულდა, {skipped} გამოტოვდა',
  '{count} deleted': '{count} წაიშალა',
  '{count} deleted, {skipped} skipped': '{count} წაიშალა, {skipped} გამოტოვდა',
  'Could not update task.': 'დავალების განახლება ვერ მოხერხდა.',
  'Polish subtasks': 'ქვედავალებების გასწორება',

  // Canvas
  'All tasks': 'ყველა დავალება',
  'Personal, business and projects on one canvas.': 'პირადი, ბიზნესი და პროექტები ერთ ტილოზე.',
  'No open tasks.': 'ღია დავალებები არ არის.',
  '{done}/{total} subtasks': '{done}/{total} ქვედავალება',
  'Add a task to {name}…': 'დაამატე დავალება {name}-ში…',
  'Due tomorrow': 'ვადა ხვალ',
  'Delete subtask': 'ქვედავალების წაშლა',
  'Subtask deleted': 'ქვედავალება წაიშალა',

  // Long-term (ongoing) tasks
  'Long-term work - tick it daily, complete when finished': 'გრძელვადიანი საქმე - ყოველდღე მონიშნე, დაასრულე როცა მთლიანად მორჩები',
  'Long-term work - ticked daily': 'გრძელვადიანი საქმე - ყოველდღიური ჩეკი',
  'Check in for today': 'დღევანდელი ჩეკი',
  'Checked in today': 'დღეს ჩეკი გაკეთებულია',
  'Checked in for today': 'დღევანდელი ჩეკი გაკეთდა',
  'Undo today’s check-in': 'დღევანდელი ჩეკის გაუქმება',
  'Finish for good': 'საბოლოოდ დასრულება',
  'Daily check-ins': 'ყოველდღიური ჩეკები',

  // No date
  'No date': 'თარიღის გარეშე',
  'Open tasks without a deadline. Give them a day or let them go.': 'ღია დავალებები ვადის გარეშე. მიეცი დღე ან გაუშვი.',
  'Everything has a date.': 'ყველაფერს თარიღი აქვს.',
  'Tasks you add without a deadline will show up here.': 'ვადის გარეშე დამატებული დავალებები აქ გამოჩნდება.',

  // Today
  'Next 7 days': 'მომდევნო 7 დღე',
  'No business tasks pending.': 'ბიზნეს დავალებები არ არის.',
};
