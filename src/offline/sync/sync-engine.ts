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
 *      On other 4xx (non-401) → permanent: mark `dead_letter` so we stop
 *        hammering the server on every triggerSync (Hunt P1-1).
 *      On 401 / 5xx / network error → leave `pending`, retry next time.
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
import { readUserCacheSync } from '../../lib/userCache';

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

// Dead-letter toast: emitted when a row is permanently rejected by the server
// (4xx other than 401/409). UI can subscribe to surface a "we couldn't sync"
// banner; the existing conflict-toast subscriber is the documented anchor for
// any future UI work in this area. Until a dedicated UI lands, the count is
// visible via Sentry breadcrumbs (logged in pushPending below).
export const deadLetterEvents = new EventEmitter();

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
  const userId = readUserCacheSync()?.id ?? null;

  await db.runAsync(
    `INSERT INTO workout_logs
       (id, exercise_id, sets_data, sync_status, logged_at,
        server_id, session_name, duration_minutes, user_id)
     VALUES (?, ?, ?, 'pending', ?, NULL, ?, ?, ?)`,
    [
      id,
      trimmedExerciseId,
      payload.setsData,
      loggedAt,
      payload.sessionName ?? null,
      payload.durationMinutes ?? null,
      userId,
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
    userId,
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

async function markDeadLetter(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE workout_logs SET sync_status = 'dead_letter' WHERE id = ?`,
    [id],
  );
}

/**
 * Mark every pending row that belongs to the same session as synced after
 * the parent API mutate succeeded. Without this, the local rows the
 * ActiveWorkout screen wrote stay pending and the next `triggerSync()` call
 * re-POSTs them as N additional single-exercise workouts on the server (the
 * W-1 duplication bug in the audit).
 *
 * Correlation key is `session_name` — every row written from a single
 * ActiveWorkout finish carries the same routine name and was written within
 * a few milliseconds of each other. We additionally bound the match window
 * by `logged_at` to avoid accidentally synthesising a sync confirmation for
 * unrelated older rows the user happened to log under a routine with the
 * same name.
 */
export async function markSessionSyncedBySessionName(
  sessionName: string,
  serverId: string,
  windowMs = 60_000,
): Promise<number> {
  if (!sessionName) return 0;
  const db = await getDatabase();
  const since = Date.now() - windowMs;
  const result = await db.runAsync(
    `UPDATE workout_logs
        SET sync_status = 'synced', server_id = ?
      WHERE sync_status = 'pending'
        AND session_name = ?
        AND logged_at >= ?`,
    [serverId, sessionName, since],
  );
  return (result as unknown as { changes?: number })?.changes ?? 0;
}

// ---------------------------------------------------------------------------
// Per-user cleanup (called from signOut)
// ---------------------------------------------------------------------------

/**
 * Delete every workout_logs row belonging to a single user. Used by signOut
 * to scrub the signing-out account's offline data without touching rows
 * belonging to other accounts that might share the device. Rows with NULL
 * user_id (rows written before the v2 migration that could not be
 * backfilled) are not deleted here — they are orphaned, not leaked, and the
 * push gate refuses to send them under another user's JWT.
 */
export async function deleteWorkoutLogsForUser(userId: string): Promise<number> {
  if (!userId) return 0;
  const db = await getDatabase();
  const result = await db.runAsync(
    `DELETE FROM workout_logs WHERE user_id = ?`,
    [userId],
  );
  return (result as unknown as { changes?: number })?.changes ?? 0;
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

type PushErrorClass = 'conflict' | 'permanent' | 'transient';

function classifyPushError(err: unknown): PushErrorClass {
  const status = (err as { response?: { status?: number } })?.response?.status;
  if (status === 409) return 'conflict';
  if (typeof status === 'number') {
    // 401 → bubble back as transient; the request layer will refresh the
    // session and the next triggerSync cycle re-pushes.
    if (status === 401) return 'transient';
    // 5xx → transient by definition.
    if (status >= 500) return 'transient';
    // Any other 4xx (400/403/404/422/etc.) means the server has rejected
    // this payload permanently. Don't loop on it.
    if (status >= 400) return 'permanent';
  }
  // No status (network / timeout) → transient.
  return 'transient';
}

// ---------------------------------------------------------------------------
// Push pending records
// ---------------------------------------------------------------------------

async function pushPending(): Promise<void> {
  const db = await getDatabase();

  // R15: only push rows belonging to the currently-signed-in user. Rows
  // with a foreign user_id stay in the DB (we want account switching to
  // resume gracefully), but they must never be POSTed under another user's
  // JWT.
  const currentUserId = readUserCacheSync()?.id;
  if (!currentUserId) {
    // No signed-in user → nothing to push. Don't even read the table.
    return;
  }

  const rows = await db.getAllAsync<Parameters<typeof rowToWorkoutLog>[0]>(
    `SELECT id, exercise_id, sets_data, sync_status, logged_at,
            server_id, session_name, duration_minutes, user_id
       FROM workout_logs
      WHERE sync_status = 'pending'
        AND user_id = ?`,
    [currentUserId],
  );
  const pending: WorkoutLog[] = rows.map(rowToWorkoutLog);

  let deadLettered = 0;

  for (const log of pending) {
    try {
      const serverPayload = toServerPayload(log);
      const response = await workoutApi.create(
        serverPayload as unknown as Record<string, unknown>,
      );
      const data = response.data as { id?: string; workout?: { id?: string } };
      const serverId: string = data?.id ?? data?.workout?.id ?? '';
      await markSynced(log.id, serverId);
    } catch (err: unknown) {
      const errorClass = classifyPushError(err);
      if (errorClass === 'conflict') {
        await markConflict(log.id);
        conflictToastEvents.emit('conflict', {
          localId: log.id,
          message:
            'A workout was updated elsewhere. Your local version has been marked as conflicting.',
        });
      } else if (errorClass === 'permanent') {
        await markDeadLetter(log.id);
        deadLettered++;
        if (__DEV__) {
          console.warn(
            '[SyncEngine] push dead-lettered (permanent 4xx)',
            log.id,
            (err as { response?: { status?: number } })?.response?.status,
          );
        }
      }
      // transient errors (401/5xx/network): leave `pending` for the next cycle.
      if (__DEV__) {
        console.warn('[SyncEngine] push failed for record', log.id, err);
      }
    }
  }

  if (deadLettered > 0) {
    deadLetterEvents.emit('dead_letter', { count: deadLettered });
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
    const raw = response.data as
      | Array<Record<string, unknown>>
      | { workouts?: Array<Record<string, unknown>> }
      | null
      | undefined;
    const workouts: Array<Record<string, unknown>> = Array.isArray(raw)
      ? raw
      : ((raw as { workouts?: Array<Record<string, unknown>> } | null)
          ?.workouts ?? []);

    if (!workouts.length) return;

    const db = await getDatabase();
    const currentUserId = readUserCacheSync()?.id ?? null;

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

      // W-6 fix: a server workout row may carry multiple exercises.
      // Persist one local row per exercise so the offline read path mirrors
      // what was sent in (the old implementation kept exercises[0] only and
      // silently dropped the rest, corrupting history the moment any local
      // read surface lands).
      const exercises: Array<Record<string, unknown>> = Array.isArray(
        w.exercises,
      )
        ? (w.exercises as Array<Record<string, unknown>>)
        : [];

      const durationMinutes =
        typeof w.duration_minutes === 'number' ? w.duration_minutes : null;
      // P1-2: only treat `notes` as a session name if it's actually a string.
      // The previous `String(w.notes ?? '')` coerced objects to
      // "[object Object]" and the bool false → "false", which poisoned the
      // session_name index used by markSessionSyncedBySessionName.
      const sessionName: string =
        typeof w.notes === 'string' ? w.notes : '';

      if (exercises.length === 0) {
        await db.runAsync(
          `INSERT INTO workout_logs
             (id, exercise_id, sets_data, sync_status, logged_at,
              server_id, session_name, duration_minutes, user_id)
           VALUES (?, ?, ?, 'synced', ?, ?, ?, ?, ?)`,
          [
            generateId(),
            '',
            JSON.stringify([]),
            Date.now(),
            serverId,
            sessionName,
            durationMinutes,
            currentUserId,
          ],
        );
        continue;
      }

      for (const ex of exercises) {
        const repsPerSet = Array.isArray(ex.reps_per_set)
          ? (ex.reps_per_set as number[])
          : [];
        const weightPerSet = Array.isArray(ex.weight_per_set)
          ? (ex.weight_per_set as number[])
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
              server_id, session_name, duration_minutes, user_id)
           VALUES (?, ?, ?, 'synced', ?, ?, ?, ?, ?)`,
          [
            generateId(),
            String(ex.exercise_name ?? ''),
            setsData,
            Date.now(),
            serverId,
            sessionName,
            durationMinutes,
            currentUserId,
          ],
        );
      }
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

/** Exposed for tests so they can drive the classifier directly. */
export const __classifyPushErrorForTests = classifyPushError;
