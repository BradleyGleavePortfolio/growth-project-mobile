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
import * as ts from 'typescript';
import {
  assignmentDay,
  calendarDay,
  dayStart,
  instantDay,
  workoutDay,
  workoutStartDay,
} from '../utils/workout/workoutDay';

// FR-917R3: a mutation test may point the guard at its own copy of src
// (FR917_DAY_ROOT), so no other test's child run sees its edits.
const ROOT = process.env.FR917_DAY_ROOT || path.resolve(__dirname, '..', '..');
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8');
// Other suites' mutation tests add and remove probe files in src while this
// guard runs; a file gone between listing and reading is skipped, not a crash.
const readIfThere = (file: string) => {
  try { return read(file); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return ''; throw e; }
};

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
  ['src/utils/workout/nextAssignment.ts', "Train's Today and the plan card's Next: the open workout by its assigned day", /assignmentDay\(a\)/],
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
  // LO-917R2 C9: a stored calendar date moved into local time.
  ['a stored calendar date read as an instant', /instantDay\(\s*[\w?.]+\.date\b/],
];

// Lines in listed files that match an old pattern but are not a workout or
// assignment day, each with the reason.
const NOT_A_WORKOUT_DAY: Record<string, Array<[line: string, why: string]>> = {
  'src/screens/coach/client-detail/useClientDetailData.ts': [
    ['bucketDateLocal(new Date(w.date))', 'a weight log sent as a timestamp, not a workout'],
    ['events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());', 'timeline order of event instants'],
  ],
};

// LS-917R3 B1 (LO-917R3 C5): day reads are found in the TypeScript syntax
// tree, not by line text. A read is a property read (row.date), a bracket
// read (row['date'], row?.['date']) or a destructured field ({ date } = row),
// on one line or split over several. A key written in an object literal
// (date: ...) is a day write. Each read or write is judged on its own: a rule
// call on the same line never excuses another raw parse.
const DAY_FIELDS = new Set(['date', 'scheduled_for', 'created_at', 'completed_at', 'started_at', 'logged_at']);
const PRESENCE_FIELDS = new Set(['completed_at', 'skipped_at', 'started_at']);
const RULES = new Set(['workoutDay', 'assignmentDay', 'workoutStartDay', 'calendarDay', 'dayStart', 'instantDay']);
const RAW_PARSERS = new Set(['Date', 'Date.parse', 'bucketDateLocal', 'localCalendarDate']);
const CUTS = new Set(['slice', 'substring', 'split']);

type DayNode = { field: string; node: ts.Node; kind: 'read' | 'write' };

const nameOf = (node: ts.Node | undefined): string | undefined => {
  if (!node) return undefined;
  if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) return node.text;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isComputedPropertyName(node)) return nameOf(node.expression);
  return undefined;
};
const calleeName = (call: ts.CallExpression | ts.NewExpression): string => {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) return `${callee.expression.text}.${callee.name.text}`;
  return '';
};
const unwrap = (node: ts.Node): ts.Node => {
  let n = node;
  while (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isNonNullExpression(n) || ts.isTypeAssertionExpression(n)) n = n.expression;
  return n;
};

const parsed = new Map<string, ts.SourceFile>();
function sourceFile(file: string, source: string): ts.SourceFile {
  const key = `${file}\u0000${source.length}\u0000${source}`;
  let sf = parsed.get(key);
  if (!sf) {
    sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    parsed.set(key, sf);
  }
  return sf;
}

function dayNodes(sf: ts.SourceFile): DayNode[] {
  const out: DayNode[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAccessExpression(node) && DAY_FIELDS.has(node.name.text)) out.push({ field: node.name.text, node, kind: 'read' });
    else if (ts.isElementAccessExpression(node) && DAY_FIELDS.has(nameOf(node.argumentExpression) ?? '')) out.push({ field: nameOf(node.argumentExpression)!, node, kind: 'read' });
    else if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent) && DAY_FIELDS.has(nameOf(node.propertyName ?? node.name) ?? '')) out.push({ field: nameOf(node.propertyName ?? node.name)!, node, kind: 'read' });
    else if ((ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) && ts.isObjectLiteralExpression(node.parent) && DAY_FIELDS.has(nameOf(node.name) ?? '')) out.push({ field: nameOf(node.name)!, node: node.name, kind: 'write' });
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

