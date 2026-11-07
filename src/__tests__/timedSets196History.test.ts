/**
 * TIMED-SETS-M item 6: logged history. A logged exercise whose ask is in
 * seconds (b#1219's asked_unit, null on servers without it) reads sec in the
 * member's history and in the coach's view of her workout; null or absent
 * reads as on main.
 */
import {
  formatCoachSessionSets,
  formatLoggedSets,
  mapCoachWorkoutSessions,
} from '../utils/workout/workoutLogging';

describe('member history line', () => {
  it('a timed plank reads sec, with and without weight', () => {
    expect(formatLoggedSets({ sets_completed: 2, weight_per_set: [0, 20], reps_per_set: [60, 45], asked_unit: 'seconds' }))
      .toBe('2 sets · 60 sec, 20 lb x 45 sec');
  });
  it('asked_unit null, reps or absent reads exactly as on main', () => {
    const ex = { sets_completed: 2, weight_per_set: [0, 135], reps_per_set: [8, 6] };
    const main = '2 sets · 8 reps, 135 lb x 6';
    expect(formatLoggedSets(ex)).toBe(main);
    expect(formatLoggedSets({ ...ex, asked_unit: null })).toBe(main);
    expect(formatLoggedSets({ ...ex, asked_unit: 'reps' })).toBe(main);
  });
});

describe("coach's view of a client workout", () => {
  const rows = [{
    id: 's1', workout_name: 'Core and legs', created_at: '2026-11-04T18:00:00.000Z', duration_minutes: 30,
    exercises: [
      { exercise_name: 'Plank', sets_completed: 2, weight_per_set: [0, 0], reps_per_set: [60, 60], asked_unit: 'seconds' },
      { exercise_name: 'Back Squat', sets_completed: 1, weight_per_set: [135], reps_per_set: [5], asked_unit: 'reps' },
      { exercise_name: 'Curl', sets_completed: 1, weight_per_set: [25], reps_per_set: [10], asked_unit: null },
    ],
  }];
  it('carries a seconds ask to the line the coach reads; others as on main', () => {
    const [session] = mapCoachWorkoutSessions(rows);
    const ex = JSON.parse(session.exercises) as Array<{ sets: Array<{ weight: number; reps: number; completed: boolean }>; unit?: string }>;
    expect(ex.map((e) => e.unit)).toEqual(['seconds', undefined, undefined]);
    expect(ex.map((e) => formatCoachSessionSets(e.sets, e.unit))).toEqual([
      '2 sets · 60 sec, 60 sec',
      '1 set · 135 lb x 5',
      '1 set · 25 lb x 10',
    ]);
  });
});
