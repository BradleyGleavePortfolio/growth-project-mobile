/**
 * Convert a coach-assigned workout plan into the session payload the
 * ActiveWorkout screen expects. Extracted from WorkoutAssignmentDetailScreen
 * so the logic is unit-testable without pulling React Native into the test
 * runtime.
 */

import type { AssignmentExercise } from '../../api/workoutBuilderApi';

export interface SessionExerciseSeed {
  exerciseId: string;
  exerciseName: string;
  sets: number;
  reps: number;
  restSec: number;
  workoutPlanExerciseId?: string;
  /** Coach target weight (lb); ActiveWorkout pre-fills each set with it. */
  weightLbs?: number;
  /** The coach's note for this exercise, shown during the live workout. */
  coachNote?: string;
}

export function buildActiveWorkoutExercises(
  plan: { exercises: readonly AssignmentExercise[] },
): SessionExerciseSeed[] {
  return [...plan.exercises]
    .sort((a, b) => a.order - b.order)
    .map(exerciseToSessionSeed);
}

// A frozen snapshot row has no plan-row id: it is left out, never made up,
// and an empty catalog id falls back to an assignment-local key by order.
function exerciseToSessionSeed(ex: AssignmentExercise): SessionExerciseSeed {
  const id = ex.exercise_external_id
    || (ex.id ? `plan-exercise:${ex.id}` : `assignment-exercise:${ex.order}`);
  return {
    exerciseId: id,
    exerciseName: prettifyExerciseName(ex.exercise_external_id) || 'Exercise',
    sets: ex.sets,
    reps: ex.reps_or_duration_seconds,
    restSec: ex.rest_seconds ?? 60,
    ...(ex.id ? { workoutPlanExerciseId: ex.id } : {}),
    ...(ex.weight_lbs && ex.weight_lbs > 0 ? { weightLbs: ex.weight_lbs } : {}),
    ...(ex.notes && ex.notes.trim() ? { coachNote: ex.notes.trim() } : {}),
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
