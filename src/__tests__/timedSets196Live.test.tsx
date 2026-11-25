/**
 * TIMED-SETS-M (agent 196): the live workout for a timed row, and the plan
 * row each logged exercise names (the phone half of SET-ASKED, b#1219).
 *
 * - A seconds row starts the live workout in seconds; its set row reads and
 *   speaks seconds. The count is still saved in reps_per_set.
 * - Each exercise logged from an assignment sends plan_assignment_id (the
 *   assignment id as the server sent it) and plan_order (the row's order on
 *   the assignment). A free workout, an added or swapped-in exercise sends
 *   neither. The history edit (PUT) resends what the server stored, never an
 *   asked_* field.
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import { buildActiveWorkoutExercises } from '../utils/workout/buildActiveWorkout';
import { routineSessionExercises } from '../utils/workout/workoutLogging';
import {
  completedExercisePayload,
  loggedWorkoutEditPayload,
  loggedWorkoutExercises,
  newSessionExercise,
  swapExercise,
  type LoggedWorkout,
} from '../screens/client/active-workout/sessionQuality';
import { SetLogger } from '../screens/client/active-workout/SetLogger';
import type { SessionExercise } from '../screens/client/active-workout/types';

const ASG = 'a3c2b1d0-0000-4000-8000-0000000000aa';
const ROWS = [
  { exercise_external_id: 'plank', order: 1, sets: 3, reps_or_duration_seconds: 60, unit: 'seconds' as const, weight_lbs: null, rest_seconds: 30, superset_group_id: null, notes: null },
  { exercise_external_id: 'squat', order: 2, sets: 4, reps_or_duration_seconds: 5, unit: 'reps' as const, weight_lbs: 135, rest_seconds: 120, superset_group_id: null, notes: null },
];

function startedSession(rows: unknown[] = ROWS): SessionExercise[] {
  const seeds = buildActiveWorkoutExercises({ exercises: rows as never }).map((e) => ({ ...e, exerciseName: e.exerciseId }));
  return routineSessionExercises(JSON.stringify(seeds));
}
const tickAll = (ex: SessionExercise): SessionExercise => ({ ...ex, sets: ex.sets.map((s) => ({ ...s, completed: true })) });

describe('a timed row in the live workout', () => {
  it('seeds seconds and the plan row order; a row without a unit seeds as main', () => {
    const seeds = buildActiveWorkoutExercises({ exercises: ROWS as never });
    expect(seeds.map((s) => [s.exerciseId, s.reps, s.unit, s.planOrder])).toEqual([['plank', 60, 'seconds', 1], ['squat', 5, 'reps', 2]]);
    const { unit: _u, ...older } = ROWS[0];
    const [plain] = buildActiveWorkoutExercises({ exercises: [older] as never });
    expect('unit' in plain).toBe(false);
    const session = startedSession();
    expect(session.map((e) => [e.unit, e.planOrder, e.sets[0].reps])).toEqual([['seconds', 1, 60], ['reps', 2, 5]]);
  });

  const styles = new Proxy({}, { get: () => ({}) }) as never;
  const colors = new Proxy({}, { get: () => '#000000' }) as never;
  const row = (timed: boolean, extra: Record<string, unknown> = {}) => render(
    <SetLogger set={{ weight: 0, reps: 60, completed: false }} setIdx={0} exIdx={0} timed={timed}
      onUpdate={() => undefined} onToggleComplete={() => undefined} colors={colors} styles={styles} {...extra} />,
  );

  it('the set row reads "0 lb × 60 sec" and speaks "Set 1, 0 pounds, 60 seconds. Change the numbers"', async () => {
    const view = await row(true);
    expect(view.getByText('0 lb × 60 sec')).toBeTruthy();
    expect(view.getByLabelText('Set 1, 0 pounds, 60 seconds. Change the numbers')).toBeTruthy();
  });

  it('a reps row speaks the 917-W9 words, as on main', async () => {
    const view = await row(false);
    expect(view.getByText('0 lb × 60')).toBeTruthy();
    expect(view.getByLabelText('Set 1, 0 pounds, 60 reps. Change the numbers')).toBeTruthy();
  });

  it('"Use previous set" says seconds for a timed row', async () => {
    const view = await row(true, { previous: { weight: 0, reps: 45, completed: true }, onUsePrevious: () => undefined });
    expect(view.getByLabelText(/^Use previous set 1: 0 pounds, 45 seconds$/)).toBeTruthy();
    expect(view.getByText('0 × 45 sec')).toBeTruthy();
  });
});

describe('each logged plan exercise names its plan row', () => {
  it('online and queued saves send the assignment id and the row order', () => {
    const [plank, squat] = startedSession().map(tickAll);
    expect(completedExercisePayload(plank, ASG)).toMatchObject({ plan_assignment_id: ASG, plan_order: 1, reps_per_set: [60, 60, 60] });
    expect(completedExercisePayload(squat, ASG)).toMatchObject({ plan_assignment_id: ASG, plan_order: 2 });
  });

  it('a free workout, an added exercise and a swapped-in exercise send neither', () => {
    const [plank] = startedSession().map(tickAll);
    for (const payload of [
      completedExercisePayload(plank),
      completedExercisePayload(tickAll(newSessionExercise({ id: 'x', name: 'Curl', muscle: 'arms', equipment: '' })), ASG),
    ]) {
      expect('plan_assignment_id' in payload).toBe(false);
      expect('plan_order' in payload).toBe(false);
    }
    const [logged, swapped] = swapExercise([{ ...plank, sets: [plank.sets[0], { ...plank.sets[1], completed: false }] }], 0,
      { id: 'side', name: 'Side plank', muscle: 'core', equipment: '' });
    expect(completedExercisePayload(logged, ASG)).toMatchObject({ plan_assignment_id: ASG, plan_order: 1 });
    expect('plan_order' in completedExercisePayload(tickAll(swapped), ASG)).toBe(false);
  });

  it('never sends an asked_* field', () => {
    const [plank] = startedSession().map(tickAll);
    expect(Object.keys(completedExercisePayload(plank, ASG)).filter((k) => k.startsWith('asked_'))).toEqual([]);
  });
});

describe('the history edit (PUT /workouts/:id) resends the stored plan row', () => {
  const stored: LoggedWorkout = {
    id: 'w-1', notes: '', exercises: [
      { exercise_name: 'plank', muscle_group: 'core', sets_completed: 2, reps_per_set: [60, 50], weight_per_set: [0, 0],
        plan_assignment_id: ASG, plan_order: 1, asked_sets: 3, asked_count: 60, asked_unit: 'seconds', asked_weight_lbs: null },
      { exercise_name: 'curl', muscle_group: 'arms', sets_completed: 1, reps_per_set: [10], weight_per_set: [25],
        plan_assignment_id: null, plan_order: null, asked_sets: null, asked_count: null, asked_unit: null, asked_weight_lbs: null },
    ],
  };

  it('each set keeps its stored plan_assignment_id and plan_order; none when none was stored', () => {
    const body = loggedWorkoutEditPayload(stored, loggedWorkoutExercises(stored), 'Felt good');
    expect(body.exercises[0]).toMatchObject({ plan_assignment_id: ASG, plan_order: 1, reps_per_set: [60, 50] });
    expect('plan_assignment_id' in body.exercises[1]).toBe(false);
    expect('plan_order' in body.exercises[1]).toBe(false);
    expect(JSON.stringify(body)).not.toMatch(/asked_/);
  });
});
