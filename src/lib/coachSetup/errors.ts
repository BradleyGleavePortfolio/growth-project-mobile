/**
 * S-COACH — plain-words copy for every failure the coach setup and Money
 * screens can hit. Known status and machine codes map to specific copy; an
 * unknown failure shows a reference and the support address, and is reported
 * to Sentry. No generic "something went wrong".
 *
 * B-345-3 (agent 118): the report is content free. Sentry gets a fixed
 * CoachSetupFailure error plus closed fields (area, action, status, a code
 * only when it has the machine-code shape, kind, reference), never the thrown
 * value, its message, request config or response body. Every reported
 * failure has a reference: the server's request id, else the X-Request-Id
 * this app sent, else a fresh client id. The same reference is the Sentry
 * `reference` tag and the one the coach reads (short form for client ids).
 */
import { captureError } from "../../services/sentry";
import {
  diagnosticReference,
  extractRequestId,
  shortReference,
  supportReferenceOf,
} from "../../utils/correlation";
import { errorStatus } from "../../types/common";
import { SUPPORT_EMAIL } from "../../constants/support";

/** Support inbox for coach money and setup problems (the one app address). */
export const COACH_SUPPORT_EMAIL = SUPPORT_EMAIL;

export interface FriendlyError {
  /** Short heading, e.g. "Stripe is not connected yet". */
  title: string;
  /** One or two sentences: what happened and what to do next. */
  body: string;
  /**
   * Reference to quote to support: the server's request id when it supplied
   * one; for a reported failure without one, the short form of the reference
   * on the Sentry report.
   */
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

/** Machine codes only (e.g. PACKAGE_NOT_FOUND); anything else is dropped. */
const MACHINE_CODE = /^[A-Z][A-Z0-9_]{1,63}$/;

/** Fixed, content-free error sent to Sentry in place of the thrown value. */
export class CoachSetupFailure extends Error {
  constructor(kind: "server" | "unknown") {
    super(`coach setup ${kind} failure`);
    this.name = "CoachSetupFailure";
  }
}

function report(
  err: unknown,
  kind: "server" | "unknown",
  action: string,
  status: number | undefined,
  code: string | null,
): string {
  const reference = diagnosticReference(supportReferenceOf(err));
  captureError(new CoachSetupFailure(kind), {
    area: "coach_setup",
    action,
    kind,
    status: typeof status === "number" ? status : null,
    code: code && MACHINE_CODE.test(code) ? code : null,
    transport: isNetworkError(err)
      ? "network"
      : err && typeof err === "object" && "response" in err
        ? "http"
        : "local",
    reference,
  });
  return extractRequestId(err) ?? shortReference(reference) ?? reference;
}

// Server messages for these codes are written for people (backend #629
// package floor copy), so they are shown as they are.
const HUMAN_MESSAGE_CODES = new Set([
  "PACKAGE_PRICE_BELOW_MINIMUM",
  "PACKAGE_FREE_MUST_BE_ONE_TIME",
  "PACKAGE_INVALID",
  "MONEY_WINDOW_INVALID",
  "MONEY_COMPARE_WINDOW_INVALID",
  "MONEY_EXPORT_TOO_LARGE",
]);

/**
 * C-332-1 (Opus): an active sub-coach reads Money and Connect routes behind
 * NoActiveSubCoachGuard, which answers 403 `{ kind: "sub_coach_billing_blocked" }`.
 * That is a role, not a failure: the head coach's practice handles money.
 */
export const SUB_COACH_BILLING_BLOCKED = "sub_coach_billing_blocked";

export function isSubCoachBillingBlocked(err: unknown): boolean {
  if (errorStatus(err) !== 403) return false;
  const data = (err as { response?: { data?: unknown } } | null)?.response
    ?.data;
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return (
    d.kind === "sub_coach_billing_blocked" ||
    d.code === "sub_coach_billing_blocked" ||
    d.error === "sub_coach_billing_blocked"
  );
}

/**
 * Turn any thrown value into specific copy. `action` completes the sentence
 * "TGP could not ..." for the unknown case, e.g. "open Stripe". Copy never
 * speaks as "we" (owner copy rule): the app names itself TGP.
 */
export function describeError(err: unknown, action: string): FriendlyError {
  const status = errorStatus(err);
  const { code, message, stripeCode } = readBody(err);
  const requestId = extractRequestId(err);
  const base = { requestId: null, code };

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
      body: "Sign in again to continue.",
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
    // Configuration is not an account failure or a promised launch date. agent 132
    return {
      ...base,
      code: "CONNECT_NOT_CONFIGURED",
      title: "Payouts are not available yet",
      body: "Finish setup now and connect Stripe later from Get paid.",
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
      title: "Setup needs a refresh",
      body: "Try again to continue from the saved step.",
      retryable: true,
    };
  }
  // OR-112-16: package create is idempotent per Idempotency-Key.
  if (status === 409 && code === "IDEMPOTENCY_IN_PROGRESS") {
    return {
      ...base,
      title: "Your package is still being saved",
      body: "The first try is still finishing. Wait a few seconds, then tap Create package again. It will not be made twice.",
      retryable: true,
    };
  }
  if (code === "IDEMPOTENCY_KEY_REUSED") {
    return {
      ...base,
      title: "Your package was already saved",
      body: "Tap Create package again to finish with the details shown.",
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
  if (isSubCoachBillingBlocked(err)) {
    return {
      ...base,
      // B-332-9: one canonical code, so a page can tell a role from a failure.
      code: SUB_COACH_BILLING_BLOCKED,
      title: "Money is handled by your head coach",
      body: "Your head coach's practice takes payments and receives payouts for the clients you coach. Ask your head coach about payments.",
      retryable: false,
    };
  }
  if (code === "MONEY_PAYLOAD_INVALID") {
    // B-332-3: the app refused figures it could not check rather than show
    // a made-up number.
    captureError(err, { area: "coach_money", action, status, code, requestId });
    return {
      ...base,
      requestId,
      title: "These money figures could not be checked",
      body: `These figures could not be confirmed. Try again.${supportSentence()}`,
      retryable: true,
    };
  }
  if (code === "MONEY_CURRENCY_INVALID") {
    return {
      ...base,
      title: "That currency is not on your account",
      body: "Pick one of the currencies shown at the top of Money.",
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
  if (code === "PACKAGE_UPDATE_NOT_APPLIED") {
    return {
      ...base,
      title: "The new price or billing did not save",
      body: "TGP did not confirm the change, so clients still see the price and billing shown in Packages. Try again.",
      retryable: true,
    };
  }
  if (status !== undefined && status >= 500) {
    const reference = report(err, "server", action, status, code);
    return {
      ...base,
      requestId: reference,
      title: `TGP could not ${action}`,
      body: `Try again in a minute.${supportSentence()}`,
      retryable: true,
    };
  }
  const reference = report(err, "unknown", action, status, code);
  return {
    ...base,
    requestId: reference,
    title: `TGP could not ${action}`,
    body: `Try again.${supportSentence()}`,
    retryable: true,
  };
}

function supportSentence(): string {
  return ` If it keeps happening, contact ${COACH_SUPPORT_EMAIL}.`;
}