// A read handed straight to the rule: inside a rule call's arguments with no
// raw parse or text cut between. instantDay never reads a stored calendar
// date or an assigned day; calendarDay never reads an assigned moment.
function inRule({ field, node }: DayNode): boolean {
  let child: ts.Node = node;
  for (let p: ts.Node | undefined = node.parent; p; child = p, p = p.parent) {
    if (ts.isFunctionLike(p) || ts.isSourceFile(p) || ts.isStatement(p)) return false;
    if (ts.isPropertyAccessExpression(p) && p.expression === child && CUTS.has(p.name.text)) return false;
    if (ts.isCallExpression(p) || ts.isNewExpression(p)) {
      const name = calleeName(p);
      if (p.expression === child) continue;
      if (RAW_PARSERS.has(name)) return false;
      if (RULES.has(name)) {
        if (name === 'instantDay' && (field === 'date' || field === 'scheduled_for')) return false;
        if (name === 'calendarDay' && field === 'scheduled_for') return false;
        return true;
      }
    }
  }
  return false;
}

// A write whose value is a rule call.
function writtenByRule(dn: DayNode): boolean {
  const pa = dn.node.parent;
  if (!ts.isPropertyAssignment(pa)) return false;
  const value = unwrap(pa.initializer);
  return ts.isCallExpression(value) && RULES.has(calleeName(value));
}

// Done or not done: the field is only tested for being set, or copied as is.
function presenceOnly({ field, node, kind }: DayNode): boolean {
  if (!PRESENCE_FIELDS.has(field)) return false;
  if (kind === 'write') {
    const pa = node.parent;
    return ts.isPropertyAssignment(pa) && (() => { const v = unwrap(pa.initializer); return (ts.isPropertyAccessExpression(v) && v.name.text === field) || (ts.isElementAccessExpression(v) && nameOf(v.argumentExpression) === field); })();
  }
  let n: ts.Node = node;
  while (ts.isParenthesizedExpression(n.parent) || ts.isNonNullExpression(n.parent)) n = n.parent;
  const p = n.parent;
  if (ts.isPrefixUnaryExpression(p) && p.operator === ts.SyntaxKind.ExclamationToken) return true;
  if (ts.isConditionalExpression(p) && p.condition === n) return true;
  if ((ts.isIfStatement(p) || ts.isWhileStatement(p)) && p.expression === n) return true;
  if (ts.isPropertyAssignment(p) && p.initializer === n && nameOf(p.name) === field) return true;
  if (ts.isBinaryExpression(p)) {
    const op = p.operatorToken.kind;
    if (op === ts.SyntaxKind.AmpersandAmpersandToken && p.left === n) return true;
    const eq = [ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken];
    const other = unwrap(p.left === n ? p.right : p.left);
    if (eq.includes(op) && (other.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(other) && other.text === 'undefined'))) return true;
  }
  return false;
}

// Exceptions are exact pieces of source: a read or write is placed only when
// one occurrence of a listed snippet covers that read or write itself.
function covered(sf: ts.SourceFile, node: ts.Node, snippets: string[]): string | undefined {
  const text = sf.text;
  const from = node.getStart(sf);
  const to = node.getEnd();
  return snippets.find((snippet) => {
    for (let i = text.indexOf(snippet); i !== -1; i = text.indexOf(snippet, i + 1)) {
      if (i <= from && to <= i + snippet.length) return true;
    }
    return false;
  });
}

const where = (file: string, sf: ts.SourceFile, node: ts.Node) => {
  const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  return `${file}:${line + 1}: ${sf.text.split('\n')[line].trim()}`;
};

// Every day read or write in a file that does not go through the rule, is
// not presence only and is not covered by a placed snippet. `used` collects
// the snippets that placed something, so stale snippets fail.
function unplacedDayNodes(file: string, source: string, snippets: string[], used?: Set<string>): string[] {
  const sf = sourceFile(file, source);
  return dayNodes(sf).flatMap((dn) => {
    if (inRule(dn) || (dn.kind === 'write' && writtenByRule(dn))) return [];
    if (presenceOnly(dn)) return [];
    const hit = covered(sf, dn.node, snippets);
    if (hit) { used?.add(hit); return []; }
    return [where(file, sf, dn.node)];
  });
}
const allDayNodes = (file: string, source: string) => dayNodes(sourceFile(file, source));

// LO-917R2 C9 in the tree: a file that hands a stored `date` (any syntax) to a
// raw date parse is in the class even without a workout type.
function parsesAStoredDate(file: string, source: string): boolean {
  return allDayNodes(file, source).some(({ field, node, kind }) => {
    if (kind !== 'read' || field !== 'date') return false;
    for (let p: ts.Node | undefined = node.parent; p && !ts.isStatement(p) && !ts.isFunctionLike(p); p = p.parent) {
      if ((ts.isCallExpression(p) || ts.isNewExpression(p)) && RAW_PARSERS.has(calleeName(p))) return true;
    }
    return false;
  });
}

