/**
 * importOfferDecision — durable, account-scoped mirror of the coach's answer
 * to the one-time Roman import offer (`yes` | `later` | `starting_fresh`).
 *
 * Why this exists: the canonical importer journey (UX-01, J0/J1) shows the
 * post-onboarding offer once per eligible account and persists the answer
 * per account so that "Later" leaves a compact resume card, "I am starting
 * fresh" removes the Home reminder, and neither is re-asked on the next launch.
 * PLAN requires only per-account persistence; the canonical default (CQ-02) is
 * account-keyed, user-scoped mobile persistence following the accepted #291
 * `importPairingMirror` pattern. No server endpoint, flag or token store is
 * introduced here, and nothing in this module infers eligibility (CQ-01 is
 * server-side and unresolved): the caller decides WHETHER to ask, this module
 * only remembers WHAT the coach answered.
 *
 * Rule 15 (user-scoped): the key is `import_offer_decision:<userId>`. The
 * signing-out coach's exact key is removed on signOut by
 * services/authActions.ts, which imports the exported constant so the literal
 * lives in exactly one place. A second coach on a shared device never inherits
 * the first coach's answer: their key differs, and a payload whose `userId`
 * disagrees with its own key is discarded on read (cross-user purge, #291).
 *
 * Rule 16 (never trust the client clock): no timestamp is stored. The record
 * carries no expiry, no "remind me at", and no cadence; nothing here or in any
 * caller compares anything to Date.now().
 *
 * Rule 18 (no fabricated confirmations): a successful write means the answer
 * is on THIS device for THIS account. It is not a server record and no caller
 * may present it as "saved to your account". A write failure throws so the
 * caller can keep its in-memory truth and simply re-offer on the next entry.
 *
 * No silent failures: a payload that is unparseable JSON, carries the wrong
 * `version`, an unknown decision value, or fails the shape guard is DISCARDED
 * and its key deleted — a logged, deliberate discard, never a half-trusted
 * record. An unknown decision value is never coerced to a known one.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { logger } from '../utils/logger';

/** Prefix for per-coach offer-decision keys. Exact key swept on signOut (authActions.ts). */
export const IMPORT_OFFER_DECISION_KEY_PREFIX = 'import_offer_decision:';

/** Schema version — bump to discard incompatible on-disk payloads on read. */
export const IMPORT_OFFER_DECISION_VERSION = 1;

/** Build the per-coach decision key. Exported so the shape lives in one place. */
export function importOfferDecisionKey(userId: string): string {
  return `${IMPORT_OFFER_DECISION_KEY_PREFIX}${userId}`;
}

/**
 * The three canonical answers (PLAN §Entry; journey spec J0/J1). `yes` routes
 * to source selection, `later` leaves a compact resume card, `starting_fresh`
 * removes the Home reminder while the Settings entry remains (CQ-16 default).
 */
export const IMPORT_OFFER_DECISIONS = ['yes', 'later', 'starting_fresh'] as const;
export type ImportOfferDecision = (typeof IMPORT_OFFER_DECISIONS)[number];

export function isImportOfferDecision(value: unknown): value is ImportOfferDecision {
  return (
    typeof value === 'string' &&
    (IMPORT_OFFER_DECISIONS as readonly string[]).includes(value)
  );
}

/**
 * One coach's persisted answer. `userId` is also encoded in the key; it is
 * kept in the payload to detect a mismatch (#291 pattern).
 */
export interface PersistedImportOfferDecision {
  version: number;
  /** Owning coach. Also encoded in the key; kept here to detect a mismatch. */
  userId: string;
  decision: ImportOfferDecision;
}

function isPersistedImportOfferDecision(
  value: unknown,
): value is PersistedImportOfferDecision {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    v.version === IMPORT_OFFER_DECISION_VERSION &&
    typeof v.userId === 'string' &&
    v.userId.length > 0 &&
    isImportOfferDecision(v.decision)
  );
}

/**
 * Persist `decision` for `userId`, overwriting any prior answer for the same
 * coach — the latest answer wins (for example `later` followed by `yes`).
 * Throws on a write failure so the caller can decide, rather than believing a
 * write happened that did not.
 */
export async function writeImportOfferDecision(
  userId: string,
  decision: ImportOfferDecision,
): Promise<void> {
  const record: PersistedImportOfferDecision = {
    version: IMPORT_OFFER_DECISION_VERSION,
    userId,
    decision,
  };
  await AsyncStorage.setItem(importOfferDecisionKey(userId), JSON.stringify(record));
}

/**
 * Read back the persisted answer for `userId`, or null when there is none.
 * A corrupt, version-drifted, shape-drifted, unknown-valued, or cross-user
 * payload is discarded (and its key deleted) rather than returned. A storage
 * read failure is logged and reported as null: the caller treats "no answer"
 * as the truthful fallback (the offer may be asked again), never as a
 * fabricated answer.
 */
export async function readImportOfferDecision(
  userId: string,
): Promise<ImportOfferDecision | null> {
  let raw: string | null;
  try {
    raw = await AsyncStorage.getItem(importOfferDecisionKey(userId));
  } catch (err) {
    logger.warn('[importOfferDecision] read failed', err);
    return null;
  }
  if (raw == null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    logger.warn('[importOfferDecision] corrupt JSON discarded', err);
    await clearImportOfferDecision(userId);
    return null;
  }
  if (!isPersistedImportOfferDecision(parsed)) {
    logger.warn('[importOfferDecision] shape or version drift discarded');
    await clearImportOfferDecision(userId);
    return null;
  }
  if (parsed.userId !== userId) {
    // The key says one coach, the payload says another. Never hand a coach an
    // answer that is not theirs — discard rather than reconcile.
    logger.warn('[importOfferDecision] user mismatch discarded');
    await clearImportOfferDecision(userId);
    return null;
  }
  return parsed.decision;
}

/**
 * Drop the persisted answer for `userId`. Idempotent. A failure is logged
 * rather than thrown: a lingering record is user-scoped, non-secret, and would
 * be re-validated on its next read anyway.
 */
export async function clearImportOfferDecision(userId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(importOfferDecisionKey(userId));
  } catch (err) {
    logger.warn('[importOfferDecision] clear failed', err);
  }
}
