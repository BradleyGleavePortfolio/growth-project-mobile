/**
 * firstPaymentGate — the ED.3 once-only gate.
 *
 * The First Payment Wow Screen (spec §2.6, "THE moment") must fire EXACTLY
 * once per coach, ever. A second app open, a re-subscribe, a duplicate row, or
 * signing out and back in must all be no-ops.
 *
 * Kept across sign-out on purpose (like lib/romanJoinOffer's mark): sign-out's
 * clearAllStorage() wipes the prefs, cache and secure namespaces, but the
 * server keeps the coach's first_payment row, so a gate in prefsStorage was
 * wiped and the same payment celebrated again after the next sign-in
 * (B-LONOTIFY5-1, B-LSNOTIFY5-M898-1). The gate is therefore one raw
 * AsyncStorage key per coach id holding "true" (no amount, client or other
 * account data) that no sign-out sweep matches. A second account on the same
 * phone has its own key, so it still gets its own celebration.
 *
 * Only a confirmed account deletion removes the key: signOut with
 * accountDeleted (services/authActions.ts deletedAccountKeys) removes that one
 * coach's key, because the account and its first_payment row are gone
 * (B-LS898R3-1).
 *
 * Key shape (per builder brief):
 *   `roman.ed3.first-payment-seen.${coachId}`
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

/** Build the per-coach gate key. */
export function firstPaymentSeenKey(coachId: string): string {
  return `roman.ed3.first-payment-seen.${coachId}`;
}

/**
 * Has the first-payment celebration already been shown for this coach?
 * Returns true only when the gate key is explicitly set to "true".
 */
export async function hasSeenFirstPayment(coachId: string): Promise<boolean> {
  if (!coachId) return true; // no coach → treat as already-seen (never show)
  const raw = await AsyncStorage.getItem(firstPaymentSeenKey(coachId));
  return raw === 'true';
}

/**
 * Mark the celebration as shown for this coach. Idempotent — calling it twice
 * leaves the gate closed. Called on dismiss of the Wow screen so a re-open can
 * never re-trigger it.
 */
export async function markFirstPaymentSeen(coachId: string): Promise<void> {
  if (!coachId) return;
  await AsyncStorage.setItem(firstPaymentSeenKey(coachId), 'true');
}
