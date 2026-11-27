/**
 * PR-ALERTS-M (C1 v2 C2_logger, LO-WORKOUT C7): which block of the live workout carries the recent-best star line, and
 * its words. Records come from the real workoutSummary over the same sets, as fix974r2WhatMoved.test.ts does, and every
 * row is held to What moved over the same sets, history, records and body-weight map (r11): one rule, never two.
 * Fixtures are fictional (a client of coach Sam Rivera; lb).
 */
import { workoutSummary, type LoggedWorkout } from '../sessionQuality';
import { whatMoved } from '../summaryC5';
import { blockBests } from '../blockBest';
import type { SessionExercise, SessionSet } from '../types';

const BASIS = 'heaviest in your last 50 saved workouts';
const set = (weight: number, reps: number, completed = true, doneOrder?: number): SessionSet =>
  ({ weight, reps, completed, ...(doneOrder != null ? { doneOrder } : {}) });
const block = (id: string, sets: SessionSet[], name = 'Back squat', extra: Partial<SessionExercise> = {}): SessionExercise => ({
  exerciseId: id, exerciseName: name, muscleGroup: 'legs', restSec: 90, sets, ...extra,
});
const past = (name: string, weights: number[], reps = 5): LoggedWorkout => ({
  id: `past-${name}`, workout_name: 'Legs with Sam Rivera', notes: '', duration_minutes: 50,
  exercises: [{ exercise_name: name, muscle_group: 'legs', sets_completed: weights.length, weight_per_set: weights, reps_per_set: weights.map(() => reps) }],
} as unknown as LoggedWorkout);

/** Back squat 4 × 5 at 180 last time. */
const HISTORY: LoggedWorkout[] = [past('Back squat', [180, 180, 180, 180])];
const line = (k: number, r: number, w: number) => `${k} × ${r} at ${w.toLocaleString()} lb, ${BASIS}`;
const nameKey = (name: string) => name.trim().toLowerCase();

function run(exercises: SessionExercise[], history: LoggedWorkout[] = HISTORY, bodyWeight: Record<string, boolean | undefined> = {}) {
  const { records } = workoutSummary(exercises, history);
  return {
    bests: blockBests(exercises, records, bodyWeight),
    moved: whatMoved(exercises, history, records, bodyWeight),
  };
}

type Row = [
  name: string,
  exercises: SessionExercise[],
  expected: Array<string | null>,
  history?: LoggedWorkout[],
  bodyWeight?: Record<string, boolean | undefined>,
];

const ROWS: Row[] = [
  ['r1 the frame: four ticked sets of 5 at 185', [block('a', [set(185, 5), set(185, 5), set(185, 5), set(185, 5)])], [line(4, 5, 185)]],
  ['r2 one ticked set of four', [block('a', [set(185, 5), set(185, 5, false), set(185, 5, false), set(185, 5, false)])], [line(1, 5, 185)]],
  ['r3 175 × 5, 185 × 5, 185 × 3', [block('a', [set(175, 5), set(185, 5), set(185, 3)])], [line(1, 5, 185)]],
  ['r3 185 × 5 twice and 175 once', [block('a', [set(185, 5), set(185, 5), set(175, 5)])], [line(2, 5, 185)]],
  ['r4 180 (equal to the earlier best) and 175', [block('a', [set(180, 5), set(175, 5)])], [null]],
  ['r5 an exercise with no earlier set in the history', [block('b', [set(155, 6)], 'Bench press')], [null]],
  ['r6 an empty history', [block('a', [set(185, 5)])], [null], []],
  ['r7 185 on an unticked set only', [block('a', [set(185, 5, false), set(175, 5)])], [null]],
  ['r7 185 with 0 reps', [block('a', [set(185, 0), set(175, 5)])], [null]],
  ['r8 a seconds exercise that beats its earlier weight', [block('p', [set(185, 60)], 'Back squat', { unit: 'seconds' })], [null]],
  ['r8 a body-weight exercise that beats its earlier weight', [block('bw', [set(185, 5)])], [null], HISTORY, { bw: true }],
  ['r9 the name in another case and spacing still matches', [block('a', [set(185, 5)], '  back SQUAT ')], [line(1, 5, 185)]],
  ['r10 two blocks: 185 ticked first, 225 later: the 225 block only', [block('a', [set(185, 5, true, 1)]), block('b', [set(225, 3, true, 2)])], [null, line(1, 3, 225)]],
  ['r10 225 in both: on the block whose 225 was ticked first', [block('a', [set(225, 3, true, 2)]), block('b', [set(225, 4, true, 1)])], [null, line(1, 4, 225)]],
  ['r10 225 in both, the first block ticked first', [block('a', [set(225, 3, true, 1)]), block('b', [set(225, 4, true, 2)])], [line(1, 3, 225), null]],
  ['r10 225 in both with no doneOrder: the earlier block', [block('a', [set(225, 3)]), block('b', [set(225, 4)])], [line(1, 3, 225), null]],
  ['r10 the first block\'s 225 unticked: on the second', [block('a', [set(225, 3, false, 1), set(185, 5, true, 3)]), block('b', [set(225, 4, true, 2)])], [null, line(1, 4, 225)]],
];

