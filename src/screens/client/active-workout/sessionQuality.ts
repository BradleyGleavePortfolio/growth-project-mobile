import type { Exercise, SessionExercise, SessionSet } from './types';
import { toServerMuscleGroup } from '../../../utils/workout/muscleGroup';
import { setVolume, unitField, unitOf } from '../../../utils/workout/exerciseUnit';

export interface LoggedExercise {
  exercise_name: string;
  muscle_group: string;
  sets_completed: number;
  reps_per_set: number[];
  weight_per_set: number[];
  notes?: string | null;
  rpe?: number | null;
  video_url?: string | null;
  /**
   * SET-ASKED (b#1219): the assignment and row order a logged exercise came
   * from. Sent only for an exercise logged from an assignment.
   */
  plan_assignment_id?: string | null;
  plan_order?: number | null;
  /** Read only: what the coach asked, as the server froze it. Never sent. */
  asked_sets?: number | null;
  asked_count?: number | null;
  asked_unit?: string | null;
  asked_weight_lbs?: number | null;
}

export interface LoggedWorkout {
  id: string;
  workout_name?: string;
  notes?: string | null;
  duration_minutes?: number | null;
  exercises: LoggedExercise[];
}

const nameKey = (name: string) => name.trim().toLowerCase();

/**
 * API returns newest first. Match names because saved workouts have no catalog id.
 * LS-928R2 B1: only a past exercise counted in today's unit is offered (a saved
 * row with no asked_unit counts reps); reps and seconds are never converted.
 */
export function previousSets(history: LoggedWorkout[], name: string, unit?: unknown): SessionSet[] {
  const today = unitOf({ unit });
  for (const workout of history) {
    const exercise = workout.exercises?.find((e) => nameKey(e.exercise_name) === nameKey(name)
      && unitOf({ unit: e.asked_unit }) === today);
    if (exercise?.sets_completed) {
      return Array.from({ length: exercise.sets_completed }, (_, i) => ({
        weight: exercise.weight_per_set[i] ?? 0,
        reps: exercise.reps_per_set[i] ?? 0,
        completed: false,
      }));
    }
  }
  return [];
}

export function moveExercise(exercises: SessionExercise[], index: number, direction: -1 | 1) {
  const target = index + direction;
  if (target < 0 || target >= exercises.length) return exercises;
  const next = [...exercises];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function newSessionExercise(exercise: Exercise): SessionExercise {
  return {
    exerciseId: exercise.id,
    exerciseName: exercise.name,
    muscleGroup: toServerMuscleGroup(exercise.muscle),
    restSec: 60,
    sets: Array.from({ length: 3 }, () => ({ weight: 0, reps: 10, completed: false })),
  };
}

/** A swap affects unlogged work only; logged sets retain their real exercise identity. */
export function swapExercise(exercises: SessionExercise[], index: number, replacement: Exercise) {
  const original = exercises[index];
  const remaining = original.sets.filter((s) => !s.completed);
  const next = newSessionExercise(replacement);
  next.restSec = original.restSec ?? 60;
  if (remaining.length) {
    next.sets = remaining.map((s) => ({ reps: s.reps, weight: 0, completed: false }));
  }
  const result = [...exercises];
  const logged = original.sets.filter((s) => s.completed);
  if (logged.length) result.splice(index, 1, { ...original, sets: logged }, next);
  else result.splice(index, 1, next);
  return result;
}

/**
 * TIMED-SETS-M: `{ plan_assignment_id, plan_order }` for an exercise logged
 * from an assignment (both known), else `{}`. A free workout, an added or a
 * swapped-in exercise has no plan order, so it sends neither.
 */
function planRowFields(
  exercise: SessionExercise,
  planAssignmentId?: string,
): { plan_assignment_id?: string; plan_order?: number } {
  const id = exercise.planAssignmentId ?? planAssignmentId;
  return typeof id === 'string' && id.length > 0 && typeof exercise.planOrder === 'number'
    ? { plan_assignment_id: id, plan_order: exercise.planOrder }
    : {};
}

export function completedExercisePayload(exercise: SessionExercise, planAssignmentId?: string): LoggedExercise {
  const sets = exercise.sets.filter((s) => s.completed);
  return {
    exercise_name: exercise.exerciseName,
    muscle_group: toServerMuscleGroup(exercise.muscleGroup),
    sets_completed: sets.length,
    weight_per_set: sets.map((s) => s.weight),
    reps_per_set: sets.map((s) => s.reps),
    notes: exercise.notes ?? '',
    ...planRowFields(exercise, planAssignmentId),
  };
}

export function workoutSummary(exercises: SessionExercise[], history: LoggedWorkout[]) {
  const done = exercises.filter((e) => e.sets.some((s) => s.completed));
  const sets = done.flatMap((e) => e.sets.filter((s) => s.completed));
  const records = done.flatMap((exercise) => {
    const prior = history.flatMap((w) => (w.exercises ?? [])
      .filter((e) => nameKey(e.exercise_name) === nameKey(exercise.exerciseName))
      .flatMap((e) => e.weight_per_set));
    const best = Math.max(0, ...exercise.sets.filter((s) => s.completed && s.reps > 0).map((s) => s.weight));
    return prior.length && best > Math.max(...prior)
      ? [{ name: exercise.exerciseName, weight: best }]
      : [];
  });
  // LS-928 B4: a set counted in seconds adds no lb volume.
  const volume = done.reduce((sum, e) => sum + e.sets.reduce(
    (inner, s) => inner + (s.completed ? setVolume(s.weight, s.reps, e.unit) : 0), 0), 0);
  return { exercises: done.length, sets: sets.length, volume, records };
}

export function loggedWorkoutExercises(workout: LoggedWorkout): SessionExercise[] {
  return workout.exercises.map((e, index) => ({
    exerciseId: `logged:${index}`,
    exerciseName: e.exercise_name,
    muscleGroup: e.muscle_group,
    notes: e.notes ?? '',
    // LS-928 B1: a saved timed exercise stays in seconds in the history edit.
    ...unitField(e.asked_unit),
    // The plan row the server stored is sent back as it was (PUT is replace-all).
    ...(typeof e.plan_assignment_id === 'string' && e.plan_assignment_id && typeof e.plan_order === 'number'
      ? { planAssignmentId: e.plan_assignment_id, planOrder: e.plan_order }
      : {}),
    sets: Array.from({ length: e.sets_completed }, (_, i) => ({
      weight: e.weight_per_set[i] ?? 0,
      reps: e.reps_per_set[i] ?? 0,
      completed: true,
    })),
  }));
}

/** Replace-all endpoint: preserve every unedited exercise field, not server row ids. */
export function loggedWorkoutEditPayload(workout: LoggedWorkout, exercises: SessionExercise[], notes: string) {
  return {
    notes,
    exercises: exercises.map((e, i) => ({
      ...completedExercisePayload(e),
      rpe: workout.exercises[i].rpe ?? undefined,
      video_url: workout.exercises[i].video_url ?? undefined,
    })),
  };
}
