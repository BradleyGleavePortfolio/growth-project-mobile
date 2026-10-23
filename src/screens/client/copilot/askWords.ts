/**
 * Path Copilot turn words (style A board, planning/MOCKUP3/COPILOT/index.md; ids in comments) and the date lines
 * the week block composes. CP-A-10 and CP-A-12 are main's Roman words, reused as they are.
 */
import { calendarDateInZone, formatTime } from '../../../calendar/calendarTime';
import { resolveClientTimezone } from '../../../api/schedulingApi';
import type { CopilotWeek, SourceKind } from '../../../api/copilotApi';

export const ASK_COPY = {
  week: (n: number, coach: string) => `Week ${n} with ${coach}`, // CP-A-03
  target: 'Daily target, kcal', // CP-A-04
  changed: (weekday: string) => `Changed ${weekday}`, // CP-A-05
  workouts: 'Workouts this week', // CP-A-06
  checkIn: 'Last check-in', // CP-A-07
  of: (done: number, total: number) => `${done} of ${total}`,
  askHeading: 'Ask about your path', // CP-A-08
  whyCalories: 'Why did my calories change this week?', // CP-A-09
  hint: (coach: string) => `Roman answers from your plan, check-ins and logs. Changes go to ${coach} first.`, // CP-A-11
  targetChip: (kcal: string) => `${kcal} kcal target`, // CP-A-13
  workoutsChip: (done: number, total: number) => `${done} of ${total} workouts`, // CP-A-13
  youAsked: (time: string) => `You asked · ${time}`, // CP-A-14
  fromData: 'From your data', // CP-A-15
  roman: 'Roman',
  none: '—',
} as const;

/** CP-A-16 tag words and colours (the board's four source colours from the Forest Pop palette). */
export const SOURCE_TAG: Record<SourceKind, string> = {
  plan: 'Plan',
  check_in: 'Check-in',
  food_log: 'Food log',
  workout_log: 'Workout log',
};

const tz = () => resolveClientTimezone();
const day = (ymd: string) => Date.parse(`${ymd}T00:00:00Z`) / 86_400_000;
const fmt = (o: Intl.DateTimeFormatOptions, at: Date, zone = tz()) => new Intl.DateTimeFormat('en-GB', { timeZone: zone, ...o }).format(at);

/** "Mon" when `from` falls in this local week (Monday to Sunday), else null (CP-A-05 shows only for this week's change). */
export function changedThisWeek(from: string, now = new Date()): string | null {
  const today = calendarDateInZone(now, tz());
  const monday = day(today) - ((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7);
  const d = day(calendarDateInZone(new Date(from), tz()));
  return d >= monday && d <= day(today) ? fmt({ weekday: 'short' }, new Date(from)) : null;
}

/** CP-A-05 and CP-A-09 only for a real change this week: a first target (no previous) or the same number is not one. */
export function targetChangedOn(target: CopilotWeek['target'], now?: Date): string | null {
  return target && target.previous != null && target.previous !== target.kcal ? changedThisWeek(target.from, now) : null;
}

/** "18 Oct" for a YYYY-MM-DD day (a calendar day, so no zone shift). */
export const dayMonth = (ymd: string) => fmt({ day: 'numeric', month: 'short' }, new Date(`${ymd}T12:00:00Z`), 'UTC');
/** "2:31 PM" in the client's zone (CP-A-14). */
export const timeOf = (at: Date) => formatTime(at, tz());

/** Roman cites facts as [n]; the board draws plain prose with the facts listed under it, so the markers come out here. */
export const withoutCites = (text: string) => text.replace(/\s?\[\d{1,2}\]/g, '').trim();
/** Emphasis markers come out and "- " / "* " list lines get main's bullet, as in main's Roman chat (`romanBlocks`). */
export const withoutEmphasis = (text: string) => text.replace(/\*\*|__/g, '').replace(/^[ \t]*[-*][ \t]+/gm, '\u2022 ');

/** The board's answer: the first sentence as the serif lead line, the rest under it. */
export function leadAndRest(text: string): { lead: string; rest: string } {
  const m = /^(.+?[.!?])\s+(\S[\s\S]*)$/.exec(text);
  return m ? { lead: m[1], rest: m[2] } : { lead: text, rest: '' };
}
