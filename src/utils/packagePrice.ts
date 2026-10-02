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
 * C-321-7: free means exactly $0 on a one-time package only (backend #629),
 * so recurring copy never offers $0.
 */
export const PACKAGE_RECURRING_PRICE_HELPER =
  "Recurring packages start at $19.99.";

/** The helper line under the price field for this billing option. */
export function packagePriceHelper(
  billingInterval: PackageBillingInterval,
): string {
  return billingInterval === "one_time"
    ? PACKAGE_PRICE_HELPER
    : PACKAGE_RECURRING_PRICE_HELPER;
}

/** The saved price configuration of the package being edited. */
export interface SavedPackagePrice {
  priceCents: number | null;
  billingInterval: PackageBillingInterval;
}

/**
 * Returns the inline problem with a price, or null when it is allowed.
 * `saved` is the package's saved price configuration when editing: a package
 * saved below $19.99 before the rule keeps working only while its price AND
 * billing interval are unchanged (C-321-1, matching backend C-629-1: a new
 * cadence at the old price is a new price and must meet the floor).
 */
export function packagePriceIssue(
  cents: number | null,
  billingInterval: PackageBillingInterval,
  saved?: SavedPackagePrice | null,
): string | null {
  if (cents == null)
    return billingInterval === "one_time"
      ? "Enter a price, for example 19.99, or 0 to make it free."
      : "Enter a price of $19.99 or more, for example 19.99.";
  if (cents === 0) {
    return billingInterval === "one_time"
      ? null
      : PACKAGE_FREE_ONE_TIME_MESSAGE;
  }
  const unchanged =
    !!saved &&
    cents === saved.priceCents &&
    billingInterval === saved.billingInterval;
  if (cents < PAID_PACKAGE_MIN_CENTS && !unchanged) {
    return packagePriceHelper(billingInterval);
  }
  return null;
}

/** Backend error codes for the price rule (packages.service.ts). */
export const PACKAGE_PRICE_ERROR_CODES = new Set([
  "PACKAGE_PRICE_BELOW_MINIMUM",
  "PACKAGE_RECURRING_PRICE_BELOW_MINIMUM",
  "PACKAGE_FREE_MUST_BE_ONE_TIME",
]);
