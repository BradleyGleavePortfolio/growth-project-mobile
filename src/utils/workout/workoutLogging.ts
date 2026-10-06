/**
 * Pure helpers for client workout logging (UX-WORKOUT-124). Kept free of
 * React / navigation / storage imports so they are cheap to test.
 */
import { randomUuid } from '../idempotency';
import { routineExerciseId } from './exerciseId';
import { toServerMuscleGroup } from './muscleGroup';

// PATCH /assignments/:id/complete validates `idempotency_key` with
// @IsUUID('all'). The key used to be `${assignmentId}:${Date.now()}`, which
// the server rejected with a 400 on every coach-assigned workout, so the
// coach never saw the workout as done. A session saved by an earlier build
// may still carry the old shape; it is replaced at completion time.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function assignmentIdempotencyKey(current: string): string {
  return UUID_RE.test(current) ? current : randomUuid();
}

/** The client's own calendar day, YYYY-MM-DD (server column is @db.Date). */
export function localCalendarDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export interface RoutineBuilderExercise {
  exerciseId: string;
  exerciseName: string;
  sets: number;
  reps: number;
  restSec: number;
  /** Server MuscleGroup value (POST /routines requires one per exercise). */
  muscleGroup: string;
}

/**
 * Body for POST /routines and PUT /routines/:id. Field names follow the
 * server's CreateRoutineExerciseDto (default_sets / default_reps /
 * default_rest_seconds / muscle_group / order_index). The builder used to
 * send { sets, reps, rest_sec }, which the server's strict validation
 * rejected with a 400, so no routine could ever be saved.
 */
export function buildRoutinePayload(name: string, exercises: RoutineBuilderExercise[]) {
  return {
    name: name.trim(),
    exercises: exercises.map((e, i) => ({
      exercise_name: e.exerciseName,
      muscle_group: toServerMuscleGroup(e.muscleGroup),
      default_sets: Math.max(1, Math.round(e.sets || 0)),
      default_reps: Math.max(1, Math.round(e.reps || 0)),
      default_rest_seconds: Math.max(0, Math.round(e.restSec || 0)),
      order_index: i,
    })),
  };
}

/** GET /routines row (RoutineExercise schema field names). */
export interface ApiRoutine {
  id: string;
  name: string;
  exercises: Array<{
    id?: string;
    exercise_name: string;
    muscle_group: string;
    default_sets: number;
    default_reps: number;
    default_rest_seconds?: number;
  }>;
  is_template?: boolean;
}

/** Builder rows hydrated from a saved routine. */
export function routineToBuilderExercises(routine: Pick<ApiRoutine, 'exercises'>): RoutineBuilderExercise[] {
  return (routine.exercises || []).map((e) => ({
    exerciseId: e.id || '',
    exerciseName: e.exercise_name || '',
    sets: e.default_sets || 3,
    reps: e.default_reps || 10,
    restSec: e.default_rest_seconds ?? 60,
    muscleGroup: toServerMuscleGroup(e.muscle_group),
  }));
}

/**
 * Seed ActiveWorkout from a saved routine. The Workouts tab used to read
 * `sets_target` / `reps_target`, which the server never sends, so every
 * routine started as 3 x 10 with 60 s rest whatever the client had built.
 */
export function routineToSessionExercises(routine: ApiRoutine) {
  return (routine.exercises || []).map((e) => ({
    exerciseId: routineExerciseId(routine.id, e.exercise_name),
    exerciseName: e.exercise_name,
    sets: e.default_sets || 3,
    reps: e.default_reps || 10,
    restSec: e.default_rest_seconds ?? 60,
    muscleGroup: toServerMuscleGroup(e.muscle_group),
  }));
}

/**
 * One line per logged exercise: "3 sets · 135 lb x 8, 135 lb x 8, 145 lb x 6".
 * The history card used to list only the weights, so the reps the client
 * logged were never shown back to them.
 */
export function formatLoggedSets(ex: {
  sets_completed: number;
  weight_per_set?: number[];
  reps_per_set?: number[];
}): string {
  const weights = ex.weight_per_set || [];
  const reps = ex.reps_per_set || [];
  const n = Math.max(weights.length, reps.length);
  const head = `${ex.sets_completed} ${ex.sets_completed === 1 ? 'set' : 'sets'}`;
  if (n === 0) return head;
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    const w = weights[i] ?? 0;
    const r = reps[i] ?? 0;
    parts.push(w > 0 ? `${w} lb x ${r}` : `${r} reps`);
  }
  return `${head} · ${parts.join(', ')}`;
}

type CoachSessionExercise = {
  id?: string;
  exercise_name?: string;
  name?: string;
  sets_completed?: number;
  weight_per_set?: number[];
  reps_per_set?: number[];
  sets_data?: unknown[];
};
type CoachSessionRow = {
  id: string;
  workout_name?: string;
  name?: string;
  notes?: string | null;
  date?: string;
  created_at?: string;
  completed_at?: string;
  duration_minutes?: number | null;
  exercises?: CoachSessionExercise[];
};

/**
 * Map the coach client-detail `recent_workouts` rows (WorkoutSession with
 * exercises: workout_name, created_at, duration_minutes, weight_per_set,
 * reps_per_set) into the WorkoutsTab session shape. The old mapping read
 * name / completed_at / sets_data, which the server does not send, so the
 * coach saw every client workout as "Workout", "In progress", 0/0 sets and
 * 0 lbs.
 */
export function mapCoachWorkoutSessions(rows: unknown) {
  const list = Array.isArray(rows) ? (rows as CoachSessionRow[]) : [];
  return list.map((s) => {
    const finishedAt = s.completed_at || s.created_at || s.date || '';
    const finishedMs = new Date(finishedAt).getTime();
    const minutes = typeof s.duration_minutes === 'number' ? s.duration_minutes : null;
    const startTime =
      minutes !== null && Number.isFinite(finishedMs)
        ? new Date(finishedMs - minutes * 60000).toISOString()
        : finishedAt;
    return {
      id: s.id,
      routineName: s.workout_name || s.name || s.notes || 'Workout',
      startTime,
      endTime: finishedAt,
      completed: true,
      exercises: JSON.stringify((s.exercises || []).map((ex) => {
        const name = ex.exercise_name || ex.name || 'Exercise';
        const weights = Array.isArray(ex.weight_per_set) ? ex.weight_per_set : [];
        const reps = Array.isArray(ex.reps_per_set) ? ex.reps_per_set : [];
        const n = Math.max(weights.length, reps.length, ex.sets_completed ?? 0);
        const sets = Array.isArray(ex.sets_data) && ex.sets_data.length > 0
          ? ex.sets_data
          : Array.from({ length: n }, (_, i) => ({
              weight: weights[i] ?? 0,
              reps: reps[i] ?? 0,
              completed: true,
            }));
        return {
          // Always emit a real id; fall back to a stable session-scoped slug.
          exerciseId:
            ex.id ||
            `session:${s.id}/${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
          exerciseName: name,
          sets,
        };
      })),
    };
  });
}