// Day-field lines in listed files that are not a workout or assignment day
// read through the rule: other kinds of rows, style names and request shapes.
const LISTED_LINES: Record<string, Array<[snippet: string, why: string]>> = {
  'src/screens/client/ActiveWorkoutScreen.tsx': [['started_at: sessionStartTimeRef.current.toISOString()', 'the start instant sent to the server, not a day read']],
  'src/offline/models/WorkoutLog.ts': [['loggedAt: new Date(row.logged_at)', 'the queued row keeps its logged instant']],
  'src/components/coach/ai-entry/ClientCopyBar.tsx': [['scheduled_for: getTodayString()', "the save of the coach's local today (listed above)"]],
  'src/screens/client/calendar/CalendarWeekScreen.tsx': [["row.date.slice(0, 10) === day", 'a check-in day, not a workout'], ['styles.date', 'a style name'], ['date: { ...typography.h3', 'a style name']],
  'src/screens/client/progress/progressV2.ts': [['dayX(l.date)', 'weigh-in days'], ['log.date === today', 'a weigh-in day'], ['dayX(log.date)', 'a weigh-in day'], ['monthDay(log.date)', 'a weigh-in day']],
  'src/screens/client/progress/weekReview.ts': [['inWeek(d.date, week)', 'a food day'], ['inWeek(c.date, week)', 'a check-in day'], ['r.date <= week.end', 'a weigh-in day'], ['c.date.slice(0, 10) === day', 'a check-in day'], ['foodDays.map((d) => d.date.slice(0, 10))', 'food days'], ['inWeek(w.date, week)', 'a weigh-in day']],
  'src/screens/client/ClientWorkoutViewerScreen.tsx': [['formatScheduled(a.scheduled_for)', 'formatScheduled reads assignmentDay (checked below)']],
  'src/components/tutorial/PlanExplanationCard.tsx': [['weekdayOf(first.scheduled_for)', 'weekdayOf reads assignmentDay (checked below)']],
  'src/hooks/useApi.ts': [["['check-ins', 'day', vars.date]", 'a cache key'], ['({ date, volume })', 'volume per day key, keyed by workoutDay above']],
  'src/utils/workout/workoutLogging.ts': [['const finishedAt = s.completed_at || s.created_at || s.date', "the session's sort instant; its day is workoutDay(s)"]],
  'src/screens/coach/client-detail/WorkoutsTab.tsx': [['{ date: dayOfSession(s), weight }', 'dayOfSession reads s.day or instantDay (listed above)'], ['a.date.localeCompare(b.date)', 'points dated by dayOfSession'], ['dayText(p.date)', 'points dated by dayOfSession'], ['dayText(points[0].date)', 'points dated by dayOfSession'], ['dayText(points[points.length - 1].date)', 'points dated by dayOfSession']],
  'src/screens/coach/client-detail/useClientDetailData.ts': [['if (s.created_at && instantDay(s.created_at) === day) return s.created_at;', 'recordedAt: the stored instant when it falls on workoutDay(s)'], ["?? s.created_at ?? s.date ?? ''", 'recordedAt: fallback instant after the start of workoutDay(s)'], ['date: today,', 'a food row dated today'], ['bucketDateLocal(new Date(w.date))', 'a weight log sent as a timestamp, not a workout'], ["date: typeof w.date === 'string' ? w.date.slice(0, 10)", 'a weight log day'], ['(meal.date || meal.logged_at', 'a meal day'], ["date: dateStr + 'T", 'a timeline event instant'], ["(w.date || '').slice(0, 10)", 'a weight log day'], ['date: recordedAt(s)', 'recordedAt returns workoutDay'], ["date: String(c.date || '').slice(0, 10)", 'a check-in day'], ['new Date(b.date).getTime() - new Date(a.date).getTime()', 'timeline order of event instants']],
  'src/utils/coach/clientPeek.ts': [['localDay(latest.date, false)', 'a check-in day'], ['localDay(weight.date, false)', 'a weight log day']],
};


