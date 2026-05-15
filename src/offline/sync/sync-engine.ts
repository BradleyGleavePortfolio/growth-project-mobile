/**
 * Offline sync engine for The Growth Project.
 *
 * Runs on top of expo-sqlite (see ../database.ts). Replaces the previous
 * WatermelonDB-based engine with a thin SQL implementation that:
 *
 *   1. Pull: fetch recent server-side workouts on login / reconnect and
 *      cache them as `synced` records so the local read path has up-to-date
 *      data even on a fresh install.
 *   2. Push: iterate every `pending` workout_log and POST it to the backend.
 *      On success → mark `synced` + store server ID.
 *      On conflict (409) → server-wins: mark `conflict`, surface a toast.
 *      On network error → leave `pending`, retry next time.
 *
 * Conflict policy (server wins):
 *   When the server returns HTTP 409 for a record, the local copy is marked
 *   `conflict` and a non-blocking toast is emitted via the conflict-toast
 *   event bus (see `conflictToastEvents`). The UI can subscribe and show a
 *   banner. The server copy is NOT written back to local DB in this
 *   foundation; that is a follow-up once the full pull-sync loop is
 *   validated under production traffic.
 *
 * Usage:
 *   - Call `triggerSync()` from useNetworkStatus listener when online.
 *   - Call `triggerSync()` after a successful auth/login to pull latest data.
 *   - New workout writes go through `writeWorkoutLog()` — never direct DB
 *     mutations.
 *
 * @see docs/offline-architecture.md
 */
import EventEmitter from 'eventemitter3';
import { getDatabase } from '../database';
import {
  WorkoutLog,
  rowToWorkoutLog,
  toServerPayload,
} from '../models/WorkoutLog';
import { workoutApi } from '../../services/api';
import { generateId } from '../../utils/date';

// ---------------------------------------------------------------------------
// Conflict toast event bus
// ---------------------------------------------------------------------------
// Components subscribe with conflictToastEvents.on('conflict', cb).
export const conflictToastEvents = new EventEmitter();
// eventemitter3's setMaxListeners is a no-op (it doesn't warn) — the call is
// preserved here for API parity with the previous WatermelonDB-era code that
// used the Node `events` module. Safe and idempotent.
(conflictToastEvents as unknown as { setMaxListeners?: (n: number) => void })
  .setMaxListeners?.(20);

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------
let syncInProgress = false;

// ---------------------------------------------------------------------------
// Write path
// ---------------------------------------------------------------------------

export interface WriteWorkoutPayload {
  exerciseId: string;
  setsData: string;
  sessionName?: string;
  durationMinutes?: number;
}

/**
 * Write a new workout log to the local database with `pending` sync status.
 * The sync engine will push it to the server on the next `triggerSync()`
 * call.
 *
 * Returns the freshly-written record (including the locally-generated UUID)
 * so the caller can correlate it with UI state if desired.
 */
export async function writeWorkoutLog(
  payload: WriteWorkoutPayload,
): Promise<WorkoutLog> {
  // B2: refuse to persist an empty / whitespace exerciseId — rows like that
  // poisoned the local volume aggregations and produced bare-id sessions that
  // the sync engine could not correlate with the server catalog.
  const trimmedExerciseId = (payload.exerciseId ?? '').trim();
  if (!trimmedExerciseId) {
    throw new Error(
      'writeWorkoutLog: exerciseId is required (refusing to write empty row)',
    );
  }

  const db = await getDatabase();
  const id = generateId();
  const loggedAt = Date.now();

  await db.runAsync(
    `INSERT INTO workout_logs
       (id, exercise_id, sets_data, sync_status, logged_at,
        server_id, session_name, duration_minutes)
     VALUES (?, ?, ?, 'pending', ?, NULL, ?, ?)`,
    [
      id,
      trimmedExerciseId,
      payload.setsData,
      loggedAt,
      payload.sessionName ?? null,
      payload.durationMinutes ?? null,
    ],
  );

  return {
    id,
    exerciseId: trimmedExerciseId,
    setsData: payload.setsData,
    syncStatus: 'pending',
    loggedAt: new Date(loggedAt),
    serverId: null,
    sessionName: payload.sessionName ?? null,
    durationMinutes: payload.durationMinutes ?? null,
  };
}

// ---------------------------------------------------------------------------
// Internal mutators (used by the sync loop and exposed for direct testing)
// ---------------------------------------------------------------------------

async function markSynced(id: string, serverId: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE workout_logs SET sync_status = 'synced', server_id = ? WHERE id = ?`,
    [serverId, id],
  );
}

async function markConflict(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE workout_logs SET sync_status = 'conflict' WHERE id = ?`,
    [id],
  );
}

