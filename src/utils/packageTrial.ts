// B-TRIALS-2 — free trial days on a coach package (backend #656).
//
// The backend owns the rule (src/packages/trials/trial-rules.ts): a trial is a
// whole number of days from 1 to 30 (0 = no trial), only on a paid plan that
// renews, and never on a free or one-time package. This file mirrors the rule
// so the editor can say what to fix before saving, and maps every coded
// refusal the backend can answer to specific copy.

import type { PackageBillingInterval } from "../api/packagesApi";

export const TRIAL_DAYS_MAX = 30;
/** Lengths the editor offers as one-tap choices (any 1..30 is valid). */
export const TRIAL_DAY_PRESETS: readonly number[] = [3, 7, 14, 30];

export const TRIAL_ERROR_CODES = [
  "PACKAGE_TRIAL_DAYS_OUT_OF_RANGE",
  "PACKAGE_TRIAL_REQUIRES_RECURRING",
  "PACKAGE_TRIAL_NOT_ON_FREE",
] as const;
export type TrialErrorCode = (typeof TRIAL_ERROR_CODES)[number];

export const TRIAL_COPY = {
  label: "Free trial (optional)",
  help: "Clients add a card first and pay nothing until the trial ends. Each client gets one free trial with you.",
  outOfRange: `Enter a free trial from 1 to ${TRIAL_DAYS_MAX} days, or leave it empty for no trial.`,
  presetLabel: (days: number) => `${days} days`,
  noneLabel: "None",
  errorTitle: "Check the free trial",
} as const;

const SERVER_FALLBACK: Record<TrialErrorCode, string> = {
  PACKAGE_TRIAL_DAYS_OUT_OF_RANGE: TRIAL_COPY.outOfRange,
  PACKAGE_TRIAL_REQUIRES_RECURRING:
    "Free trials work on plans that renew. Choose Monthly, Quarterly or Yearly, or remove the trial.",
  PACKAGE_TRIAL_NOT_ON_FREE:
    "A free package has nothing to try first. Set a price, or remove the trial.",
};

export type TrialParse =
  { ok: true; days: number } | { ok: false; message: string };

/**
 * Parse the trial field. Empty = no trial (0). A one-time package always
 * sends 0 (the field is hidden for it).
 */
export function parseTrialDays(
  text: string,
  interval: PackageBillingInterval,
): TrialParse {
  if (interval === "one_time") return { ok: true, days: 0 };
  const trimmed = text.trim();
  if (!trimmed) return { ok: true, days: 0 };
  if (!/^\d+$/.test(trimmed))
    return { ok: false, message: TRIAL_COPY.outOfRange };
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 0 || n > TRIAL_DAYS_MAX) {
    return { ok: false, message: TRIAL_COPY.outOfRange };
  }
  return { ok: true, days: n };
}

export function isTrialErrorCode(
  code: string | null | undefined,
): code is TrialErrorCode {
  return !!code && (TRIAL_ERROR_CODES as readonly string[]).includes(code);
}

/**
 * Copy for a coded trial refusal from the backend. The server message is
 * already specific (it names the fix); it is used when present, otherwise the
 * mapped line for that code.
 */
export function trialErrorMessage(
  code: TrialErrorCode,
  serverMessage?: string | null,
): string {
  const msg = (serverMessage ?? "").trim();
  return msg || SERVER_FALLBACK[code];
}
