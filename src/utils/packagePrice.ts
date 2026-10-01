// S-FEE (owner ruling 2026-09-30) — package price rule, mirrored from the
// backend (src/packages/packages.service.ts, PAID_PACKAGE_MIN_CENTS).
//
// A package is either free (exactly $0, one-time) or paid at $19.99 or more.
// The backend is the authority; this keeps the editor's inline copy in step
// with it so coaches see the rule before they save.

import type { PackageBillingInterval } from "../api/packagesApi";

export const PAID_PACKAGE_MIN_CENTS = 1999;

export const PACKAGE_PRICE_HELPER =
  "Paid packages start at $19.99, or make it free.";
export const PACKAGE_FREE_ONE_TIME_MESSAGE =
  "Free packages are one-time. Switch billing to One-time, or set a price of $19.99 or more.";

/**
 * Returns the inline problem with a price, or null when it is allowed.
 * `previousCents` is the saved price when editing: a package saved below
 * $19.99 before the rule keeps working while its price is unchanged.
 */
export function packagePriceIssue(
  cents: number | null,
  billingInterval: PackageBillingInterval,
  previousCents?: number | null,
): string | null {
  if (cents == null)
    return "Enter a price, for example 19.99, or 0 to make it free.";
  if (cents === 0) {
    return billingInterval === "one_time"
      ? null
      : PACKAGE_FREE_ONE_TIME_MESSAGE;
  }
  if (cents < PAID_PACKAGE_MIN_CENTS && cents !== previousCents) {
    return PACKAGE_PRICE_HELPER;
  }
  return null;
}

/** Backend error codes for the price rule (packages.service.ts). */
export const PACKAGE_PRICE_ERROR_CODES = new Set([
  "PACKAGE_PRICE_BELOW_MINIMUM",
  "PACKAGE_RECURRING_PRICE_BELOW_MINIMUM",
  "PACKAGE_FREE_MUST_BE_ONE_TIME",
]);
