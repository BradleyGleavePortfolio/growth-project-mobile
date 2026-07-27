/**
 * importPairingMirror — durable, user-scoped mirror of an in-flight v0.3
 * extension-import pairing session.
 *
 * Why this exists: the import flow REQUIRES the coach to leave the app.
 * ImportDataScreen calls Linking.openURL to send them to their prior platform's
 * login page in a browser, and the pairing code is then typed into a browser
 * extension. Until now every byte of that state lived in useState/useRef, so an
 * OS kill while the coach was in the browser dropped the code mid-flow and
 * returned them to the intro screen — while a live, un-abandoned pairing
 * session was still open server-side with no way to see or abandon it.
 *
 * Rule 15 (user-scoped): the key is `import_pairing_session:<userId>`, and the
 * prefix is swept on signOut by services/authActions.ts (which imports the
 * exported constant, so the literal lives in exactly one place). A second coach
 * on a shared device never inherits the first coach's session.
 *
 * Rule 16 (never trust the client clock): `expiresAt` is stored VERBATIM as the
 * server sent it, for provenance and support correlation only. Nothing here or
 * in any caller compares it to Date.now(). A restored session is re-validated
 * against POST /extension/pair/status, and the ONLY expiry signal remains the
 * server answering `expired`.
 *
 * Rule 19 (idempotency): the UUID minted before the first /pair/init attempt is
 * persisted here and replayed on every retry, so a kill-then-retry cannot open
 * a second server-side session for the same coach intent.
 *
 * Rule 18 (no fabricated confirmations): restoring a record is NOT a claim the
 * session is still live. It only says "we asked for this and never saw it
 * finish" — the server decides what the session actually is.
 *
 * No silent failures: a payload that is unparseable JSON, carries the wrong
 * `version`, or fails the shape guard is DISCARDED and its key deleted — a
 * logged, deliberate discard, never a half-trusted record.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { logger } from '../utils/logger';

/** Prefix for per-user pairing-session keys. Swept on signOut (authActions.ts). */
export const IMPORT_PAIRING_MIRROR_KEY_PREFIX = 'import_pairing_session:';

/** Schema version — bump to discard incompatible on-disk payloads on read. */
export const IMPORT_PAIRING_MIRROR_VERSION = 1;

/** Build the per-user mirror key. Exported so the shape lives in one place. */
export function importPairingMirrorKey(userId: string): string {
  return `${IMPORT_PAIRING_MIRROR_KEY_PREFIX}${userId}`;
}

/**
 * One pairing session the coach started and we have not yet seen reach a
 * terminal state. Holds everything needed to pick the flow back up after a
 * process death: which platform they chose, the code they were told to type,
 * the server's own expiry stamp, and the idempotency key that makes a re-mint
 * safe.
 */
export interface MirroredPairingSession {
  version: number;
  /** Owning coach. Also encoded in the key; kept here to detect a mismatch. */
  userId: string;
  /** `chosen_platform` slug the session was minted for. */
  platformId: string;
  /** The 6-digit code shown to the coach. Never logged, never sent to telemetry. */
  code: string;
  /** Server-authoritative ISO-8601 expiry, stored verbatim. Never compared locally. */
  expiresAt: string;
  /** Rule 19 key, replayed on every re-mint of this same intent. */
  idempotencyKey: string;
}

function isMirroredPairingSession(
  value: unknown,
): value is MirroredPairingSession {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    v.version === IMPORT_PAIRING_MIRROR_VERSION &&
    typeof v.userId === 'string' &&
    v.userId.length > 0 &&
    typeof v.platformId === 'string' &&
    v.platformId.length > 0 &&
    typeof v.code === 'string' &&
    v.code.length > 0 &&
    typeof v.expiresAt === 'string' &&
    typeof v.idempotencyKey === 'string' &&
    v.idempotencyKey.length > 0
  );
}

/**
 * Persist `session`, overwriting any prior session for the same coach — a coach
 * pairs one platform at a time, and a re-mint supersedes whatever came before.
 * Throws on a write failure so the caller can decide, rather than believing a
 * write happened that did not.
 */
export async function writeImportPairingMirror(
  session: MirroredPairingSession,
): Promise<void> {
  await AsyncStorage.setItem(
    importPairingMirrorKey(session.userId),
    JSON.stringify(session),
  );
}

/**
 * Read back the pending session for `userId`, or null when there is none.
 * A corrupt, version-drifted, shape-drifted, or cross-user payload is discarded
 * (and its key deleted) rather than returned.
 */
export async function readImportPairingMirror(
  userId: string,
): Promise<MirroredPairingSession | null> {
  let raw: string | null;
  try {
    raw = await AsyncStorage.getItem(importPairingMirrorKey(userId));
  } catch (err) {
    logger.warn('[importPairingMirror] read failed', err);
    return null;
  }
  if (raw == null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    logger.warn('[importPairingMirror] corrupt JSON discarded', err);
    await clearImportPairingMirror(userId);
    return null;
  }
  if (!isMirroredPairingSession(parsed)) {
    logger.warn('[importPairingMirror] shape or version drift discarded');
    await clearImportPairingMirror(userId);
    return null;
  }
  if (parsed.userId !== userId) {
    // The key says one coach, the payload says another. Never hand a coach a
    // session that is not theirs — discard rather than reconcile.
    logger.warn('[importPairingMirror] user mismatch discarded');
    await clearImportPairingMirror(userId);
    return null;
  }
  return parsed;
}

/**
 * Drop the pending session for `userId`. Called the moment the session reaches
 * any terminal state, and when the coach abandons it. Idempotent. A failure is
 * logged rather than thrown: the caller has already moved the UI to a terminal
 * state and a lingering record would be discarded on its next read anyway.
 */
export async function clearImportPairingMirror(userId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(importPairingMirrorKey(userId));
  } catch (err) {
    logger.warn('[importPairingMirror] clear failed', err);
  }
}
