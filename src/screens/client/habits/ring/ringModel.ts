/**
 * HB-B1: the ring's words (section 11 ids beside each) and the pure maths for the tiles and the strip.
 * Runs, best runs and week counts come from the server (HB3); today's parts are Home's plannedToday.
 */
import type { ApiHabit } from '../../../../hooks/useApi';
import type { SegmentState } from '../../../../ui/charts/StyleCMarks';

export type Count = { planned: number; done: number };

/** A GET /habits row with HB1's plan and HB3's runs and week count. */
export type RingHabit = ApiHabit & {
  schedule_kind?: 'daily' | 'days' | 'times_per_week';
  schedule_days?: number[]; // 0 = Sunday ... 6 = Saturday
  times_per_week?: number | null;
  starts_on?: string | null;
  assigned_by_coach_id?: string | null;
  run_days?: number | null;
  best_run_days?: number | null;
  week?: Count;
};

/** GET /habits/summary?from&to (HB3): the client's today and each day's planned and done. */
export type HabitSummary = { today: string; days: (Count & { date: string })[] };

export const RING_COPY = {
  habits: 'Habits', // HB-S-012
  checkIn: 'Check-in', // HB-S-004
  today: 'Today', // HB-S-223
  tap: 'Tap a habit when it is done.', // HB-S-033
  addHabit: 'Add habit', // HB-S-002
  askCoach: (coach: string) => `Ask ${coach} for habits`, // HB-S-071
  fromCoach: (coach: string) => `Habits from ${coach}`, // HB-S-014
  coachCanAdd: (coach: string) => `${coach} can add habits for you, and you can add your own.`, // HB-S-029
  noHabitsYet: 'No habits yet', // HB-S-142 + HB-S-250
  failed: 'Habits did not load. Check your connection, then try again.', // HB-S-013
  tryAgain: 'Try again', // HB-S-039
  yourRing: 'Your ring', // HB-S-256
  startHere: 'Start here', // HB-S-198
  onePart: 'Each habit is one part of the ring. Start with one.', // HB-S-093
  ideas: 'Ideas to start with', // HB-S-115
  writeOwn: 'Write your own', // HB-S-247
  coachAdded: (coach: string) => `${coach} added`, // HB-S-028
  youAdded: 'You added', // HB-S-044
  of: (n: number, m: number) => `${n} of ${m}`, // HB-S-268
  thisWeek: (n: number, m: number) => `${n} of ${m} this week`, // HB-S-272
  daysInRow: (n: number) => `${n} days in a row`, // HB-S-048
  onItsDays: (n: number) => `${n} in a row on its days`, // HB-S-265
  openBest: (n: number) => `Open · best run ${n} days`, // HB-S-161
  doneBest: (n: number) => `Done · best run ${n} days`, // HB-S-088
  tile: (habit: string, done: boolean) => (done ? `${habit}, done today` : `${habit}, not done yet`), // HB-S-298
  ring: (n: number, m: number) => `Today, ${n} of ${m} habits done`, // HB-S-299
  day: (day: string, c: Count) => (c.planned ? `${day}, ${c.done} of ${c.planned} done` : day), // HB-S-300, HB-S-046
  loading: 'Loading habits', // today's QuietLoading label
  notSaved: 'The habit was not updated. Try again.', // today's tick failure line (HabitsScreen)
  notCreated: 'The habit was not created. Try again.', // today's create failure line (HabitsScreen)
} as const;

/** First run ideas, as drawn on B_first (HB-S-009, HB-S-205, HB-S-213 under each name). */
export const IDEAS = [
  { name: 'Drink 8 glasses of water', plan: { schedule_kind: 'daily' }, when: 'Every day' },
  { name: 'Walk 30 minutes', plan: { schedule_kind: 'daily' }, when: 'Every day' },
  { name: 'Lights out by 11', plan: { schedule_kind: 'days', schedule_days: [0, 1, 2, 3, 4] }, when: 'Sunday to Thursday' },
  { name: 'Stretch 10 minutes', plan: { schedule_kind: 'times_per_week', times_per_week: 3 }, when: 'Three days a week' },
] as const;

const at = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
const weekday = (ymd: string) => at(ymd).getUTCDay();
const fmt = (ymd: string, o: Intl.DateTimeFormatOptions) => at(ymd).toLocaleDateString('en-US', { ...o, timeZone: 'UTC' });
export const weekdayName = (ymd: string) => fmt(ymd, { weekday: 'long' }); // HB-S-241
export const weekdayLetter = (ymd: string) => fmt(ymd, { weekday: 'narrow' });
export const dayOfMonth = (ymd: string) => at(ymd).getUTCDate();
export const dayName = (ymd: string) => `${weekdayName(ymd)} ${dayOfMonth(ymd)}`; // HB-S-046
export const plusDays = (ymd: string, n: number) => new Date(at(ymd).getTime() + n * 86_400_000).toISOString().slice(0, 10);
/** The Monday of the week holding `ymd` (HB3 weeks run Monday to Sunday). */
export const mondayOf = (ymd: string) => plusDays(ymd, -((weekday(ymd) + 6) % 7));

/** Whether the server holds a done tick for the habit on `ymd`. */
export function doneOn(h: RingHabit, ymd: string): boolean {
  return !!h.logs?.some((l) => l.completed && l.date.slice(0, 10) === ymd);
}

/** The run line under a tile: a run from 2 days up, else the best run kept, else nothing. */
export function runLine(h: RingHabit, done: boolean): string | null {
  if (h.run_days) return h.schedule_kind === 'days' ? RING_COPY.onItsDays(h.run_days) : RING_COPY.daysInRow(h.run_days);
  if (h.best_run_days) return (done ? RING_COPY.doneBest : RING_COPY.openBest)(h.best_run_days);
  return null;
}

/** This week's count over every live habit, moved by the ticks still on their way. */
export function weekCount(habits: RingHabit[], today: string, shown: (h: RingHabit) => boolean): Count | null {
  if (!habits.some((h) => h.week)) return null;
  return habits.reduce<Count>((sum, h) => {
    if (!h.week) return sum;
    const done = h.week.done + Number(shown(h)) - Number(doneOn(h, today));
    return { planned: sum.planned + h.week.planned, done: sum.done + Math.min(h.week.planned, Math.max(0, done)) };
  }, { planned: 0, done: 0 });
}

/** One ring segment per part: done first, then missed (past days) or planned. */
export function segmentsOf(c: Count, past: boolean): SegmentState[] {
  return Array.from({ length: c.planned }, (_, i) => (i < c.done ? 'done' : past ? 'missed' : 'planned'));
}

/** Monday to Sunday around today. Today draws from the screen's own ring; the rest from the summary. */
export function weekStrip(summary: HabitSummary, today: string, todayCount: Count) {
  const monday = mondayOf(today);
  return Array.from({ length: 7 }, (_, i) => {
    const date = plusDays(monday, i);
    const count = date === today ? todayCount : summary.days.find((d) => d.date === date) ?? { planned: 0, done: 0 };
    return { date, count, isToday: date === today, segments: segmentsOf(count, date < today) };
  });
}
