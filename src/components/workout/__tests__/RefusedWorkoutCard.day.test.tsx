/**
 * @jest-environment ./src/__tests__/helpers/lsWorkoutPacific187.cjs
 */
/**
 * WORKOUT-REFUSAL-DAY-M (LS-WRM-2 C2 and N1, LS-WRM-1 N3 on m#1000), in Pacific time, where UTC midnight is the
 * evening before. The refused-workout card reads its stored workout day through the one day rule
 * (utils/workout/workoutDay, listed in src/__tests__/workoutDayRule.test.ts) and takes the offline engine from its
 * barrel (src/offline/index.ts).
 * D1: the day the card shows for every stored date the phone writes, and for none, reads as it did before.
 * D1b: the one class that reads differently: a date text without the "YYYY-MM-DD" prefix is the rule's reading.
 * D2: the card imports the offline module from the barrel only.
 * D3: the barrel names every engine value the card takes.
 */
import * as fs from 'fs';
import * as path from 'path';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 34, left: 0, right: 0 }) }));

import { refusedView } from '../RefusedWorkoutCard';

const MISSING = Symbol('no date key');
const body = (date: unknown) => ({
  ...(date === MISSING ? {} : { date }),
  workout_name: 'Upper body B', workout_type: 'strength', duration_minutes: 48, notes: '',
  exercises: [{ exercise_name: 'Bench press', sets_completed: 3, reps_per_set: [8, 8, 8], weight_per_set: [145, 145, 145] }],
});

describe('D1: the refused card shows the stored day as before (Pacific time)', () => {
  it.each([
    ['a calendar date', '2026-10-10', 'Sat 10 Oct', 'Saturday 10 October'],
    ['the same day sent as UTC midnight (never Fri 9 Oct)', '2026-10-10T00:00:00.000Z', 'Sat 10 Oct', 'Saturday 10 October'],
    ['the day the clocks go back', '2026-11-01', 'Sun 1 Nov', 'Sunday 1 November'],
    ['the day the clocks go forward', '2026-03-08', 'Sun 8 Mar', 'Sunday 8 March'],
    ['an empty date', '', '', ''],
    ['a missing date', MISSING, '', ''],
    ['a null date', null, '', ''],
    ['a number', 20261010, '', ''],
    ['text that is not a day', 'not a day', '', ''],
  ] as Array<[string, unknown, string, string]>)('%s', (_label, stored, date, longDate) => {
    const v = refusedView(body(stored));
    expect([v.date, v.longDate]).toEqual([date, longDate]);
    expect(v.meta).toBe([date, '48 min', '3 sets'].filter(Boolean).join(' · '));
  });
});

describe('D1b: a date text without the "YYYY-MM-DD" prefix is the day rule\'s reading', () => {
  it('"Oct 10 2026" reads as Sat 10 Oct', () => {
    const v = refusedView(body('Oct 10 2026'));
    expect([v.date, v.longDate]).toEqual(['Sat 10 Oct', 'Saturday 10 October']);
  });
});

describe('D2: the card takes the offline module from its barrel only', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'RefusedWorkoutCard.tsx'), 'utf8');
  const specifiers = [...source.matchAll(/(?:\bfrom\s+|\bimport\s+|\brequire\(\s*)['"]([^'"]+)['"]/g)].map((m) => m[1]);
  it('no import reaches into the offline module by sub-path', () => {
    expect(specifiers.filter((s) => /(?:\.\.\/)+offline\/[^'"]+/.test(s))).toEqual([]);
  });
  it("exactly one import is from '../../offline'", () => {
    expect(specifiers.filter((s) => s === '../../offline')).toHaveLength(1);
  });
});

describe('D3: the barrel names every engine value the card takes', () => {
  const barrel = () => jest.requireActual<Record<string, unknown>>('../../../offline');
  it.each([
    'canSendAgain',
    'deadLetterEvents',
    'listRefusedWorkouts',
    'refusalLines',
    'removeRefusedWorkout',
    'sendRefusedWorkoutAgain',
    'workoutSyncEvents',
  ])('%s', (name) => {
    expect(barrel()[name]).toBeDefined();
  });
});
