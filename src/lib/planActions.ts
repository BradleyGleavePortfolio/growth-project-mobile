/**
 * Your plans: End my plan / Keep my plan outcomes and failures.
 *
 *   POST /v1/checkout/subscriptions/:id/cancel  CancelPlanResult (dunning D3/D4)
 *
 * B-344-2/5: the cancel answer says what happened (scheduled = access to the
 * end of the paid period; ended = owner ruling 2A, access ends now and the
 * unpaid invoice is voided). B-344-6: a failed plan action says what happened
 * to the PLAN (never a payment that did not start) and a support case gets a
 * reference. B-344-1: the list read tells a missing route (today's production
 * backend, bare 404) from a failed read.
 */
import api from "../services/api";
import { errorStatus } from "../types/common";
import { shortReference, supportReferenceOf } from "../utils/correlation";
import {
  backendCodeOf,
  describeBackendFailure,
  machineCode,
  reportPackagePaymentFailure,
  subscriptionPath,
  type PackagePaymentNotice,
} from "./packagePayment";
import { formatPlanDate, money } from "./planTerms";

export type PlanAction = "cancel" | "resume";

export interface CancelOutcome {
  outcome: "ended" | "scheduled" | "already_ended";
  accessEndsAt: string | null;
  voidedAmountCents: number;
  /** null when the backend did not say: the amount is then not shown. */
  currency: string | null;
  paidPeriodKept: boolean;
}

export function parseCancelOutcome(raw: unknown): CancelOutcome | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (
    r.outcome !== "ended" &&
    r.outcome !== "scheduled" &&
    r.outcome !== "already_ended"
  )
    return null;
  const voided = r.voided_amount_cents;
  return {
    outcome: r.outcome,
    accessEndsAt:
      typeof r.access_ends_at === "string" && r.access_ends_at
        ? r.access_ends_at
        : null,
    voidedAmountCents:
      typeof voided === "number" && Number.isInteger(voided) && voided > 0
        ? voided
        : 0,
    currency: typeof r.currency === "string" && r.currency ? r.currency : null,
    paidPeriodKept: r.paid_period_kept === true,
  };
}

/** null when the backend answered without an outcome (older #628 route). */
export async function cancelPlan(
  purchaseId: string,
): Promise<CancelOutcome | null> {
  const res = await api.post<unknown>(
    `${subscriptionPath(purchaseId)}/cancel`,
    {},
  );
  return parseCancelOutcome(res?.data);
}

export function planDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : formatPlanDate(d);
}

const quote = (ref: string | null) =>
  ref ? ` and quote reference ${ref}` : "";
const verb = (a: PlanAction) =>
  a === "cancel" ? "End my plan" : "Keep my plan";

export const PLAN_ACTION_COPY = {
  /** B-344-7: trial = the scheduled end is the trial end, before any charge. */
  outcome: (o: CancelOutcome, trial = false): string => {
    const date = planDate(o.accessEndsAt);
    if (o.outcome === "already_ended")
      return "This plan had already ended, so nothing changed and nothing more is charged.";
    if (o.outcome === "ended")
      return o.voidedAmountCents > 0
        ? `This plan has ended, and access ended today. The unpaid ${o.currency ? money(o.voidedAmountCents, o.currency) : "charge"} is canceled and is never collected. Nothing more is charged.`
        : "This plan has ended, and access ended today. Nothing more is charged.";
    const until = date ? `until ${date}` : "to the end of the period";
    if (o.paidPeriodKept)
      return `The latest payment went through before the plan ended, so access continues ${until}, the period it paid for. Nothing more is charged after that.`;
    return trial && date
      ? `Your free trial ends on ${date}, and nothing is charged.`
      : `Your plan will not renew. Access continues ${until}, and nothing more is charged.`;
  },
  noAnswer: (a: PlanAction, ref: string | null) =>
    `The app could not reach the server, so it is not confirmed whether your plan changed. Check your connection, then pull down to refresh your plans before choosing ${verb(a)} again. If it is still unclear, email support${quote(ref)}.`,
  sessionEnded: (a: PlanAction) =>
    `Your session ended, so your plan was not changed. Sign in again, then choose ${verb(a)} again.`,
  rateLimited: (a: PlanAction) =>
    `Too many plan changes were sent in a short time, so your plan was not changed. Wait a few minutes, then choose ${verb(a)} again.`,
  routeMissing: (a: PlanAction) =>
    a === "cancel"
      ? "Ending a renewing plan is not available in the app yet, so your plan was not changed. Message your coach to end it."
      : "Keeping a renewing plan is not available in the app yet, so your plan was not changed. Message your coach to keep it.",
  inProgress:
    "Another change to this plan is still being processed, so nothing new was sent. Wait a few seconds, then pull down to see the result.",
  notSubscription:
    "This plan does not renew, so there is nothing to end. Message your coach if you want to change it.",
  cancelIncomplete:
    "Your plan did not finish ending, and nothing was charged for it. It finishes on its own within the hour, or choose End my plan again in a minute.",
  notConfirmed: (a: PlanAction, ref: string | null) =>
    `The payment service has not confirmed this change yet, so your plan may still show its old state. Pull down in a minute to refresh your plans, and choose ${verb(a)} again if nothing changed. If it keeps happening, email support${quote(ref)}.`,
  notChanged: (a: PlanAction, ref: string | null) =>
    `The payment service could not make this change, so your plan was not changed. Choose ${verb(a)} again in a minute. If it keeps happening, email support${quote(ref)}.`,
  unknown: (a: PlanAction, ref: string | null) =>
    `This change did not finish, and the app cannot confirm whether your plan changed. Pull down to refresh your plans before choosing ${verb(a)} again, and email support${quote(ref)}.`,
  supportSubject: (ref: string | null) =>
    ref
      ? `Help with a renewing plan (ref ${ref})`
      : "Help with a renewing plan",
} as const;

