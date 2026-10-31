/**
 * @jest-environment ./src/__tests__/helpers/lsWorkoutPacific187.cjs
 */
/**
 * WK-1-M R4 (LS-WORKOUT B3/B4/B5, class-first): one day rule for every
 * workout and every assignment, read the same way everywhere.
 *
 * - A workout counts on the client's local day it began (saved as `date`).
 * - An assignment counts on the local day it was assigned for (`scheduled_for`).
 * - A server calendar date ("YYYY-MM-DD" or that day at UTC midnight) is a day,
 *   never moved into local time; a real instant is the local day it falls on.
 *
 * Part 1 pins the rule in Pacific time, where UTC midnight is the evening
 * before. Part 2 lists every place the phone saves or reads one of these
 * days, checks each goes through utils/workout/workoutDay, and that none still
 * carries one of the old wrong patterns. Part 3 fails when a new product
 * file starts reading `scheduled_for` or the day helpers without being added
 * to the list, so the list stays the whole class.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  assignmentDay,
  calendarDay,
  dayStart,
  instantDay,
  workoutDay,
  workoutStartDay,
} from '../utils/workout/workoutDay';

const ROOT = path.resolve(__dirname, '..', '..');
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8');

describe('the day rule (Pacific time)', () => {
  it.each([
    ['a calendar date stays the day it names', () => calendarDay('2026-10-26'), '2026-10-26'],
    ['a calendar date sent as UTC midnight stays that day', () => calendarDay('2026-10-26T00:00:00.000Z'), '2026-10-26'],
    ['an instant is the local day it falls on', () => instantDay('2026-10-26T03:00:00.000Z'), '2026-10-25'],
    ['an unreadable value is no day', () => calendarDay('not a day'), ''],
    ['no value is no day', () => instantDay(undefined), ''],
    ['a workout begun at 23:50 keeps its start day', () => workoutStartDay(Date.parse('2026-10-25T23:50:00-07:00')), '2026-10-25'],
    ['a workout counts on its date, not when it was stored', () => workoutDay({ date: '2026-10-25', created_at: '2026-10-26T07:30:00.000Z' }), '2026-10-25'],
    ['a workout date sent as UTC midnight is not the day before', () => workoutDay({ date: '2026-10-26T00:00:00.000Z' }), '2026-10-26'],
    ['a workout without a date counts on the local day it was stored', () => workoutDay({ date: null, created_at: '2026-10-26T03:00:00.000Z' }), '2026-10-25'],
    ['an assignment counts on its assigned day', () => assignmentDay({ scheduled_for: '2026-10-26T00:00:00.000Z' }), '2026-10-26'],
    ['an assignment without a day is no day', () => assignmentDay({}), ''],
  ])('%s', (_label, value, day) => {
    expect(value()).toBe(day);
  });

  it('dayStart is local midnight of the day, for labels and day steps', () => {
    const start = dayStart('2026-10-26');
    expect(start && [start.getFullYear(), start.getMonth(), start.getDate(), start.getHours()]).toEqual([2026, 9, 26, 0]);
    expect(dayStart('')).toBeNull();
  });
});

// Every save and every day read of a workout or an assignment. `uses` is the
// line that proves the file goes through the rule.
const SAVES_AND_READS: Array<[file: string, what: string, uses: RegExp]> = [
  // Saves
  ['src/screens/client/ActiveWorkoutScreen.tsx', 'Finish save: date is the local day the workout began', /date: workoutStartDay\(/],
  ['src/offline/models/WorkoutLog.ts', 'legacy queued row: date is the local day it was logged', /date: instantDay\(/],
  ['src/components/coach/ai-entry/ClientCopyBar.tsx', "coach assigns a client copy: scheduled_for is the coach's local today", /scheduled_for: getTodayString\(\)/],
  ['src/screens/coach/programs/ProgramAssignScreen.tsx', 'program start day (local picker) and the assigned span shown back', /calendarDay\(r\.first_scheduled_for\)/],
  // Client reads
  ['src/utils/workout/workoutDoneToday.ts', 'done today (Home, Train)', /workoutDay\(r\)/],
  ['src/screens/client/HomeScreen.tsx', 'Home: done today', /isWorkoutDoneToday\(rows, getTodayString\(\)\)/],
  ['src/components/home/rings/homeRings.ts', 'Home rings: workouts and assignments this week', /assignmentDay\(/],
  ['src/screens/client/train/TrainToday.tsx', "Train: today's coach workout, order and day label", /assignmentDay/],
  ['src/screens/client/WorkoutScreen.tsx', 'workout history: week counts, chart, day labels', /workoutDay\(/],
  ['src/screens/client/calendar/CalendarWeekScreen.tsx', 'calendar week: workouts and assignments per day', /assignmentDay\(/],
  ['src/screens/client/progress/progressV2.ts', 'progress: training week and workout days', /assignmentDay\(/],
  ['src/screens/client/progress/weekReview.ts', 'week review: workouts this week', /workoutDay\(/],
  ['src/screens/client/YouScreen.tsx', 'You: next coach workout day', /assignmentDay\(/],
  ['src/screens/client/ClientWorkoutViewerScreen.tsx', 'assigned plans: order and day label', /calendarDay\(/],
  ['src/components/tutorial/PlanExplanationCard.tsx', 'plan card: weekday of the assigned day', /calendarDay\(/],
  ['src/hooks/useApi.ts', 'weekly volume: workouts this week', /workoutDay\(/],
  // Coach reads
  ['src/utils/workout/workoutLogging.ts', "coach view: each session's recorded day", /day: workoutDay\(s\)/],
  ['src/screens/coach/client-detail/WorkoutsTab.tsx', 'coach workouts tab: week count, trend, day labels', /s\.day \|\| instantDay\(/],
  ['src/screens/coach/client-detail/useClientDetailData.ts', 'coach client detail: weekly workouts', /workoutDay\(/],
  ['src/utils/coach/clientPeek.ts', 'coach peek: last workout and next assignment', /assignmentDay\(/],
];

const RULE_IMPORT = /from ['"](?:\.{1,2}\/)+(?:[\w-]+\/)*workoutDay['"]/;

// The wrong ways this class used to read a day; none may come back.
const OLD_PATTERNS: Array<[what: string, pattern: RegExp]> = [
  ['an assigned day moved through local time', /(?:new Date|Date\.parse)\([^)]*scheduled_for/],
  ['a stored day bucketed as an instant', /bucketDateLocal\(\s*new Date\([^)]*\.(?:date|scheduled_for)\b/],
  ['a stored day parsed as an instant', /new Date\(\s*\w+\??\.(?:date|scheduled_for)\s*\)/],
  ['the stored-at time preferred over the recorded day', /(?:date:\s*|\(\s*)\w+\??\.created_at\s*(?:\|\||\?\?)\s*\w+\??\.date\b/],
  ['a workout saved on the day it finished', /date:\s*(?:localCalendarDate|bucketDateLocal)\(\s*new Date\(\)\s*\)/],
  ['an assigned day sent as the UTC instant of now', /scheduled_for:\s*new Date\(\)\.toISOString\(\)/],
];

// Lines in listed files that match an old pattern but are not a workout or
// assignment day, each with the reason.
const NOT_A_WORKOUT_DAY: Record<string, Array<[line: string, why: string]>> = {
  'src/screens/coach/client-detail/useClientDetailData.ts': [
    ['bucketDateLocal(new Date(w.date))', 'a weight log sent as a timestamp, not a workout'],
    ['events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());', 'timeline order of event instants'],
  ],
};

describe.each(SAVES_AND_READS)('%s', (file, what, uses) => {
  const source = read(file);
  const exempt = (NOT_A_WORKOUT_DAY[file] ?? []).map(([line]) => line);
  const checked = source.split('\n').filter((line) => !exempt.some((e) => line.includes(e))).join('\n');
  it(`${what}: goes through the one day rule`, () => {
    expect(source).toMatch(uses);
    // The two saves of "today" use the shared local-today helper.
    if (!/getTodayString|isWorkoutDoneToday/.test(uses.source)) expect(source).toMatch(RULE_IMPORT);
  });
  it.each(OLD_PATTERNS)('no %s', (_label, pattern) => {
    expect(checked).not.toMatch(pattern);
  });
  it('every exempt line still exists (the list cannot go stale)', () => {
    exempt.forEach((line) => expect(source).toContain(line));
  });
});

// Product files that name scheduled_for only as a type or schema field.
const TYPES_ONLY = new Set([
  'src/api/programsApi.ts',
  'src/api/romanAdjustApi.ts',
  'src/api/workoutBuilderApi.ts',
  'src/utils/workout/workoutDay.ts',
]);

function productFiles(dir: string): string[] {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : productFiles(rel);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [rel] : [];
  });
}

it('every product file that reads scheduled_for or the day rule is on the list', () => {
  const listed = new Set(SAVES_AND_READS.map(([file]) => file));
  const unlisted = productFiles('src').filter((file) => {
    if (listed.has(file) || TYPES_ONLY.has(file)) return false;
    const source = read(file);
    return /scheduled_for/.test(source) || RULE_IMPORT.test(source) || /isWorkoutDoneToday\(/.test(source);
  });
  expect(unlisted).toEqual([]);
});
