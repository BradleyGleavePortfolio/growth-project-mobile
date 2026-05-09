/**
 * Offline sync engine for The Growth Project.
 *
 * Responsibilities:
 *   1. Pull: fetch recent server-side workouts on login / reconnect and cache
 *      them as `synced` records so the local read path has up-to-date data
 *      even on a fresh install.
 *   2. Push: iterate every `pending` workout_log and POST it to the backend.
 *      On success → mark `synced` + store server ID.
 *      On conflict (409) → server-wins: mark `conflict`, surface a toast.
 *      On network error → leave `pending`, retry next time.
 *
 * Conflict policy (server wins):
 *   When the server returns HTTP 409 for a record, the local copy is marked
 *   `conflict` and a non-blocking toast is emitted via the conflict-toast event
 *   bus (see `conflictToastEvents`). The UI can subscribe and show a banner.
 *   The server copy is NOT written back to local DB in this foundation PR —
 *   that is a follow-up once the full pull-sync loop is validated.
 *
 * Usage:
 *   - Call `triggerSync()` from useNetworkStatus listener when online.
 *   - Call `triggerSync()` after a successful auth/login to pull latest data.
 *   - New workout writes go through `writeWorkoutLog()` — never direct DB ops.
 *
 * @see docs/offline-architecture.md
 */
import { Q, Model } from '@nozbe/watermelondb';
import { getDatabase } from '../database';
import WorkoutLog from '../models/WorkoutLog';
import { workoutApi } from '../../services/api';
import EventEmitter from 'eventemitter3';

// ---------------------------------------------------------------------------
// Conflict toast event bus
// ---------------------------------------------------------------------------
// Components subscribe with conflictToastEvents.on('conflict', cb).
export const conflictToastEvents = new EventEmitter();
conflictToastEvents.setMaxListeners(20);

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------
let syncInProgress = false;

// ---------------------------------------------------------------------------
// Helper type cast — WatermelonDB's generic constraint is overly strict in
// some TS configs; cast through Model to satisfy the compiler.
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyModel = any;

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
 * The sync engine will push it to the server on the next `triggerSync()` call.
 */
export async function writeWorkoutLog(payload: WriteWorkoutPayload): Promise<WorkoutLog> {
  const db = getDatabase();
  const workoutLogs = db.get<AnyModel>('workout_logs');

  const record: WorkoutLog = await db.write(async () => {
    return workoutLogs.create((log: WorkoutLog) => {
      log.exerciseId = payload.exerciseId;
      log.setsData = payload.setsData;
      log.syncStatus = 'pending';
      log.sessionName = payload.sessionName ?? null;
      log.durationMinutes = payload.durationMinutes ?? null;
    });
  });

  return record;
}

// ---------------------------------------------------------------------------
// Push pending records
// ---------------------------------------------------------------------------

async function pushPending(): Promise<void> {
  const db = getDatabase();
  const workoutLogs = db.get<AnyModel>('workout_logs');

  const pending: WorkoutLog[] = await workoutLogs
    .query(Q.where('sync_status', 'pending'))
    .fetch();

  for (const log of pending) {
    try {
      const serverPayload = log.toServerPayload();
      const response = await workoutApi.create(
        serverPayload as unknown as Record<string, unknown>,
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = response.data as any;
      const serverId: string = data?.id ?? data?.workout?.id ?? '';
      await log.markSynced(serverId);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 409) {
        // Conflict: server has a newer version — mark local as conflict.
        await log.markConflict();
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
 * Pull the N most recent workouts from the server and upsert them as `synced`
 * records. Used after login to pre-populate the local DB so the workout
 * history is immediately visible without a pending state.
 *
 * This is a one-way pull: server → local. It will NOT overwrite records that
 * are currently `pending` (user has unsent edits in flight).
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

    const db = getDatabase();
    const workoutLogs = db.get<AnyModel>('workout_logs');

    await db.write(async () => {
      for (const w of workouts) {
        const serverId = String(w.id ?? '');
        if (!serverId) continue;

        // Check if we already have this server record.
        const existing: WorkoutLog[] = await workoutLogs
          .query(Q.where('server_id', serverId))
          .fetch();

        if (existing.length > 0) {
          // Already present — skip to avoid overwriting pending edits.
          continue;
        }

        // Derive a representative sets_data blob from the server shape.
        const exercises: Array<Record<string, unknown>> = Array.isArray(w.exercises)
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

        await workoutLogs.create((log: WorkoutLog) => {
          log.exerciseId = String(firstExercise.exercise_name ?? '');
          log.setsData = setsData;
          log.syncStatus = 'synced';
          log.serverId = serverId;
          log.sessionName = String(w.notes ?? '');
          log.durationMinutes =
            typeof w.duration_minutes === 'number' ? w.duration_minutes : null;
        });
      }
    });
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
