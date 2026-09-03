// Georgian UI strings — ai feature (chat, slide-over panel, task tools, action preview, /ai page).
// Keys are the English source strings.
export const ai: Record<string, string> = {
  // Chat suggestions
  'What should I focus on today?': 'რაზე უნდა გავამახვილო ყურადღება დღეს?',
  'What is overdue right now?': 'რა არის ვადაგადაცილებული ახლა?',
  'Add "Review invoices" for tomorrow 10:00, business': 'დაამატე „ინვოისების გადახედვა“ ხვალ 10:00-ზე, ბიზნესი',
  'Complete everything I finished about the website': 'დაასრულე ყველაფერი, რაც ვებსაიტზე დავამთავრე',
  'Start a business timer': 'ჩართე ბიზნეს ტაიმერი',
  'Plan my day': 'დამიგეგმე დღე',

  // Chat
  'Done.': 'შესრულდა.',
  'AI is unavailable right now.': 'AI ამჟამად მიუწვდომელია.',
  'Confirmed.': 'დადასტურდა.',
  'Could not confirm.': 'დადასტურება ვერ მოხერხდა.',
  'Cancelled.': 'გაუქმდა.',
  'What can I do for you?': 'რით შემიძლია დაგეხმარო?',
  'Add, complete, reschedule and find tasks, start timers, create projects or plan the day — in plain language.':
    'დაამატე, დაასრულე, გადაანაცვლე და მოძებნე დავალებები, ჩართე ტაიმერი, შექმენი პროექტები ან დაგეგმე დღე — ჩვეულებრივი ენით.',
  'Ask or instruct…': 'ჰკითხე ან დაავალე…',
  'AI command': 'AI ბრძანება',
  Send: 'გაგზავნა',
  'to send': 'გაგზავნა',
  'for a new line': 'ახალი ხაზი',
  'destructive actions ask first': 'სარისკო მოქმედებები წინასწარ დასტურს ითხოვს',

  // Slide-over panel
  'AI is not configured on this server. Add an Anthropic API key in the backend environment to enable it.':
    'AI ამ სერვერზე კონფიგურირებული არ არის. ჩასართავად დაამატე Anthropic API გასაღები backend-ის გარემოში.',
  'The AI assistant is available to administrators only.': 'AI ასისტენტი მხოლოდ ადმინისტრატორებისთვისაა ხელმისაწვდომი.',
  'Natural language → real actions. Destructive steps ask first.': 'ბუნებრივი ენა → რეალური მოქმედებები. სარისკო ნაბიჯები წინასწარ დასტურს ითხოვს.',
  'Open full page': 'სრულ გვერდზე გახსნა',

  // Task tools (Improve / Break down)
  'AI request failed.': 'AI მოთხოვნა ვერ შესრულდა.',
  '{count} added': 'დაემატა {count}',
  Improve: 'გაუმჯობესება',
  'Break down': 'დაშლა',
  Suggested: 'შემოთავაზებული',
  Title: 'სათაური',
  Description: 'აღწერა',
  Use: 'გამოყენება',
  'Possible subtasks': 'შესაძლო ქვედავალებები',
  Dismiss: 'დახურვა',
  'Proposed subtasks': 'შემოთავაზებული ქვედავალებები',
  'Add {count}': 'დაამატე {count}',
  subtask: 'ქვედავალება',
  '{minutes}m': '{minutes} წთ',

  // Tool trace labels
  'Looked up tasks': 'დავალებების მოძიება',
  'Checked today': 'დღევანდელი დღის შემოწმება',
  Searched: 'ძიება',
  'Listed projects': 'პროექტების ჩამონათვალი',
  'Created task': 'დავალება შეიქმნა',
  'Added subtasks': 'ქვედავალებები დაემატა',
  'Updated task': 'დავალება განახლდა',
  'Completed task': 'დავალება დასრულდა',
  'Completed tasks': 'დასრულებული დავალებები',
  'Reopened task': 'დავალება დაბრუნდა',
  'Deleted task': 'დავალება წაიშალა',
  'Started timer': 'ტაიმერი ჩაირთო',
  'Stopped timer': 'ტაიმერი გაჩერდა',
  'Created project': 'პროექტი შეიქმნა',
  'Saved idea': 'იდეა შეინახა',
  'Added comment': 'კომენტარი დაემატა',
  action: 'მოქმედება',
  'needs confirmation': 'საჭიროებს დადასტურებას',
  'Confirm AI action': 'AI მოქმედების დადასტურება',
  '+{count} more': 'და კიდევ {count}',

  // /ai page
  'Could not plan the day.': 'დღის დაგეგმვა ვერ მოხერხდა.',
  'Talk to your workspace. Safe actions run instantly; destructive ones ask first.':
    'ესაუბრე შენს სამუშაო სივრცეს. უსაფრთხო მოქმედებები მყისიერად სრულდება, სარისკოები კი წინასწარ დასტურს ითხოვს.',
  History: 'ისტორია',
  'Administrators only': 'მხოლოდ ადმინისტრატორებისთვის',
  'The AI assistant is available to administrator accounts. Ask an administrator if you need access.':
    'AI ასისტენტი მხოლოდ ადმინისტრატორის ანგარიშებისთვისაა ხელმისაწვდომი. წვდომისთვის მიმართე ადმინისტრატორს.',
  'AI is not configured': 'AI კონფიგურირებული არ არის',
  'Set ANTHROPIC_API_KEY in the backend environment and restart the API to enable the assistant.':
    'ასისტენტის ჩასართავად backend-ის გარემოში დააყენე ANTHROPIC_API_KEY და გადატვირთე API.',
  'Plan for today': 'დღევანდელი გეგმა',
  'Suggested to defer': 'გადადება რეკომენდებულია',
  'AI history': 'AI ისტორია',
  'No AI actions yet.': 'AI მოქმედებები ჯერ არ არის.',
  pending: 'მოლოდინში',
  proposed: 'შემოთავაზებული',
  executed: 'შესრულებული',
  rejected: 'უარყოფილი',
  failed: 'წარუმატებელი',
};