/** Today's production backend has no plan routes: a bare Nest 404. */
function routeMissing(err: unknown): boolean {
  const code = backendCodeOf(err);
  return errorStatus(err) === 404 && (code === null || code === "Not Found");
}

export function describePlanActionFailure(
  err: unknown,
  action: PlanAction,
): PackagePaymentNotice {
  const status = errorStatus(err) ?? null;
  const code = backendCodeOf(err);
  const ref = shortReference(supportReferenceOf(err));
  const plain = (cause: string, message: string, reload = false) => ({
    cause,
    message,
    support: false,
    reference: null,
    ...(reload ? { reload: true } : {}),
  });
  const support = (cause: string, message: string, reload = false) => {
    const n: PackagePaymentNotice = {
      cause,
      message,
      support: true,
      reference: ref,
      ...(reload ? { reload: true } : {}),
    };
    if (status !== null)
      reportPackagePaymentFailure("plan_action", n, {
        status,
        code: machineCode(code),
      });
    return n;
  };
  if (status === null)
    return support("no_answer", PLAN_ACTION_COPY.noAnswer(action, ref), true);
  if (routeMissing(err))
    return plain("plan_route_missing", PLAN_ACTION_COPY.routeMissing(action));
  if (status === 401)
    return plain("session_ended", PLAN_ACTION_COPY.sessionEnded(action));
  if (status === 429)
    return plain("rate_limited", PLAN_ACTION_COPY.rateLimited(action));
  switch (code) {
    case "PURCHASE_NOT_FOUND":
    case "INVALID_PLAN_ID":
    case "PLAN_ALREADY_ENDED":
    case "PLAN_CHANGE_UNCONFIRMED":
      return describeBackendFailure(err, "plan_action", null);
    case "BILLING_ACTION_IN_PROGRESS":
      return plain("in_progress", PLAN_ACTION_COPY.inProgress, true);
    case "NOT_A_SUBSCRIPTION":
      return plain("not_subscription", PLAN_ACTION_COPY.notSubscription, true);
    case "CANCEL_INCOMPLETE":
      return plain(
        "cancel_incomplete",
        PLAN_ACTION_COPY.cancelIncomplete,
        true,
      );
    case "PLAN_CHANGE_RESULT_UNKNOWN":
    case "STRIPE_UNAVAILABLE":
    case "STRIPE_CHECKOUT_ERROR":
    case "SUBSCRIPTION_SETUP_UNAVAILABLE":
      return support(
        "plan_change_unconfirmed",
        PLAN_ACTION_COPY.notConfirmed(action, ref),
        true,
      );
    case "STRIPE_REQUEST_FAILED":
    case "PAYMENTS_NOT_CONFIGURED":
    case "CUSTOMER_NOT_FOUND":
      return support(
        "plan_not_changed",
        PLAN_ACTION_COPY.notChanged(action, ref),
      );
    default: {
      const known = machineCode(code);
      return support(
        known ? `backend_${known.toLowerCase()}` : `http_${status}`,
        PLAN_ACTION_COPY.unknown(action, ref),
        true,
      );
    }
  }
}

export type PlansListFailure =
  | { kind: "unavailable" }
  | { kind: "failed"; offline: boolean; reference: string | null };

export function describePlansListFailure(err: unknown): PlansListFailure {
  if (routeMissing(err)) return { kind: "unavailable" };
  const status = errorStatus(err) ?? null;
  const reference = shortReference(supportReferenceOf(err));
  if (status !== null)
    reportPackagePaymentFailure(
      "plan_poll",
      {
        cause: `plans_list_http_${status}`,
        message: "",
        support: true,
        reference,
      },
      { status, code: machineCode(backendCodeOf(err)) },
    );
  return { kind: "failed", offline: status === null, reference };
}

export const PLANS_LIST_COPY = {
  unavailable:
    "Ending or keeping a renewing plan is not available in the app yet. Message your coach to end or change a renewing plan.",
  offline:
    "This phone could not reach the server, so your renewing plans could not load. Check your connection, then choose Try again.",
  failed: (ref: string | null) =>
    `The app could not load your renewing plans, so they cannot be ended or kept from here right now. Choose Try again, or pull down to refresh. If it keeps happening, email support${quote(ref)}.`,
  stale:
    "The latest details of your plans could not load, so what is shown may be out of date. Choose Try again, or pull down to refresh.",
  retry: "Try again",
} as const;
