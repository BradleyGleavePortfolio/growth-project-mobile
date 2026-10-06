/**
 * UX-WORKOUT-124 (agent 124): client workout logging saves the numbers the
 * client typed, routines can be saved, coach-assigned workouts complete on
 * the server, and the coach sees the real sets.
 */
import React, { useState } from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import {
  SetLogger,
  sanitizeWeightText,
  parseWeightText,
  sanitizeRepsText,
  parseRepsText,
} from '../screens/client/active-workout/SetLogger';
import type { SessionSet } from '../screens/client/active-workout/types';
import {
  assignmentIdempotencyKey,
  buildRoutinePayload,
  formatLoggedSets,
  localCalendarDate,
  mapCoachWorkoutSessions,
  routineToBuilderExercises,
  routineToSessionExercises,
} from '../utils/workout/workoutLogging';
import { toServerMuscleGroup } from '../utils/workout/muscleGroup';
import { buildActiveWorkoutExercises } from '../utils/workout/buildActiveWorkout';

const IS_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Backend growth-project-backend src/workout/workout.dto.ts
// CreateRoutineExerciseDto (ValidationPipe whitelist + forbidNonWhitelisted).
const ROUTINE_EXERCISE_DTO_FIELDS = [
  'default_reps',
  'default_rest_seconds',
  'default_sets',
  'exercise_name',
  'muscle_group',
  'order_index',
];
const SERVER_MUSCLE_GROUPS = ['chest', 'back', 'legs', 'shoulders', 'arms', 'core', 'cardio', 'full_body'];

// Any style key resolves to an empty style; any colour to black.
const anyStyles = new Proxy({}, { get: () => ({}) }) as never;
const anyColors = new Proxy({}, { get: () => '#000000' }) as never;

function Harness({ onWeight }: { onWeight: (w: number) => void }) {
  const [set, setSet] = useState<SessionSet>({ reps: 8, weight: 0, completed: false });
  return (
    <SetLogger
      set={set}
      setIdx={0}
      exIdx={0}
      onUpdate={(_e, _s, field, value) => {
        setSet((prev) => ({ ...prev, [field]: value }));
        if (field === 'weight') onWeight(value as number);
      }}
      onToggleComplete={() => setSet((prev) => ({ ...prev, completed: !prev.completed }))}
      colors={anyColors}
      styles={anyStyles}
    />
  );
}

describe('SetLogger weight cell keeps decimals (B: 17.5 lb used to save as 175 lb)', () => {
  it('keeps the decimal point while typing and reports 17.5', async () => {
    const seen: number[] = [];
    const { getByTestId } = await render(<Harness onWeight={(w) => seen.push(w)} />);
    const cell = getByTestId('set-weight-0-0');
    await fireEvent.changeText(cell, '1');
    await fireEvent.changeText(cell, '17');
    await fireEvent.changeText(cell, '17.');
    expect(getByTestId('set-weight-0-0').props.value).toBe('17.');
    await fireEvent.changeText(getByTestId('set-weight-0-0'), '17.5');
    expect(getByTestId('set-weight-0-0').props.value).toBe('17.5');
    expect(seen[seen.length - 1]).toBe(17.5);
  });

  it('reads a comma as a decimal point and drops a second separator', () => {
    expect(sanitizeWeightText('22,5')).toBe('22.5');
    expect(sanitizeWeightText('2.5.5')).toBe('2.55');
    expect(sanitizeWeightText('abc45')).toBe('45');
    expect(parseWeightText('22.5')).toBe(22.5);
    expect(parseWeightText('')).toBe(0);
  });

  it('lets the reps cell be cleared instead of snapping back to 0', async () => {
    const { getByTestId } = await render(<Harness onWeight={() => undefined} />);
    await fireEvent.changeText(getByTestId('set-reps-0-0'), '');
    expect(getByTestId('set-reps-0-0').props.value).toBe('');
    await fireEvent.changeText(getByTestId('set-reps-0-0'), '12');
    expect(getByTestId('set-reps-0-0').props.value).toBe('12');
    expect(sanitizeRepsText('1.2')).toBe('12');
    expect(parseRepsText('')).toBe(0);
  });
});

describe('coach-assigned completion key (B: server @IsUUID rejected every completion)', () => {
  it('replaces the old `${assignmentId}:${Date.now()}` key with a UUID', () => {
    const k = assignmentIdempotencyKey('asg_1:1728230000000');
    expect(k).toMatch(IS_UUID);
  });
  it('keeps an existing UUID so a retry stays idempotent', () => {
    const uuid = '6f1c2a9e-3b7d-4c55-9a1e-2f0b8d7c6e5a';
    expect(assignmentIdempotencyKey(uuid)).toBe(uuid);
  });
});

