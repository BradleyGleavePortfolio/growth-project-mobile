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
    ['an assignment stored date-only keeps its day', () => assignmentDay('2026-10-26'), '2026-10-26'],
    ['an assignment stored at another moment is the local day it falls on', () => assignmentDay('2026-10-27T01:30:00.000Z'), '2026-10-26'],
    ['an assignment stored at 12:00 UTC is that local day', () => assignmentDay({ scheduled_for: '2026-10-26T12:00:00.000Z' }), '2026-10-26'],
    ['an unreadable assigned value is no day', () => assignmentDay('not a day'), ''],
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
  ['src/screens/coach/programs/ProgramAssignScreen.tsx', 'program start day (local picker) and the assigned span shown back', /assignmentDay\(r\.first_scheduled_for\)/],
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
  ['src/screens/client/ClientWorkoutViewerScreen.tsx', 'assigned plans: order and day label', /assignmentDay\(/],
  ['src/components/tutorial/PlanExplanationCard.tsx', 'plan card: weekday of the assigned day', /assignmentDay\(/],
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
  // LO-917 B1: scheduled_for is a moment; only assignmentDay reads it.
  ['an assigned moment read as a calendar date', /calendarDay\([^)]*scheduled_for/],
  ['an assigned day cut from its text', /scheduled_for\??\.(?:slice|substring|split)\(/],
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

// Part 3 (LS-917 B3, LO-917 C1): the list is found, not trusted. A product
// file is in this class when it names a workout or assignment type, one of
// their hooks or API entry points, scheduled_for or the day rule. Each such
// file that reads a day field (date, scheduled_for, created_at, completed_at,
// started_at, logged_at) must be on SAVES_AND_READS or placed below with every
// day-field line it reads accounted for. Anything the guard cannot place fails.
const IN_CLASS = [
  /\b(?:ApiWorkoutSession|WorkoutLog|WorkoutSession|ClientWorkoutAssignment\w*|TrainWorkout|LoggedWorkout|WorkoutRowLike)\b/,
  /\b(?:useWorkouts|useMyWorkoutAssignments?|workoutApi|listMyAssignments|getMyAssignments?)\b/,
  /['"`]\/(?:coach\/clients\/[^'"`]*\/)?workouts\b/,
  /scheduled_for/,
  RULE_IMPORT,
  /isWorkoutDoneToday\(/,
];
const DAY_FIELD = /\.(?:date|scheduled_for|created_at|completed_at|started_at|logged_at)\b|\b(?:date|scheduled_for|created_at|completed_at|started_at|logged_at)\??:/;
// A type or schema field declaration (`created_at: string;`), not a read.
const TYPE_FIELD = /^\s*(?:readonly\s+)?(?:date|scheduled_for|created_at|completed_at|started_at|logged_at)\??:\s*[\w\s|'"<>[\].]+[;,]?\s*(?:\/\/.*|\/\*.*)?$/;

// In-class files that are not day readers: every day-field line that is not a
// type field must contain one of its listed snippets.
const PLACED: Record<string, { why: string; lines: string[] }> = {
  'src/api/programsApi.ts': { why: 'types and request shapes only', lines: [] },
  'src/api/romanAdjustApi.ts': { why: 'types and response schemas only', lines: ['scheduled_for: z.string()', 'created_at: z.string()'] },
  'src/api/workoutBuilderApi.ts': { why: 'types and request shapes only', lines: [] },
  'src/screens/coach/client-detail/types.ts': { why: 'types only', lines: [] },
  'src/utils/workout/workoutDay.ts': { why: 'the rule itself', lines: ['workoutDay(row: { date?', 'row.date', '{ scheduled_for?: string | null } | string', 'row?.scheduled_for'] },
  'src/services/api.ts': { why: 'request shapes; workout and assignment dates pass through unread', lines: ['(date: string)', 'created_at?: string }', 'date?: string'] },
  'src/api/coachAiExecutionApi.ts': { why: 'AI action rows ordered by when they were made, not a workout day', lines: ['created_at: now', 'a.created_at < b.created_at'] },
  'src/db/workoutDb.ts': { why: 'on-device exercise volume; getDailyVolumeBreakdown has no caller (checked below)', lines: ['Array<{ date: string; volume: number }>', 'date: r.day'] },
  'src/screens/client/WorkoutAssignmentDetailScreen.tsx': { why: 'completed_at read only as done or not done', lines: ['!!data.completed_at'] },
  'src/screens/client/home/RingsHomeScreen.tsx': { why: "today's date line and a style name; ring counts come from homeRings.ts", lines: ['homeDateLine(new Date())', 'date: { marginBottom'] },
  'src/screens/client/progress/ProgressV2.tsx': { why: 'weigh-in days and bests already dated by progressV2.ts', lines: ['a.date.localeCompare(b.date)', 'l.date !== today', "date: today, weight: lbs", 'P.monthDay(logs[0].date)', 'short(best.date)', 'short(l.date)'] },
};

// fr917DayDiscovery.test.ts writes fr917DayProbe* files for one child run of
// this guard (FR917_DAY_PROBE=1); any other run of the guard skips them.
const PROBE = /^fr917DayProbe\w*\.ts$/;

function productFiles(dir: string): string[] {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : productFiles(rel);
    if (PROBE.test(entry.name) && process.env.FR917_DAY_PROBE !== '1') return [];
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [rel] : [];
  });
}

const dayLines = (source: string) => source.split('\n').filter((line) => DAY_FIELD.test(line) && !TYPE_FIELD.test(line));

it('every product file in the workout and assignment class that reads a day is listed or placed', () => {
  const listed = new Set(SAVES_AND_READS.map(([file]) => file));
  const unplaced = productFiles('src').filter((file) => {
    if (listed.has(file)) return false;
    const source = read(file);
    if (!IN_CLASS.some((pattern) => pattern.test(source))) return false;
    const reads = dayLines(source);
    if (!reads.length) return false;
    const placed = PLACED[file];
    return !placed || reads.some((line) => !placed.lines.some((snippet) => line.includes(snippet)));
  });
  expect(unplaced).toEqual([]);
});

it.each(Object.entries(PLACED))('%s stays placed', (file, { lines }) => {
  const source = read(file);
  lines.forEach((snippet) => expect(source).toContain(snippet));
});

it('the unplaced on-device volume reader still has no caller', () => {
  const callers = productFiles('src').filter((file) => file !== 'src/db/workoutDb.ts' && /getDailyVolumeBreakdown/.test(read(file)));
  expect(callers).toEqual([]);
});
