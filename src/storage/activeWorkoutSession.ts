// Persistence layer for an in-progress active workout. Keeps the
// ActiveWorkoutScreen recoverable across process death and from
// background → foreground transitions where the JS runtime may have
// been torn down (Android low-memory, iOS task suspension).
//
// The session is keyed per-user (R15): a global key would let User B
// resume User A's workout if they signed out and a different account
// signed in on the same device. The key takes the form
//   active_workout_session:<userId>
// and is wiped on signOut by the prefix-sweep in src/services/authActions.ts.
//
// We don't keep a history of past in-progress sessions — only the latest
// one per user. If the user opens a new workout the existing entry is
// overwritten; once the workout is finished or cancelled, the entry is
// cleared.
//
// Staleness: sessions older than ACTIVE_WORKOUT_STALE_MS are treated
// as abandoned. We still hand them to the screen so it can render a
// "Resume?" prompt, but the helpers expose `isSessionStale` so the
// screen can phrase the prompt differently for stale data.

import AsyncStorage from '@react-native-async-storage/async-storage';

import type { SessionExercise } from '../screens/client/active-workout/types';

// Prefix used for user-scoped session keys. The signOut sweep in
// authActions.ts removes every AsyncStorage key starting with this
// prefix so a second user on the same device cannot inherit the first
// user's in-progress workout.
export const ACTIVE_WORKOUT_SESSION_KEY_PREFIX = 'active_workout_session:';

// Build the per-user storage key. Exported for tests + the signOut
// sweep so the prefix lives in exactly one place.
export function activeWorkoutSessionKey(userId: string): string {
  return `${ACTIVE_WORKOUT_SESSION_KEY_PREFIX}${userId}`;
}

// Legacy global key used by the pre-R15 implementation. Read once at
// load time so an already-running workout that started before this
// patch shipped doesn't lose state — we migrate it forward into the
// per-user namespace, then delete the legacy entry. The migration is
// idempotent: after the first successful load the legacy key is gone.
export const LEGACY_ACTIVE_WORKOUT_SESSION_KEY = '@activeWorkoutSession/v1';

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

// Internal: parse a stored payload and either return it or drop it if
// the shape is wrong / version mismatched / corrupt. Returns null in
// every "we don't have a usable session" case so callers don't have to
// branch on error types.
async function readAndValidate(
  storageKey: string,
): Promise<PersistedActiveWorkoutSession | null> {
  let raw: string | null;
  try {
    raw = await AsyncStorage.getItem(storageKey);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isPersistedSession(parsed)) {
      await AsyncStorage.removeItem(storageKey).catch(() => {
        /* best-effort */
      });
      return null;
    }
    return parsed;
  } catch {
    await AsyncStorage.removeItem(storageKey).catch(() => {
      /* best-effort */
    });
    return null;
  }
}

export async function loadActiveWorkoutSession(
  userId: string,
  now: number = Date.now(),
): Promise<ActiveWorkoutLoadResult | null> {
  if (!userId) return null;
  const userKey = activeWorkoutSessionKey(userId);

  // Read the per-user key first; if absent, try the legacy global key
  // and migrate it into the user namespace so an in-flight workout
  // doesn't get orphaned by this rename.
  const userScoped = await readAndValidate(userKey);
  if (userScoped) {
    return { session: userScoped, isStale: isSessionStale(userScoped, now) };
  }

  const legacy = await readAndValidate(LEGACY_ACTIVE_WORKOUT_SESSION_KEY);
  if (legacy) {
    // Migrate forward into the per-user namespace. The legacy global
    // key represents the only previously-signed-in user's session, so
    // attributing it to the now-current user is the correct (and only)
    // move — they were the user who created it.
    try {
      await AsyncStorage.setItem(userKey, JSON.stringify(legacy));
    } catch {
      // If the migration write fails we still hand back the legacy
      // payload so the user can resume; we just won't have it in the
      // new namespace until the next save.
    }
    await AsyncStorage.removeItem(LEGACY_ACTIVE_WORKOUT_SESSION_KEY).catch(
      () => {
        /* best-effort */
      },
    );
    return { session: legacy, isStale: isSessionStale(legacy, now) };
  }

  return null;
}

export async function saveActiveWorkoutSession(
  userId: string,
  session: Omit<PersistedActiveWorkoutSession, 'version' | 'updatedAtMs'>,
  now: number = Date.now(),
): Promise<void> {
  if (!userId) {
    // Refuse to write a global key — that would re-introduce the R15
    // cross-user leak this prefix was added to close.
    throw new Error('activeWorkoutSession: userId required to save');
  }
  const payload: PersistedActiveWorkoutSession = {
    ...session,
    version: ACTIVE_WORKOUT_SESSION_VERSION,
    updatedAtMs: now,
  };
  await AsyncStorage.setItem(
    activeWorkoutSessionKey(userId),
    JSON.stringify(payload),
  );
}

export async function clearActiveWorkoutSession(userId: string): Promise<void> {
  if (!userId) return;
  try {
    await AsyncStorage.removeItem(activeWorkoutSessionKey(userId));
  } catch {
    // best-effort
  }
}
