import type { Exercise, SessionExercise, SessionSet } from './types';
import { toServerMuscleGroup } from '../../../utils/workout/muscleGroup';

export interface LoggedExercise {
  exercise_name: string;
  muscle_group: string;
  sets_completed: number;
  reps_per_set: number[];
  weight_per_set: number[];
  notes?: string | null;
  rpe?: number | null;
  video_url?: string | null;
}

export interface LoggedWorkout {
  id: string;
  workout_name?: string;
  notes?: string | null;
  duration_minutes?: number | null;
  exercises: LoggedExercise[];
}

const nameKey = (name: string) => name.trim().toLowerCase();

/** API returns newest first. Match names because saved workouts have no catalog id. */
export function previousSets(history: LoggedWorkout[], name: string): SessionSet[] {
  for (const workout of history) {
    const exercise = workout.exercises?.find((e) => nameKey(e.exercise_name) === nameKey(name));
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

export function completedExercisePayload(exercise: SessionExercise): LoggedExercise {
  const sets = exercise.sets.filter((s) => s.completed);
  return {
    exercise_name: exercise.exerciseName,
    muscle_group: toServerMuscleGroup(exercise.muscleGroup),
    sets_completed: sets.length,
    weight_per_set: sets.map((s) => s.weight),
    reps_per_set: sets.map((s) => s.reps),
    notes: exercise.notes ?? '',
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
  return { exercises: done.length, sets: sets.length, volume: sets.reduce((sum, s) => sum + s.weight * s.reps, 0), records };
}

export function loggedWorkoutExercises(workout: LoggedWorkout): SessionExercise[] {
  return workout.exercises.map((e, index) => ({
    exerciseId: `logged:${index}`,
    exerciseName: e.exercise_name,
    muscleGroup: e.muscle_group,
    notes: e.notes ?? '',
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
