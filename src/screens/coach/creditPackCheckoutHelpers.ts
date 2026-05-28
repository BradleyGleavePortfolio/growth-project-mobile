/**
 * creditPackCheckoutHelpers — pure helpers extracted from
 * `CreditPackCheckoutScreen` so they can be unit-tested without dragging
 * in the `react-native-webview` native dependency (which fails to resolve
 * its TurboModule under jest-expo).
 */

/**
 * Parse a user-entered dollar amount into cents. Accepts "10", "10.5",
 * "10.50", "$25", "1,000.00". Returns null on any malformed input
 * (NaN, negative, > 2 decimals, empty).
 *
 * Half-up rounding to cents because the user typed an exact amount and
 * the backend rejects non-integer cents. Banker's rounding applies only
 * to the multiplier-driven `actual_credit_cents` math on the backend.
 */
export function parseDollarsToCents(input: string): number | null {
  if (!input) return null;
  const trimmed = input.trim().replace(/[$,]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const dollars = Number(trimmed);
  if (!Number.isFinite(dollars) || dollars < 0) return null;
  return Math.round(dollars * 100);
}
