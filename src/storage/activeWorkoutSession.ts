// Persistence layer for an in-progress active workout. Keeps the
// ActiveWorkoutScreen recoverable across process death and from
// background → foreground transitions where the JS runtime may have
// been torn down (Android low-memory, iOS task suspension).
//
// The session is keyed by a single AsyncStorage entry. We don't keep
// a history of past in-progress sessions — only the latest one. If
// the user opens a new workout the existing entry is overwritten;
// once the workout is finished or cancelled, the entry is cleared.
//
// Staleness: sessions older than ACTIVE_WORKOUT_STALE_MS are treated
// as abandoned. We still hand them to the screen so it can render a
// "Resume?" prompt, but the helpers expose `isSessionStale` so the
// screen can phrase the prompt differently for stale data.

import AsyncStorage from '@react-native-async-storage/async-storage';

import type { SessionExercise } from '../screens/client/active-workout/types';

export const ACTIVE_WORKOUT_SESSION_KEY = '@activeWorkoutSession/v1';

// 12 hours — anything older is almost certainly an abandoned session.
export const ACTIVE_WORKOUT_STALE_MS = 12 * 60 * 60 * 1000;

// Schema version. Bump if we ever change the shape of the persisted
// payload so old payloads are discarded rather than partially decoded.
export const ACTIVE_WORKOUT_SESSION_VERSION = 1;

export interface PersistedActiveWorkoutSession {
  version: number;
  // Wallclock anchor for the elapsed-time counter. Storing the start
  // instant (instead of a paused-frozen counter) means we recompute
  // elapsed correctly even after a process kill — the screen never
  // has to trust an in-memory `timer` value across lifecycles.
  startedAtMs: number;
  // Last time we wrote to storage. Used to compute staleness.
  updatedAtMs: number;
  // Route params we need to rebuild the screen on resume.
  routineName: string;
  exercisesJson: string;
  assignmentId?: string;
  // Idempotency key for the assignment completion call. Generated at
  // session start; survives across process restarts so finishing a
  // resumed workout doesn't double-complete the assignment.
  idempotencyKey: string;
  // Working state.
  sessionExercises: SessionExercise[];
}

export interface ActiveWorkoutLoadResult {
  session: PersistedActiveWorkoutSession;
  isStale: boolean;
}

function isPersistedSession(value: unknown): value is PersistedActiveWorkoutSession {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    v.version === ACTIVE_WORKOUT_SESSION_VERSION &&
    typeof v.startedAtMs === 'number' &&
    typeof v.updatedAtMs === 'number' &&
    typeof v.routineName === 'string' &&
    typeof v.exercisesJson === 'string' &&
    typeof v.idempotencyKey === 'string' &&
    Array.isArray(v.sessionExercises)
  );
}

export function isSessionStale(
  session: Pick<PersistedActiveWorkoutSession, 'updatedAtMs'>,
  now: number = Date.now(),
): boolean {
  return now - session.updatedAtMs > ACTIVE_WORKOUT_STALE_MS;
}

export async function loadActiveWorkoutSession(
  now: number = Date.now(),
): Promise<ActiveWorkoutLoadResult | null> {
  try {
    const raw = await AsyncStorage.getItem(ACTIVE_WORKOUT_SESSION_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isPersistedSession(parsed)) {
      // Wrong shape or wrong version — drop it so the screen starts
      // clean rather than crashing while restoring.
      await AsyncStorage.removeItem(ACTIVE_WORKOUT_SESSION_KEY);
      return null;
    }
    return { session: parsed, isStale: isSessionStale(parsed, now) };
  } catch {
    // Corrupt payload — discard.
    try {
      await AsyncStorage.removeItem(ACTIVE_WORKOUT_SESSION_KEY);
    } catch {
      // best-effort; nothing else to do
    }
    return null;
  }
}

export async function saveActiveWorkoutSession(
  session: Omit<PersistedActiveWorkoutSession, 'version' | 'updatedAtMs'>,
  now: number = Date.now(),
): Promise<void> {
  const payload: PersistedActiveWorkoutSession = {
    ...session,
    version: ACTIVE_WORKOUT_SESSION_VERSION,
    updatedAtMs: now,
  };
  await AsyncStorage.setItem(
    ACTIVE_WORKOUT_SESSION_KEY,
    JSON.stringify(payload),
  );
}

export async function clearActiveWorkoutSession(): Promise<void> {
  try {
    await AsyncStorage.removeItem(ACTIVE_WORKOUT_SESSION_KEY);
  } catch {
    // best-effort
  }
}
