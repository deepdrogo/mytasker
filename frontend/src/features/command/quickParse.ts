import type { Priority, TaskKind } from '~/types';

export interface QuickParse {
  title: string;
  priority?: Priority;
  kind?: TaskKind;
  due_at?: string | null;
  due_has_time?: boolean;
  projectHint?: string;
  tags: string[];
}

const PRIORITY_TOKENS: Record<string, Priority> = {
  '!!!': 'critical',
  '!!': 'high',
  '!': 'normal',
  '!low': 'low',
  '!high': 'high',
  '!critical': 'critical',
  '!normal': 'normal',
};

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function atTime(date: Date, hhmm: string | undefined): { date: Date; hasTime: boolean } {
  if (!hhmm) {
    date.setHours(23, 59, 0, 0);
    return { date, hasTime: false };
  }
  const match = /^(\d{1,2})(?::(\d{2}))?(am|pm)?$/i.exec(hhmm);
  if (!match) {
    date.setHours(23, 59, 0, 0);
    return { date, hasTime: false };
  }
  let hours = Number(match[1]);
  const minutes = Number(match[2] ?? 0);
  const suffix = match[3]?.toLowerCase();
  if (suffix === 'pm' && hours < 12) hours += 12;
  if (suffix === 'am' && hours === 12) hours = 0;
  date.setHours(hours, minutes, 0, 0);
  return { date, hasTime: true };
}

/**
 * Lightweight client-side parsing for quick add. The backend still validates everything.
 *   "Call Anna tomorrow 15:00 !! #website @business ~design"
 */
export function quickParse(raw: string): QuickParse {
  let text = ` ${raw.trim()} `;
  const result: QuickParse = { title: '', tags: [] };

  for (const [token, priority] of Object.entries(PRIORITY_TOKENS).sort((a, b) => b[0].length - a[0].length)) {
    const re = new RegExp(`\\s${token.replace(/[!]/g, '\\!')}(?=\\s)`, 'i');
    if (re.test(text)) {
      result.priority = priority;
      text = text.replace(re, ' ');
      break;
    }
  }

  const kindMatch = /\s@(personal|business|work|crypto|cryptoworld|p|b|c)(?=\s)/i.exec(text);
  if (kindMatch) {
    const k = kindMatch[1]!.toLowerCase();
    if (k === 'p' || k === 'personal') result.kind = 'personal';
    else if (k === 'c' || k === 'crypto' || k === 'cryptoworld') result.kind = 'crypto';
    else result.kind = 'business';
    text = text.replace(kindMatch[0], ' ');
  }

  const projectMatch = /\s#([\w-]+)(?=\s)/.exec(text);
  if (projectMatch) {
    result.projectHint = projectMatch[1]!.toLowerCase();
    text = text.replace(projectMatch[0], ' ');
  }

  text = text.replace(/\s~([\w-]+)(?=\s)/g, (_, tag: string) => {
    result.tags.push(tag);
    return ' ';
  });

  const now = new Date();
  const timeRe = '(?:\\s+(?:at\\s+)?(\\d{1,2}(?::\\d{2})?(?:am|pm)?))?';
  const patterns: Array<[RegExp, (m: RegExpExecArray) => Date | null]> = [
    [new RegExp(`\\s(today)${timeRe}(?=\\s)`, 'i'), () => new Date(now)],
    [
      new RegExp(`\\s(tomorrow|tmr)${timeRe}(?=\\s)`, 'i'),
      () => {
        const d = new Date(now);
        d.setDate(d.getDate() + 1);
        return d;
      },
    ],
    [
      new RegExp(`\\s(?:next\\s+)?(${WEEKDAYS.join('|')}|mon|tue|wed|thu|fri|sat|sun)${timeRe}(?=\\s)`, 'i'),
      (m) => {
        const name = m[1]!.toLowerCase();
        const target = WEEKDAYS.findIndex((d) => d.startsWith(name.slice(0, 3)));
        if (target < 0) return null;
        const d = new Date(now);
        let delta = (target - d.getDay() + 7) % 7;
        if (delta === 0 || /next/i.test(m[0])) delta = delta === 0 ? 7 : delta;
        d.setDate(d.getDate() + delta);
        return d;
      },
    ],
    [
      new RegExp(`\\s(\\d{4}-\\d{2}-\\d{2})${timeRe}(?=\\s)`),
      (m) => {
        const d = new Date(`${m[1]}T00:00:00`);
        return Number.isNaN(d.getTime()) ? null : d;
      },
    ],
    [
      new RegExp(`\\s(\\d{1,2})[./](\\d{1,2})${timeRe}(?=\\s)`),
      (m) => {
        const d = new Date(now.getFullYear(), Number(m[2]) - 1, Number(m[1]));
        if (d < now) d.setFullYear(d.getFullYear() + 1);
        return d;
      },
    ],
    [
      new RegExp(`\\sin\\s+(\\d+)\\s*(d|days?|w|weeks?|h|hours?)(?=\\s)`, 'i'),
      (m) => {
        const n = Number(m[1]);
        const unit = m[2]!.toLowerCase();
        const d = new Date(now);
        if (unit.startsWith('d')) d.setDate(d.getDate() + n);
        else if (unit.startsWith('w')) d.setDate(d.getDate() + n * 7);
        else {
          d.setHours(d.getHours() + n);
          result.due_has_time = true;
        }
        return d;
      },
    ],
  ];

  for (const [re, build] of patterns) {
    const match = re.exec(text);
    if (!match) continue;
    const base = build(match);
    if (!base) continue;
    const timeToken = match[match.length - 1];
    if (result.due_has_time) {
      result.due_at = base.toISOString();
    } else {
      const { date, hasTime } = atTime(base, timeToken);
      result.due_at = date.toISOString();
      result.due_has_time = hasTime;
    }
    text = text.replace(match[0], ' ');
    break;
  }

  result.title = text.replace(/\s+/g, ' ').trim();
  return result;
}
