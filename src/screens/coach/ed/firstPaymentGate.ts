/**
 * firstPaymentGate — the ED.3 once-only MMKV gate.
 *
 * The First Payment Wow Screen (spec §2.6, "THE moment") must fire EXACTLY
 * once per coach, ever. A second app open, a re-subscribe, or a duplicate
 * realtime INSERT must all be no-ops. The gate is persisted in the app's
 * existing MMKV abstraction (`prefsStorage`, src/storage/mmkv.ts) — the same
 * once-only-banner pattern already used across the coach app (e.g.
 * StripeSetupBanner). We use `prefsStorage` (not `secureStorage`) because the
 * flag is a non-sensitive UX gate, consistent with the other dismissal keys.
 *
 * Key shape (per builder brief):
 *   `roman.ed3.first-payment-seen.${coachId}`
 *
 * The storage abstraction is async-capable (the AsyncStorage shim used in Expo
 * Go / Jest cannot read synchronously), so the gate API is async throughout.
 * The MMKV-backed instance resolves these promises synchronously underneath,
 * so the once-only contract holds on a real device too.
 */
import { prefsStorage } from '../../../storage/mmkv';

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
  const raw = await prefsStorage.getStringAsync(firstPaymentSeenKey(coachId));
  return raw === 'true';
}

/**
 * Mark the celebration as shown for this coach. Idempotent — calling it twice
 * leaves the gate closed. Called on dismiss of the Wow screen so a re-open can
 * never re-trigger it.
 */
export async function markFirstPaymentSeen(coachId: string): Promise<void> {
  if (!coachId) return;
  await prefsStorage.set(firstPaymentSeenKey(coachId), 'true');
}
