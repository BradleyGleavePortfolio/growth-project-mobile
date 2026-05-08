/**
 * bloodworkDisclaimerHelper — persists the user's acknowledgement of the
 * bloodwork disclaimer using expo-secure-store.
 *
 * Privacy doctrine: acknowledgement is keyed by user id so each user must
 * acknowledge independently. The stored value is a timestamp (ISO-8601)
 * not the disclaimer text itself — the text is always read from the copy
 * module so updates to wording propagate without needing to clear storage.
 *
 * BEFORE PUBLIC LAUNCH: Bradley must confirm with his lawyer whether
 * a mobile timestamp constitutes sufficient acknowledgement for the
 * jurisdictions in which TGP operates (UK, AU, US). Consider a
 * server-side consent record as the authoritative source of truth.
 */

import * as SecureStore from 'expo-secure-store';

/**
 * Storage key format: `bloodwork_disclaimer_ack_v1_<userId>`.
 * The `v1` segment allows a future lawyer-revised disclaimer copy to
 * invalidate existing acknowledgements by bumping the version.
 */
const DISCLAIMER_VERSION = 'v1';

function storageKey(userId: string): string {
  return `bloodwork_disclaimer_ack_${DISCLAIMER_VERSION}_${userId}`;
}

/**
 * Returns true if the given user has already acknowledged the disclaimer.
 * Falls back to false on any SecureStore error (fail-closed).
 */
export async function hasAcknowledgedDisclaimer(userId: string): Promise<boolean> {
  try {
    const value = await SecureStore.getItemAsync(storageKey(userId));
    return value !== null && value !== '';
  } catch {
    // Fail closed — if we can't read, treat as not acknowledged.
    return false;
  }
}

/**
 * Records that the given user has acknowledged the disclaimer.
 * Stores an ISO-8601 timestamp so the acknowledgement is auditable.
 */
export async function recordDisclaimerAcknowledgement(userId: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(storageKey(userId), new Date().toISOString());
  } catch {
    // Non-fatal — the UI layer must NOT show bloodwork data if this fails.
    // Throw so the caller can handle it.
    throw new Error('Could not save your acknowledgement. Please try again.');
  }
}

/**
 * Clears the acknowledgement for a user. Use this when:
 *   - the user logs out
 *   - the app needs to re-prompt after a disclaimer version bump
 *   - during testing
 */
export async function clearDisclaimerAcknowledgement(userId: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(storageKey(userId));
  } catch {
    // Best-effort — no throw.
  }
}
