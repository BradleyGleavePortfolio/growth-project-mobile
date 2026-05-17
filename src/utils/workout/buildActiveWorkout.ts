/**
 * Convert a coach-assigned workout plan into the session payload the
 * ActiveWorkout screen expects. Extracted from WorkoutAssignmentDetailScreen
 * so the logic is unit-testable without pulling React Native into the test
 * runtime.
 */

import type {
  WorkoutPlan,
  WorkoutPlanExercise,
} from '../../api/workoutBuilderApi';

export interface SessionExerciseSeed {
  exerciseId: string;
  exerciseName: string;
  sets: number;
  reps: number;
  restSec: number;
  workoutPlanExerciseId?: string;
}

export function buildActiveWorkoutExercises(
  plan: Pick<WorkoutPlan, 'exercises'>,
): SessionExerciseSeed[] {
  return [...plan.exercises]
    .sort((a, b) => a.order - b.order)
    .map(exerciseToSessionSeed);
}

function exerciseToSessionSeed(ex: WorkoutPlanExercise): SessionExerciseSeed {
  const id = ex.exercise_external_id || `plan-exercise:${ex.id}`;
  return {
    exerciseId: id,
    exerciseName: prettifyExerciseName(ex.exercise_external_id) || 'Exercise',
    sets: ex.sets,
    reps: ex.reps_or_duration_seconds,
    restSec: ex.rest_seconds ?? 60,
    workoutPlanExerciseId: ex.id,
  };
}

export function prettifyExerciseName(externalId: string): string {
  if (!externalId) return '';
  const stripped = externalId.replace(/^seed:/i, '');
  if (/^\d+$/.test(stripped)) return 'Exercise';
  return stripped
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}
