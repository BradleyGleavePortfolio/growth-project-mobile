/**
 * autosaveMirror — the AsyncStorage offline mirror for workout-builder autosave
 * (MWB-4, MASTER_WORKOUT_BUILDER_SPEC.md §6.3).
 *
 * This is the module that makes the operator's one sentence true:
 *   "I just want a coach to be making an edit to a plan, close the app all of a
 *    sudden, and it saves the change!"
 *
 * Every flush writes the pending batch HERE FIRST (before the network call), so
 * if the OS kills the process between arming the write and the request reaching
 * the server, the unsent batch survives on disk. On the next mount / reconnect
 * the hook reads it back and REPLAYS it with the SAME Idempotency-Key + the
 * SAME (base_revision_index, lock_token) optimistic-lock pair. A replay the
 * server already applied fails the lock_token assert with a 409 carrying a
 * fresh token, which the hook fast-forwards through — so a kill-then-replay is
 * exactly-once, never a double-apply (mirrors the sync-engine dead-letter
 * pattern in offline/sync/sync-engine.ts).
 *
 * Storage is keyed per plan (NOT per user): a coach edits one plan at a time on
 * one device, and a plan id is already a non-PII opaque uuid. The key is swept
 * on signOut by the prefix sweep in services/authActions.ts (the prefix is
 * exported for that). A mirror entry is cleared the instant its batch lands a
 * 200 (or a 409 fast-forward resolves it), so a stale entry never lingers.
 *
 * NO silent failures (Bradley Law #36): a read that fails to JSON-parse or
 * fails the shape guard is treated as "no mirror" and the bad key is deleted —
 * a logged, deliberate discard, not a swallowed error. A write failure is
 * surfaced to the caller so the hook can mark state and retry; it is never
 * caught-and-ignored.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AutosaveBatch } from '../api/workoutAutosaveApi';
import { logger } from '../utils/logger';

/** Prefix for per-plan mirror keys. Swept on signOut (authActions.ts). */
export const AUTOSAVE_MIRROR_KEY_PREFIX = 'mwb_autosave_mirror:';

/** Schema version — bump to discard incompatible on-disk payloads on read. */
export const AUTOSAVE_MIRROR_VERSION = 1;

/** Build the per-plan mirror key. Exported so the prefix lives in one place. */
export function autosaveMirrorKey(planId: string): string {
  return `${AUTOSAVE_MIRROR_KEY_PREFIX}${planId}`;
}

/**
 * One buffered, not-yet-confirmed autosave batch. Holds everything needed to
 * replay the exact same request after an app kill: the batch (which itself
 * carries base_revision_index + lock_token + ops + cause) and the
 * Idempotency-Key so the transport dedupes a double-send.
 */
export interface MirroredAutosave {
  version: number;
  planId: string;
  /** The full PATCH body, replayed verbatim. */
  batch: AutosaveBatch;
  /** Idempotency-Key reused on replay so a re-send dedupes server-side. */
  idempotencyKey: string;
  /** Wallclock ms the batch was buffered — for staleness / telemetry. */
  queuedAtMs: number;
}

function isMirroredAutosave(value: unknown): value is MirroredAutosave {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    v.version === AUTOSAVE_MIRROR_VERSION &&
    typeof v.planId === 'string' &&
    typeof v.idempotencyKey === 'string' &&
    typeof v.queuedAtMs === 'number' &&
    !!v.batch &&
    typeof v.batch === 'object'
  );
}

/**
 * Persist `entry` to the mirror, OVERWRITING any prior pending batch for the
 * plan (only the latest pending batch matters — earlier ones are superseded by
 * the diff that produced this one). Throws on a write failure so the caller can
 * mark state + retry — never silently swallowed.
 */
export async function writeAutosaveMirror(entry: MirroredAutosave): Promise<void> {
  await AsyncStorage.setItem(
    autosaveMirrorKey(entry.planId),
    JSON.stringify(entry),
  );
}

/**
 * Read the pending batch for `planId`, or null if there is none. A corrupt /
 * shape-drifted payload is discarded (and the key deleted) rather than handed
 * back — a deliberate, logged discard, not a swallowed error.
 */
export async function readAutosaveMirror(
  planId: string,
): Promise<MirroredAutosave | null> {
  let raw: string | null;
  try {
    raw = await AsyncStorage.getItem(autosaveMirrorKey(planId));
  } catch (err) {
    // A storage read fault is non-fatal for correctness (we just have no
    // mirror to replay) but must be visible, not silent.
    logger.warn('[autosaveMirror] read failed', err);
    return null;
  }
  if (raw == null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    logger.warn('[autosaveMirror] corrupt JSON discarded', err);
    await clearAutosaveMirror(planId);
    return null;
  }
  if (!isMirroredAutosave(parsed)) {
    logger.warn('[autosaveMirror] shape drift discarded for plan', planId);
    await clearAutosaveMirror(planId);
    return null;
  }
  return parsed;
}

/**
 * Remove the pending batch for `planId`. Called the instant a batch is
 * confirmed (200) or a 409 fast-forward supersedes it. Idempotent. A clear
 * failure is logged (not thrown) — a lingering confirmed entry is harmless
 * because its replay would 409-fast-forward to a no-op, and we prefer not to
 * mask the original success with a teardown error.
 */
export async function clearAutosaveMirror(planId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(autosaveMirrorKey(planId));
  } catch (err) {
    logger.warn('[autosaveMirror] clear failed', err);
  }
}

/**
 * Clear the mirror for `planId` ONLY IF the on-disk entry still belongs to the
 * batch identified by `idempotencyKey`. This is the per-batch-keyed clear the
 * autosave queue relies on: when an in-flight batch's 200 returns, a NEWER
 * batch may have already overwritten the mirror under its own key while the
 * request was in flight. A blanket clear would delete that newer, still-unsent
 * batch (the dropped-edit P0). By matching the key first we only remove the
 * entry we actually confirmed, leaving any superseding batch intact to send.
 *
 * Returns true when an entry was cleared, false when it was left in place
 * (because a different/newer batch owns the mirror now). A read or remove fault
 * is logged, never swallowed silently, and treated as "left in place" so the
 * caller does not assume a clear that did not happen.
 */
export async function clearAutosaveMirrorIfKey(
  planId: string,
  idempotencyKey: string,
): Promise<boolean> {
  let raw: string | null;
  try {
    raw = await AsyncStorage.getItem(autosaveMirrorKey(planId));
  } catch (err) {
    logger.warn('[autosaveMirror] keyed-clear read failed', err);
    return false;
  }
  if (raw == null) return false;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    // Corrupt entry: discard it outright (it cannot be a valid newer batch).
    logger.warn('[autosaveMirror] keyed-clear corrupt JSON discarded', err);
    await clearAutosaveMirror(planId);
    return true;
  }
  if (!isMirroredAutosave(parsed) || parsed.idempotencyKey !== idempotencyKey) {
    // A different (newer) batch owns the mirror now — leave it for its own send.
    return false;
  }
  await clearAutosaveMirror(planId);
  return true;
}