function unplacedListedReads(file: string, source: string, used?: Set<string>): string[] {
  return unplacedDayNodes(file, source, (LISTED_LINES[file] ?? []).map(([snippet]) => snippet), used);
}

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
  // LS-917R2 B1 (LO-917R2 C9): a listed file is checked line by line too. Each
  // line that reads a day field goes through the rule, only tests whether the
  // field is set, or is placed in LISTED_LINES with its reason.
  it('every day read in the file goes through the rule or is placed', () => {
    const used = new Set<string>();
    expect(unplacedListedReads(file, source, used)).toEqual([]);
    // Each placed snippet still covers a read or write (no stale placing).
    expect((LISTED_LINES[file] ?? []).map(([snippet]) => snippet).filter((snippet) => !used.has(snippet))).toEqual([]);
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
  // LO-917R2 C9: a file with its own row type that parses a stored date.
  /(?:new Date|Date\.parse|instantDay|bucketDateLocal)\(\s*(?:new Date\(\s*)?[\w?.[\]]+\.date\b/,
];

// In-class files that are not day readers: every day-field line that is not a
// type field must contain one of its listed snippets.
const PLACED: Record<string, { why: string; lines: string[] }> = {
  'src/api/programsApi.ts': { why: 'types and request shapes only', lines: [] },
  'src/api/romanAdjustApi.ts': { why: 'types and response schemas only', lines: ['scheduled_for: z.string()', 'created_at: z.string()'] },
  'src/api/workoutBuilderApi.ts': { why: 'types and request shapes only', lines: [] },
  'src/screens/coach/client-detail/types.ts': { why: 'types only', lines: [] },
  'src/utils/workout/workoutDay.ts': { why: 'the rule itself', lines: ['row?.scheduled_for'] },
  'src/services/api.ts': { why: 'request shapes; workout and assignment dates pass through unread; the weight save key (m#921) names the save by its own calendar date, not a workout day', lines: ['JSON.stringify([data.weight_lbs, data.date ?? null'] },
  'src/api/coachAiExecutionApi.ts': { why: 'AI action rows ordered by when they were made, not a workout day', lines: ['created_at: now', 'a.created_at < b.created_at'] },
  'src/db/workoutDb.ts': { why: 'on-device exercise volume; getDailyVolumeBreakdown has no caller (checked below)', lines: ['date: r.day'] },
  'src/screens/client/WorkoutAssignmentDetailScreen.tsx': { why: 'completed_at read only as done or not done', lines: [] },
  'src/screens/client/home/RingsHomeScreen.tsx': { why: "today's date line and a style name; ring counts come from homeRings.ts", lines: ['styles.date', 'date: { marginBottom'] },
  'src/screens/client/LogScreen.tsx': { why: 'meal days (food log calendar dates), not a workout', lines: ['date: day', 'repeatMeal.date === addDays(selectedDate, -1)', 'new Date(`${repeatMeal.date}T00:00:00`)'] },
  'src/screens/client/ProgressScreen.tsx': { why: 'weigh-in days (calendar dates), not a workout', lines: ['a.date.localeCompare(b.date)', 'l.date === dateStr', 'date: getTodayString()', 'formatSince(firstLog.date)', 'new Date(`${log.date}T00:00:00`)', 'lastLog.date', 'formatLogDate(log.date)'] },
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


it('every product file in the workout and assignment class that reads a day is listed or placed', () => {
  const listed = new Set(SAVES_AND_READS.map(([file]) => file));
  const unplaced = productFiles('src').flatMap((file) => {
    if (listed.has(file)) return [];
    const source = readIfThere(file);
    if (!/\b(?:date|scheduled_for|created_at|completed_at|started_at|logged_at)\b/.test(source)) return [];
    if (!IN_CLASS.some((pattern) => pattern.test(source)) && !parsesAStoredDate(file, source)) return [];
    if (!allDayNodes(file, source).length) return [];
    const placed = PLACED[file];
    if (!placed) return allDayNodes(file, source).map((dn) => where(file, sourceFile(file, source), dn.node));
    return unplacedDayNodes(file, source, placed.lines);
  });
  expect(unplaced).toEqual([]);
});

it.each(Object.entries(PLACED))('%s stays placed', (file, { lines }) => {
  const source = read(file);
  const used = new Set<string>();
  expect(unplacedDayNodes(file, source, lines, used)).toEqual([]);
  expect(lines.filter((snippet) => !used.has(snippet))).toEqual([]);
});

// Helpers a placed line hands the day to: each reads the rule itself.
it.each([
  ['src/screens/client/ClientWorkoutViewerScreen.tsx', /function formatScheduled\(iso: string\): string \{[^}]*dayStart\(assignmentDay\(iso\)\)/],
  ['src/components/tutorial/PlanExplanationCard.tsx', /function weekdayOf\([^)]*\)[^{]*\{[^}]*dayStart\(assignmentDay\(day\)\)/],
  ['src/screens/coach/client-detail/WorkoutsTab.tsx', /const dayOfSession = \(s: WorkoutSession\) => s\.day \|\| instantDay\(s\.startTime\)/],
  ['src/screens/client/train/TrainToday.tsx', /const dayOf = \(a: Row\) => assignmentDay\(a\)/],
])('%s hands days to a helper that reads the rule', (file, helper) => {
  expect(read(file)).toMatch(helper);
});

it('the unplaced on-device volume reader still has no caller', () => {
  const callers = productFiles('src').filter((file) => file !== 'src/db/workoutDb.ts' && /getDailyVolumeBreakdown/.test(readIfThere(file)));
  expect(callers).toEqual([]);
});