// ---------------------------------------------------------------------------
// Push pending records
// ---------------------------------------------------------------------------

async function pushPending(): Promise<void> {
  const db = await getDatabase();

  const rows = await db.getAllAsync<Parameters<typeof rowToWorkoutLog>[0]>(
    `SELECT id, exercise_id, sets_data, sync_status, logged_at,
            server_id, session_name, duration_minutes
       FROM workout_logs
      WHERE sync_status = 'pending'`,
  );
  const pending: WorkoutLog[] = rows.map(rowToWorkoutLog);

  for (const log of pending) {
    try {
      const serverPayload = toServerPayload(log);
      const response = await workoutApi.create(
        serverPayload as unknown as Record<string, unknown>,
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = response.data as any;
      const serverId: string = data?.id ?? data?.workout?.id ?? '';
      await markSynced(log.id, serverId);
    } catch (err: unknown) {
      const status =
        (err as { response?: { status?: number } })?.response?.status;
      if (status === 409) {
        // Conflict: server has a newer version — mark local as conflict.
        await markConflict(log.id);
        conflictToastEvents.emit('conflict', {
          localId: log.id,
          message:
            'A workout was updated elsewhere. Your local version has been marked as conflicting.',
        });
      }
      // For all other errors (network timeout, 5xx, etc.) leave as pending.
      // The engine will retry on the next triggerSync() call.
      if (__DEV__) {
        console.warn('[SyncEngine] push failed for record', log.id, err);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Pull recent server records
// ---------------------------------------------------------------------------

/**
 * Pull the N most recent workouts from the server and upsert them as
 * `synced` records. Used after login to pre-populate the local DB so the
 * workout history is immediately visible without a pending state.
 *
 * This is a one-way pull: server → local. It will NOT overwrite records
 * that are currently `pending` (user has unsent edits in flight).
 */
export async function pullFromServer(limit = 20): Promise<void> {
  try {
    const response = await workoutApi.getAll(limit);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = response.data as any;
    const workouts: Array<Record<string, unknown>> = Array.isArray(raw)
      ? raw
      : (raw?.workouts ?? []);

    if (!workouts.length) return;

    const db = await getDatabase();

    for (const w of workouts) {
      const serverId = String(w.id ?? '');
      if (!serverId) continue;

      // Check if we already have this server record.
      const existing = await db.getFirstAsync<{ id: string }>(
        `SELECT id FROM workout_logs WHERE server_id = ? LIMIT 1`,
        [serverId],
      );
      if (existing) {
        // Already present — skip to avoid overwriting pending edits.
        continue;
      }

      // Derive a representative sets_data blob from the server shape.
      const exercises: Array<Record<string, unknown>> = Array.isArray(
        w.exercises,
      )
        ? (w.exercises as Array<Record<string, unknown>>)
        : [];
      const firstExercise = exercises[0] ?? {};
      const repsPerSet = Array.isArray(firstExercise.reps_per_set)
        ? (firstExercise.reps_per_set as number[])
        : [];
      const weightPerSet = Array.isArray(firstExercise.weight_per_set)
        ? (firstExercise.weight_per_set as number[])
        : [];

      const setsData = JSON.stringify(
        repsPerSet.map((reps, i) => ({
          reps,
          weight: weightPerSet[i] ?? 0,
          completed: true,
        })),
      );

      await db.runAsync(
        `INSERT INTO workout_logs
           (id, exercise_id, sets_data, sync_status, logged_at,
            server_id, session_name, duration_minutes)
         VALUES (?, ?, ?, 'synced', ?, ?, ?, ?)`,
        [
          generateId(),
          String(firstExercise.exercise_name ?? ''),
          setsData,
          Date.now(),
          serverId,
          String(w.notes ?? ''),
          typeof w.duration_minutes === 'number'
            ? w.duration_minutes
            : null,
        ],
      );
    }
  } catch (err) {
    // Pull failures are non-fatal — local data remains usable.
    if (__DEV__) {
      console.warn('[SyncEngine] pullFromServer failed', err);
    }
  }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Trigger a full sync cycle: push pending → pull recent server data.
 * Safe to call multiple times; a guard prevents overlapping cycles.
 *
 * Call from:
 *   - The useNetworkStatus listener when transitioning to online.
 *   - After a successful login.
 *   - Optionally on app foreground (after biometric unlock).
 */
export async function triggerSync(): Promise<void> {
  if (syncInProgress) return;
  syncInProgress = true;
  try {
    await pushPending();
    await pullFromServer();
  } finally {
    syncInProgress = false;
  }
}

/** Exposed for tests. */
export function __isSyncInProgress(): boolean {
  return syncInProgress;
}
