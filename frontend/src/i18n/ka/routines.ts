// Georgian UI strings — routines feature. Keys are the English source strings.
export const routines: Record<string, string> = {
  // Page titles
  'Business Routine': 'სამუშაო რუტინა',
  'Your working day, block by block': 'შენი სამუშაო დღე, ბლოკ-ბლოკ',
  'Personal Routine': 'პირადი რუტინა',
  'The blocks that keep you healthy and sane': 'ბლოკები, რომლებიც ჯანმრთელსა და წონასწორობაში გინარჩუნებს',

  // Routine list
  'Today only': 'მხოლოდ დღეს',
  'All items': 'ყველა ბლოკი',
  '{total} done today': '{total} შესრულდა დღეს',
  'Could not load the routine.': 'რუტინის ჩატვირთვა ვერ მოხერხდა.',
  'Could not update.': 'განახლება ვერ მოხერხდა.',
  'Could not delete.': 'წაშლა ვერ მოხერხდა.',
  'No routine items yet': 'რუტინის ბლოკები ჯერ არ არის',
  'Nothing scheduled today': 'დღეს არაფერია დაგეგმილი',
  'A routine is the shape of your day: blocks with a time window and a target.': 'რუტინა შენი დღის ფორმაა: ბლოკები დროის ფანჯრითა და მიზნით.',
  'Add the first block': 'დაამატე პირველი ბლოკი',
  Now: 'ახლა',
  'Item actions': 'ბლოკის მოქმედებები',
  'Move up': 'ზემოთ ატანა',
  'Move down': 'ქვემოთ ჩამოტანა',
  More: 'მეტი',

  // Repeat schedule
  'Every day': 'ყოველდღე',
  Weekdays: 'სამუშაო დღეები',
  Weekends: 'შაბათ-კვირა',
  Never: 'არასდროს',
  Mon: 'ორშ',
  Tue: 'სამ',
  Wed: 'ოთხ',
  Thu: 'ხუთ',
  Fri: 'პარ',
  Sat: 'შაბ',
  Sun: 'კვი',

  // Block editor
  'Edit block': 'ბლოკის რედაქტირება',
  'New routine block': 'ახალი რუტინის ბლოკი',
  Name: 'სახელი',
  'Name is required.': 'სახელი აუცილებელია.',
  'Deep work': 'ღრმა მუშაობა',
  Description: 'აღწერა',
  'Target (minutes)': 'მიზანი (წუთი)',
  End: 'დასასრული',
  Repeat: 'გამეორება',
  'Time on this block counts as business time': 'ამ ბლოკზე დახარჯული დრო სამუშაო დროდ ითვლება',

  // Rules
  'Principles you have decided to live by. Not tasks.': 'პრინციპები, რომლებითაც გადაწყვიტე ცხოვრება. არა დავალებები.',
  'New rule, e.g. “No email before 10:00”': 'ახალი წესი, მაგ. „არანაირი ელფოსტა 10:00-მდე“',
  'New rule': 'ახალი წესი',
  'Could not save the rule.': 'წესის შენახვა ვერ მოხერხდა.',
  'Could not load rules.': 'წესების ჩატვირთვა ვერ მოხერხდა.',
  'No rules yet': 'წესები ჯერ არ არის',
  'Rules are the constraints that make the rest of the system work.': 'წესები ის შეზღუდვებია, რომლებიც სისტემის დანარჩენ ნაწილს ამუშავებს.',
  'Rule actions': 'წესის მოქმედებები',
  Disable: 'გამორთვა',
  Enable: 'ჩართვა',
  Rule: 'წესი',
  'Rule text is required.': 'წესის ტექსტი აუცილებელია.',
  Why: 'რატომ',
  'A sentence about the reason makes rules stick.': 'ერთი წინადადება მიზეზზე წესს უფრო მყარს ხდის.',
  Enabled: 'ჩართული',

  // Rules on Today
  'Kept today': 'დღეს დაცულია',
  'Broken today': 'დღეს დაირღვა',
  'Could not update the rule.': 'წესის განახლება ვერ მოხერხდა.',
  '{count} days in a row': '{count} დღე ზედიზედ',
  '{count} still to check today': 'დღეს კიდევ {count} შესამოწმებელია',
  now: 'ახლა',
  kept: 'დაცული',
  'All rules checked for today.': 'დღეს ყველა წესი შემოწმებულია.',

  // Weekends
  'Routine on weekends': 'რუტინა შაბათ-კვირას',
  'Off: the everyday routine pauses on Saturday and Sunday and does not count against you. Rules still apply every day. Blocks scheduled only for weekend days always show.':
    'გამორთული: ყოველდღიური რუტინა შაბათს და კვირას ისვენებს და სტატისტიკაში არ გითვლება. წესები ყოველდღე მოქმედებს. მხოლოდ შაბათ-კვირაზე დაგეგმილი ბლოკები მაინც ჩანს.',
  'Weekend - the routine takes the day off. Rules still count.': 'შაბათ-კვირაა - რუტინა ისვენებს. წესები მაინც ითვლება.',
  'Weekend - the routine takes the day off.': 'შაბათ-კვირაა - რუტინა ისვენებს.',
  'Rules still count. Turn on "Routine on weekends" in Preferences to run the routine on Saturday and Sunday.':
    'წესები მაინც ითვლება. რუტინა შაბათ-კვირასაც რომ მუშაობდეს, პარამეტრებში ჩართე „რუტინა შაბათ-კვირას“.',
};