describe('routine save payload (B: POST /routines always 400)', () => {
  const rows = [
    { exerciseId: 'a', exerciseName: 'Barbell Bench Press', sets: 5, reps: 5, restSec: 120, muscleGroup: 'chest' },
    { exerciseId: 'b', exerciseName: 'Bicep Curl', sets: 3, reps: 12, restSec: 60, muscleGroup: 'biceps' },
  ];
  it('sends exactly the CreateRoutineExerciseDto fields with a valid muscle group', () => {
    const body = buildRoutinePayload('  Push A ', rows);
    expect(body.name).toBe('Push A');
    for (const ex of body.exercises) {
      expect(Object.keys(ex).sort()).toEqual(ROUTINE_EXERCISE_DTO_FIELDS);
      expect(SERVER_MUSCLE_GROUPS).toContain(ex.muscle_group);
    }
    expect(body.exercises[0]).toEqual({
      exercise_name: 'Barbell Bench Press',
      muscle_group: 'chest',
      default_sets: 5,
      default_reps: 5,
      default_rest_seconds: 120,
      order_index: 0,
    });
    expect(body.exercises[1].muscle_group).toBe('arms');
    expect(body.exercises[1].order_index).toBe(1);
  });

  it('starts a saved routine with the sets, reps and rest the client built', () => {
    const routine = {
      id: 'r1',
      name: 'Push A',
      exercises: [
        { exercise_name: 'Barbell Bench Press', muscle_group: 'chest', default_sets: 5, default_reps: 5, default_rest_seconds: 120 },
      ],
    };
    const [seed] = routineToSessionExercises(routine);
    expect(seed).toMatchObject({ exerciseName: 'Barbell Bench Press', sets: 5, reps: 5, restSec: 120, muscleGroup: 'chest' });
    const [row] = routineToBuilderExercises(routine);
    expect(row).toMatchObject({ sets: 5, reps: 5, restSec: 120, muscleGroup: 'chest' });
  });

  it('maps catalog muscle labels to the server enum', () => {
    expect(toServerMuscleGroup('triceps')).toBe('arms');
    expect(toServerMuscleGroup('full body')).toBe('full_body');
    expect(toServerMuscleGroup('stretching')).toBe('full_body');
    expect(toServerMuscleGroup(undefined)).toBe('full_body');
  });
});

describe('coach view of a client workout (B: coach saw 0/0 sets, 0 lbs)', () => {
  it('maps WorkoutSession rows into real sets, name and duration', () => {
    const [s] = mapCoachWorkoutSessions([
      {
        id: 'w1',
        workout_name: 'Push A',
        date: '2026-10-06T00:00:00.000Z',
        created_at: '2026-10-06T17:45:00.000Z',
        duration_minutes: 45,
        exercises: [
          { exercise_name: 'Barbell Bench Press', sets_completed: 2, weight_per_set: [135, 145], reps_per_set: [8, 6] },
        ],
      },
    ]);
    expect(s.routineName).toBe('Push A');
    expect(s.endTime).toBe('2026-10-06T17:45:00.000Z');
    expect(new Date(s.endTime).getTime() - new Date(s.startTime).getTime()).toBe(45 * 60000);
    const ex = JSON.parse(s.exercises);
    expect(ex[0].exerciseName).toBe('Barbell Bench Press');
    expect(ex[0].sets).toEqual([
      { weight: 135, reps: 8, completed: true },
      { weight: 145, reps: 6, completed: true },
    ]);
  });
  it('returns an empty list for a missing payload', () => {
    expect(mapCoachWorkoutSessions(undefined)).toEqual([]);
  });
});

describe('history and dates', () => {
  it('shows weight and reps for each logged set', () => {
    expect(formatLoggedSets({ sets_completed: 2, weight_per_set: [135, 0], reps_per_set: [8, 12] })).toBe(
      '2 sets · 135 lb x 8, 12 reps',
    );
    expect(formatLoggedSets({ sets_completed: 1 })).toBe('1 set');
  });
  it('sends the client calendar day, not the UTC day', () => {
    expect(localCalendarDate(new Date(2026, 9, 6, 19, 30))).toBe('2026-10-06');
  });
  it('carries the coach target weight into the live session seed', () => {
    const seeds = buildActiveWorkoutExercises({
      exercises: [
        { id: 'pe1', exercise_external_id: 'seed:push-001', order: 1, sets: 3, reps_or_duration_seconds: 8, weight_lbs: 95, rest_seconds: 90 },
        { id: 'pe2', exercise_external_id: 'seed:push-003', order: 2, sets: 3, reps_or_duration_seconds: 15, weight_lbs: null, rest_seconds: null },
      ] as never,
    });
    expect(seeds[0].weightLbs).toBe(95);
    expect(seeds[1].weightLbs).toBeUndefined();
  });
});
