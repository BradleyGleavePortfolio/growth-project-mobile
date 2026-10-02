/**
 * S-COACH — plain-words copy for every failure the coach setup and Money
 * screens can hit. Known status and machine codes map to specific copy; an
 * unknown failure shows the server's request reference and the support
 * address, and is reported to Sentry. No generic "something went wrong".
 */
import { captureError } from "../../services/sentry";
import { extractRequestId } from "../../utils/correlation";
import { errorStatus } from "../../types/common";

/** Support inbox for coach money and setup problems (owner-designated). */
export const COACH_SUPPORT_EMAIL = "Bradleyapple1031@gmail.com";

export interface FriendlyError {
  /** Short heading, e.g. "Stripe is not connected yet". */
  title: string;
  /** One or two sentences: what happened and what to do next. */
  body: string;
  /** Server request reference when it supplied one. */
  requestId: string | null;
  /** Machine code from the server, when present. */
  code: string | null;
  /** True when trying the same action again could work. */
  retryable: boolean;
}

function readBody(err: unknown): {
  code: string | null;
  message: string | null;
  stripeCode: string | null;
} {
  if (!err || typeof err !== "object")
    return { code: null, message: null, stripeCode: null };
  const data = (err as { response?: { data?: unknown } }).response?.data;
  if (!data || typeof data !== "object")
    return { code: null, message: null, stripeCode: null };
  const d = data as Record<string, unknown>;
  const code =
    typeof d.code === "string"
      ? d.code
      : typeof d.error === "string"
        ? d.error
        : null;
  const message = typeof d.message === "string" ? d.message : null;
  const stripeCode = typeof d.stripeCode === "string" ? d.stripeCode : null;
  return { code, message, stripeCode };
}

function isNetworkError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as {
    response?: unknown;
    request?: unknown;
    code?: unknown;
    message?: unknown;
  };
  if (e.response) return false;
  return (
    e.request !== undefined ||
    e.code === "ERR_NETWORK" ||
    e.code === "ECONNABORTED" ||
    (typeof e.message === "string" && /network/i.test(e.message))
  );
}

// Server messages for these codes are written for people (backend #629
// package floor copy), so they are shown as they are.
const HUMAN_MESSAGE_CODES = new Set([
  "PACKAGE_PRICE_BELOW_MINIMUM",
  "PACKAGE_FREE_MUST_BE_ONE_TIME",
  "PACKAGE_INVALID",
  "MONEY_WINDOW_INVALID",
  "MONEY_COMPARE_WINDOW_INVALID",
]);

/**
 * Turn any thrown value into specific copy. `action` completes the sentence
 * "We could not ..." for the unknown case, e.g. "open Stripe".
 */
export function describeError(err: unknown, action: string): FriendlyError {
  const status = errorStatus(err);
  const { code, message, stripeCode } = readBody(err);
  const requestId = extractRequestId(err);
  const base = { requestId, code };

  if (isNetworkError(err)) {
    return {
      ...base,
      title: "You appear to be offline",
      body: "Check your connection, then try again.",
      retryable: true,
    };
  }
  if (status === 401) {
    return {
      ...base,
      title: "Your session ended",
      body: "Sign in again to continue. Nothing you finished has been lost.",
      retryable: false,
    };
  }
  if (status === 429) {
    return {
      ...base,
      title: "Too many tries in a row",
      body: "Wait a minute, then try again.",
      retryable: true,
    };
  }
  if (
    code === "CONNECT_NOT_CONFIGURED" ||
    stripeCode === "configuration_missing" ||
    code === "STRIPE_NOT_CONFIGURED"
  ) {
    return {
      ...base,
      title: "Payouts are not switched on yet",
      body:
        "Stripe payouts are not available in this version of the app yet. Finish the rest of setup now, " +
        "and connect Stripe later from Money. Free packages work today.",
      retryable: false,
    };
  }
  if (code === "CONNECT_ONBOARDING_INCOMPLETE") {
    return {
      ...base,
      title: "Finish Stripe setup first",
      body: "Payout settings open once Stripe has approved your account. Finish the details Stripe asks for.",
      retryable: false,
    };
  }
  if (code === "STRIPE_CONNECT_ERROR") {
    return {
      ...base,
      title: "Stripe did not answer",
      body: "Stripe could not start your setup just now. Try again in a minute.",
      retryable: true,
    };
  }
  if (code === "ONBOARDING_COMPLETED") {
    return {
      ...base,
      title: "Setup is already finished",
      body: "You can change anything from Settings or Money.",
      retryable: false,
    };
  }
  if (code === "STEP_OUT_OF_ORDER") {
    return {
      ...base,
      title: "Your setup moved on another device",
      body: "We picked up where you left off. Continue from here.",
      retryable: true,
    };
  }
  if (code && HUMAN_MESSAGE_CODES.has(code) && message) {
    return {
      ...base,
      title: "Check the package details",
      body: message,
      retryable: false,
    };
  }
  if (status === 403) {
    return {
      ...base,
      title: "Only the coach who owns this practice can do that",
      body: "Ask the practice owner, or sign in with the coach account.",
      retryable: false,
    };
  }
  if (status === 404 && code === "MONEY_CHARGE_NOT_FOUND") {
    return {
      ...base,
      title: "That charge is not on your account",
      body: "It may belong to another coach, or it was removed. Go back to your recent charges.",
      retryable: false,
    };
  }
  if (status !== undefined && status >= 500) {
    captureError(err, { area: "coach_setup", action, status, code, requestId });
    return {
      ...base,
      title: "Our server had a problem",
      body: `We could not ${action}. Try again in a few minutes.${referenceSentence(requestId)}`,
      retryable: true,
    };
  }
  captureError(err, { area: "coach_setup", action, status, code, requestId });
  return {
    ...base,
    title: `We could not ${action}`,
    body: `Try again. If it keeps happening, write to ${COACH_SUPPORT_EMAIL}${
      requestId ? ` and mention reference ${requestId}` : ""
    }.`,
    retryable: true,
  };
}

function referenceSentence(requestId: string | null): string {
  return requestId
    ? ` If it keeps happening, write to ${COACH_SUPPORT_EMAIL} and mention reference ${requestId}.`
    : ` If it keeps happening, write to ${COACH_SUPPORT_EMAIL}.`;
}
