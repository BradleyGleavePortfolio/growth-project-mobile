/**
 * Plain-object model for a locally-logged workout session.
 *
 * Maps 1:1 to a row in the `workout_logs` SQLite table created in
 * `src/offline/database.ts`. Replaces the previous WatermelonDB Model class
 * — see migration note in docs/offline-architecture.md.
 *
 * Why a plain object + helper functions instead of a class?
 *   - SQLite returns plain rows, no instance methods. Parsing into a typed
 *     interface is zero-cost and TS-friendly.
 *   - Behaviour that used to live on the model (toServerPayload, parsedSets,
 *     markSynced, markConflict) is now exposed as standalone helper
 *     functions in this file. Callers compose them explicitly, which is
 *     easier to test and easier to read.
 */

export type SyncStatus = 'pending' | 'synced' | 'conflict';

export interface ParsedSet {
  reps: number;
  weight: number;
  completed: boolean;
}

export interface WorkoutPayload {
  date: string;
  duration_minutes: number;
  notes: string;
  exercises: Array<{
    exercise_name: string;
    sets_completed: number;
    weight_per_set: number[];
    reps_per_set: number[];
  }>;
  local_id: string;
}

/**
 * Typed shape of a `workout_logs` row.
 *
 * `loggedAt` is a JS `Date` object on the in-memory side; on disk it is
 * stored as a Unix epoch millisecond integer (`logged_at` column) so the
 * DB stays portable and INTEGER-indexable.
 */
export interface WorkoutLog {
  id: string;
  exerciseId: string;
  setsData: string;
  syncStatus: SyncStatus;
  loggedAt: Date;
  serverId: string | null;
  sessionName: string | null;
  durationMinutes: number | null;
}

// ─── Row <-> object mappers ──────────────────────────────────────────────────

interface WorkoutLogRow {
  id: string;
  exercise_id: string;
  sets_data: string;
  sync_status: SyncStatus;
  logged_at: number;
  server_id: string | null;
  session_name: string | null;
  duration_minutes: number | null;
}

/** Convert a raw SQLite row into the typed WorkoutLog shape. */
export function rowToWorkoutLog(row: WorkoutLogRow): WorkoutLog {
  return {
    id: row.id,
    exerciseId: row.exercise_id,
    setsData: row.sets_data,
    syncStatus: row.sync_status,
    loggedAt: new Date(row.logged_at),
    serverId: row.server_id,
    sessionName: row.session_name,
    durationMinutes: row.duration_minutes,
  };
}

// ─── Helper functions (replace model instance methods) ──────────────────────

/** Parse the JSON-serialised sets_data column into a typed array. */
export function parsedSets(log: WorkoutLog): ParsedSet[] {
  try {
    return JSON.parse(log.setsData) as ParsedSet[];
  } catch {
    return [];
  }
}

/**
 * Serialize a record into the shape the backend /workouts endpoint expects.
 * Called by the sync engine when pushing pending records.
 */
export function toServerPayload(log: WorkoutLog): WorkoutPayload {
  const sets = parsedSets(log).filter((s) => s.completed);
  return {
    date: log.loggedAt
      ? log.loggedAt.toISOString()
      : new Date().toISOString(),
    duration_minutes: log.durationMinutes ?? 0,
    notes: log.sessionName ?? '',
    exercises: [
      {
        exercise_name: log.exerciseId,
        sets_completed: sets.length,
        weight_per_set: sets.map((s) => s.weight),
        reps_per_set: sets.map((s) => s.reps),
      },
    ],
    local_id: log.id,
  };
}

// Default export keeps the import-as-default pattern used elsewhere
// (`import WorkoutLog from '../offline/models/WorkoutLog'`) working as a
// type-only re-export. Consumers that previously instantiated the class
// no longer exist — every call site imports the helpers from
// `../offline` (the barrel) which now exports the helper functions.
const _default = {} as WorkoutLog;
export default _default;