describe('blockBests: the star line on the block where the recent best was lifted', () => {
  it.each(ROWS)('%s', (_name, exercises, expected, history = HISTORY, bodyWeight = {}) => {
    const { bests } = run(exercises, history, bodyWeight);
    expect(bests.map((b) => b?.text ?? null)).toEqual(expected);
  });

  it('r1 and r2 speak the line once as one sentence, "Recent best" first', () => {
    const four = run([block('a', [set(185, 5), set(185, 5), set(185, 5), set(185, 5)])]).bests[0];
    expect(four?.spoken).toBe(`Recent best: 4 sets of 5 reps at 185 pounds, ${BASIS}`);
    const one = run([block('a', [set(185, 5), set(185, 5, false)])]).bests[0];
    expect(one?.spoken).toBe(`Recent best: 1 set of 5 reps at 185 pounds, ${BASIS}`);
    const single = run([block('a', [set(185, 1)])]).bests[0];
    expect(single?.spoken).toBe(`Recent best: 1 set of 1 rep at 185 pounds, ${BASIS}`);
  });

  it('the key is the exercise\'s name key and the record weight: the same lift keeps it, a heavier one changes it', () => {
    const a = run([block('a', [set(185, 5)])]).bests[0];
    const b = run([block('a', [set(185, 5), set(185, 5)], ' back SQUAT')]).bests[0];
    const c = run([block('a', [set(185, 5), set(190, 5)])]).bests[0];
    expect(a?.key).toBeTruthy();
    expect(a?.key).toBe(b?.key);
    expect(a?.key).toContain('back squat');
    expect(a?.key).toContain('185');
    expect(c?.key).not.toBe(a?.key);
    expect(c?.weight).toBe(190);
  });

  it.each(ROWS)('r11 agreement with What moved: %s', (_name, exercises, _expected, history = HISTORY, bodyWeight = {}) => {
    const { bests, moved } = run(exercises, history, bodyWeight);
    const fromBlocks = bests.flatMap((b, i) => (b ? [[nameKey(exercises[i].exerciseName), b.weight] as const] : []));
    const fromMoved = moved.filter((l) => l.kind === 'best').map((l) => [nameKey(l.exercise), l.weight] as const);
    expect(fromBlocks).toEqual(fromMoved);
    // One star per exercise.
    expect(new Set(fromBlocks.map(([key]) => key)).size).toBe(fromBlocks.length);
  });

  it('r12 three exercises each with a best: three lines (What moved\'s two-row limit is the summary page\'s)', () => {
    const history = [past('Back squat', [180]), past('Bench press', [150], 6), past('Romanian deadlift', [130], 8)];
    const exercises = [
      block('a', [set(185, 5)]),
      block('b', [set(155, 6), set(155, 6)], 'Bench press'),
      block('c', [set(135, 8)], 'Romanian deadlift'),
    ];
    const { bests } = run(exercises, history);
    expect(bests.map((b) => b?.text ?? null)).toEqual([line(1, 5, 185), line(2, 6, 155), line(1, 8, 135)]);
  });

  it('r13 17.5 lb and a weight over 1,000 are written as What moved writes them', () => {
    const history = [past('Lateral raise', [15], 12), past('Leg press', [1000], 10)];
    const exercises = [block('l', [set(17.5, 12)], 'Lateral raise'), block('p', [set(1045, 10)], 'Leg press')];
    const { bests, moved } = run(exercises, history);
    expect(bests[0]?.text).toBe(`1 × 12 at ${(17.5).toLocaleString()} lb, ${BASIS}`);
    expect(bests[1]?.text).toBe(`1 × 10 at ${(1045).toLocaleString()} lb, ${BASIS}`);
    expect(bests[1]?.spoken).toBe(`Recent best: 1 set of 10 reps at ${(1045).toLocaleString()} pounds, ${BASIS}`);
    // The same numbers as What moved's lines for the same sets.
    expect(moved.map((l) => l.text)).toEqual([
      `Lateral raise: ${(17.5).toLocaleString()} × 12, ${BASIS}`,
      `Leg press: ${(1045).toLocaleString()} × 10, ${BASIS}`,
    ]);
  });

  it('reads nothing else: a history row with no exercises key is no earlier set, and nothing is Infinity or NaN', () => {
    const odd = [{ id: 'x', workout_name: 'Rest day', notes: '', duration_minutes: 0 } as unknown as LoggedWorkout];
    const { bests } = run([block('a', [set(185, 5)])], odd);
    expect(bests).toEqual([null]);
    const all = run([block('a', [set(185, 5)]), block('b', [set(185, 5, false)])]).bests;
    for (const b of all) expect(`${b?.text} ${b?.spoken}`).not.toMatch(/Infinity|NaN/);
  });
});
