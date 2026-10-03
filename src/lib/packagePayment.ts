/**
 * Package payment: the one client for every route that sells a coach package
 * in the app, plus the copy table and the error mapping. Used by the shared
 * purchase flow (src/hooks/usePackagePurchase.ts), which every selling
 * surface goes through: the Day 1 / package_prompt sheet, Membership plans
 * (ClientPackagesScreen) and share links (PackageCheckoutScreen).
 *
 * Backend contracts:
 *   POST /v1/checkout/payment-intent        one-time packages (CreatePaymentIntentDto)
 *     body  { package_id @IsUUID, idempotency_key @IsUUID } (whitelist + forbidNonWhitelisted)
 *     200   { client_secret, ephemeral_key, customer_id, publishable_key }
 *     409   RECURRING_REQUIRES_SUBSCRIPTION for a renewing package (backend #654)
 *   POST /v1/checkout/subscription-intent   renewing packages (backend #654)
 *     body  { package_id, idempotency_key, expected_amount_cents? }
 *     200   { mode: 'payment'|'setup', client_secret, ephemeral_key, customer_id,
 *             publishable_key, purchase_id, subscription_id, status, reused,
 *             plan: { amount_cents, currency, interval, interval_count,
 *                     first_charge_cents, one_time_cents, trial_days,
 *                     trial_ends_at, package_id, package_name } }
 *   GET  /v1/checkout/subscriptions          { plans: ClientPlanView[] }
 *   GET  /v1/checkout/subscriptions/:id      ClientPlanView (polled while confirming)
 *   POST /v1/checkout/subscriptions/:id/resume { idempotency_key }
 *   POST /v1/checkout/subscriptions/:id/cancel (backend #628, cancel at period end)
 *   POST /v1/packages/:id/claim-free         $0 one-time packages, never Stripe
 *   GET  /v1/clients/me/coach/packages/:id   one package (current price after
 *                                            PACKAGE_PRICE_CHANGED)
 *
 * Error bodies carry the machine code in `code` (and `error`) plus
 * `request_id`. The global HttpExceptionFilter keeps only statusCode, code,
 * message, error, timestamp, path and request_id, so extra fields the service
 * puts on a 409 (`amount_cents` on PACKAGE_PRICE_CHANGED, `purchase_id` on
 * SUBSCRIPTION_ALREADY_ACTIVE) are read when present and otherwise looked up
 * through the routes above (see the report's CONTRACT GAP section).
 *
 * Privacy: client secrets and ephemeral keys live only in memory for the one
 * PaymentSheet call. Nothing here logs, persists or reports them; Sentry
 * reports carry step, cause, status, machine code, Stripe error code and the
 * short reference only.
 */
import api from "../services/api";
import { captureError } from "../services/sentry";
import { errorStatus } from "../types/common";
import { shortReference, supportReferenceOf } from "../utils/correlation";
import type { PlanInterval } from "./planTerms";

export const PAYMENT_INTENT_PATH = "/v1/checkout/payment-intent";
export const SUBSCRIPTION_INTENT_PATH = "/v1/checkout/subscription-intent";
export const SUBSCRIPTIONS_PATH = "/v1/checkout/subscriptions";
export const subscriptionPath = (purchaseId: string) =>
  `${SUBSCRIPTIONS_PATH}/${encodeURIComponent(purchaseId)}`;
export const claimFreePath = (packageId: string) =>
  `/v1/packages/${encodeURIComponent(packageId)}/claim-free`;
export const clientPackagePath = (packageId: string) =>
  `/v1/clients/me/coach/packages/${encodeURIComponent(packageId)}`;

/** Exactly the fields of the backend CreatePaymentIntentDto. */
export interface PaymentIntentRequest {
  package_id: string;
  idempotency_key: string;
}

/** Exactly the fields of the backend CreateSubscriptionIntentDto. */
export interface SubscriptionIntentRequest {
  package_id: string;
  idempotency_key: string;
  expected_amount_cents?: number;
}

export interface PaymentSheetSecrets {
  clientSecret: string;
  ephemeralKey: string;
  customerId: string;
  /** '' when the backend did not send one; the caller falls back to the build key. */
  publishableKey: string;
}

export interface SubscriptionIntent extends PaymentSheetSecrets {
  /** 'payment' charges now; 'setup' saves a card for a free trial. */
  mode: "payment" | "setup";
  purchaseId: string;
  plan: {
    amountCents: number | null;
    currency: string | null;
    interval: PlanInterval | null;
    intervalCount: number | null;
    firstChargeCents: number | null;
    oneTimeCents: number | null;
    trialDays: number | null;
    trialEndsAt: string | null;
  };
}

/** Thrown when a 200 does not carry what PaymentSheet needs. */
export class PaymentIntentShapeError extends Error {
  constructor(
    readonly route: "payment_intent" | "subscription_intent" = "payment_intent",
  ) {
    super(
      route === "payment_intent"
        ? "PAYMENT_INTENT_RESPONSE_SHAPE"
        : "SUBSCRIPTION_INTENT_RESPONSE_SHAPE",
    );
    this.name = "PaymentIntentShapeError";
  }
}

function nonEmpty(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export async function createPackagePaymentIntent(
  packageId: string,
  idempotencyKey: string,
): Promise<PaymentSheetSecrets> {
  const body: PaymentIntentRequest = {
    package_id: packageId,
    idempotency_key: idempotencyKey,
  };
  const res = await api.post<Record<string, unknown>>(
    PAYMENT_INTENT_PATH,
    body,
  );
  const d = res?.data ?? {};
  if (
    !nonEmpty(d.client_secret) ||
    !nonEmpty(d.ephemeral_key) ||
    !nonEmpty(d.customer_id)
  ) {
    throw new PaymentIntentShapeError("payment_intent");
  }
  return {
    clientSecret: d.client_secret,
    ephemeralKey: d.ephemeral_key,
    customerId: d.customer_id,
    publishableKey: nonEmpty(d.publishable_key) ? d.publishable_key : "",
  };
}

export async function createSubscriptionIntent(
  packageId: string,
  idempotencyKey: string,
  expectedAmountCents: number | null,
): Promise<SubscriptionIntent> {
  const body: SubscriptionIntentRequest = {
    package_id: packageId,
    idempotency_key: idempotencyKey,
  };
  if (typeof expectedAmountCents === "number")
    body.expected_amount_cents = expectedAmountCents;
  const res = await api.post<Record<string, unknown>>(
    SUBSCRIPTION_INTENT_PATH,
    body,
  );
  const d = res?.data ?? {};
  const mode =
    d.mode === "setup" ? "setup" : d.mode === "payment" ? "payment" : null;
  if (
    !mode ||
    !nonEmpty(d.client_secret) ||
    !nonEmpty(d.ephemeral_key) ||
    !nonEmpty(d.customer_id) ||
    !nonEmpty(d.purchase_id) ||
    // A SetupIntent secret starts with seti_, a PaymentIntent secret with pi_.
    // A mismatch would open the wrong sheet; treat it as a support case.
    (mode === "setup") !== d.client_secret.startsWith("seti_")
  ) {
    throw new PaymentIntentShapeError("subscription_intent");
  }
  const p = (d.plan && typeof d.plan === "object" ? d.plan : {}) as Record<
    string,
    unknown
  >;
  const interval =
    p.interval === "week" || p.interval === "month" || p.interval === "year"
      ? p.interval
      : null;
  return {
    mode,
    clientSecret: d.client_secret,
    ephemeralKey: d.ephemeral_key,
    customerId: d.customer_id,
    publishableKey: nonEmpty(d.publishable_key) ? d.publishable_key : "",
    purchaseId: d.purchase_id,
    plan: {
      amountCents: numOrNull(p.amount_cents),
      currency: typeof p.currency === "string" ? p.currency : null,
      interval,
      intervalCount: numOrNull(p.interval_count),
      firstChargeCents: numOrNull(p.first_charge_cents),
      oneTimeCents: numOrNull(p.one_time_cents),
      trialDays: numOrNull(p.trial_days),
      trialEndsAt: typeof p.trial_ends_at === "string" ? p.trial_ends_at : null,
    },
  };
}

/** `true` when the free plan is active now; `false` when it is saved but waiting on consent. */
export async function claimFreePackage(packageId: string): Promise<boolean> {
  const res = await api.post<{ active?: unknown }>(claimFreePath(packageId));
  return res?.data?.active === true;
}

// ─── Client plans (GET /v1/checkout/subscriptions) ─────────────────────────

export type PlanState =
  | "confirming"
  | "payment_failed"
  | "trialing"
  | "active"
  | "past_due"
  | "ended";

export interface ClientPlan {
  purchaseId: string;
  packageId: string;
  packageName: string;
  state: PlanState;
  entitlementActive: boolean;
  amountCents: number;
  currency: string;
  interval: PlanInterval | null;
  intervalCount: number;
  nextChargeAt: string | null;
  cancelAtPeriodEnd: boolean;
  accessEndsAt: string | null;
  trialEndsAt: string | null;
  canCancel: boolean;
  canResume: boolean;
}

const PLAN_STATES: ReadonlySet<string> = new Set([
  "confirming",
  "payment_failed",
  "trialing",
  "active",
  "past_due",
  "ended",
]);

export function normalizePlan(raw: unknown): ClientPlan | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (
    !nonEmpty(r.purchase_id) ||
    typeof r.state !== "string" ||
    !PLAN_STATES.has(r.state)
  )
    return null;
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  return {
    purchaseId: r.purchase_id,
    packageId: typeof r.package_id === "string" ? r.package_id : "",
    packageName: typeof r.package_name === "string" ? r.package_name : "",
    state: r.state as PlanState,
    entitlementActive: r.entitlement_active === true,
    amountCents: numOrNull(r.amount_cents) ?? 0,
    currency: typeof r.currency === "string" && r.currency ? r.currency : "usd",
    interval:
      r.interval === "week" || r.interval === "month" || r.interval === "year"
        ? r.interval
        : null,
    intervalCount: numOrNull(r.interval_count) ?? 1,
    nextChargeAt: str(r.next_charge_at),
    cancelAtPeriodEnd: r.cancel_at_period_end === true,
    accessEndsAt: str(r.access_ends_at),
    trialEndsAt: str(r.trial_ends_at),
    canCancel: r.can_cancel === true,
    canResume: r.can_resume === true,
  };
}

export async function getClientPlan(
  purchaseId: string,
): Promise<ClientPlan | null> {
  const res = await api.get<unknown>(subscriptionPath(purchaseId));
  return normalizePlan(res?.data);
}

export async function listClientPlans(): Promise<ClientPlan[]> {
  const res = await api.get<{ plans?: unknown[] }>(SUBSCRIPTIONS_PATH);
  const plans = Array.isArray(res?.data?.plans) ? res.data.plans : [];
  return plans.map(normalizePlan).filter((p): p is ClientPlan => p !== null);
}

export async function resumeClientPlan(
  purchaseId: string,
  idempotencyKey: string,
): Promise<ClientPlan | null> {
  const res = await api.post<unknown>(
    `${subscriptionPath(purchaseId)}/resume`,
    {
      idempotency_key: idempotencyKey,
    },
  );
  return normalizePlan(res?.data);
}

/** Cancel at period end (backend #628 ClientBillingController). */
export async function cancelClientPlan(purchaseId: string): Promise<void> {
  await api.post(`${subscriptionPath(purchaseId)}/cancel`, {});
}

/** The package's current renewal price (after PACKAGE_PRICE_CHANGED). */
export async function fetchClientPackage(
  packageId: string,
): Promise<Record<string, unknown> | null> {
  const res = await api.get<unknown>(clientPackagePath(packageId));
  const d = res?.data;
  if (!d || typeof d !== "object") return null;
  const wrapped = (d as { package?: unknown }).package;
  return (wrapped && typeof wrapped === "object" ? wrapped : d) as Record<
    string,
    unknown
  >;
}

// ─── Stripe SDK ────────────────────────────────────────────────────────────

export interface StripeSdkError {
  code?: string;
  declineCode?: string;
  stripeErrorCode?: string;
  type?: string;
}

export interface PackageStripeSdk {
  initStripe: (params: {
    publishableKey: string;
    merchantIdentifier?: string;
    urlScheme?: string;
    setReturnUrlSchemeOnAndroid?: boolean;
  }) => Promise<void>;
  initPaymentSheet: (
    params: Record<string, unknown>,
  ) => Promise<{ error?: StripeSdkError }>;
  presentPaymentSheet: () => Promise<{ error?: StripeSdkError }>;
}

/** App scheme (app.json `scheme`); Stripe returns here after a bank redirect. */
export const STRIPE_URL_SCHEME = "tgp";
export const STRIPE_RETURN_URL = "tgp://stripe-redirect";

/**
 * Lazy so a build without the native module (Expo Go, an old binary) gets a
 * specific "update the app" message instead of a crash on import.
 */
export function loadPackageStripeSdk(): PackageStripeSdk | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod: Partial<PackageStripeSdk> = require("@stripe/stripe-react-native");
    return typeof mod.initStripe === "function" &&
      typeof mod.initPaymentSheet === "function" &&
      typeof mod.presentPaymentSheet === "function"
      ? (mod as PackageStripeSdk)
      : null;
  } catch {
    return null;
  }
}

// ─── What the client is told ──────────────────────────────────────────────
// Rules: says what happened and what to do next; no first person, no
// exclamation marks, no emojis, never "Something went wrong" or "try again"
// alone. "Start again" means the plan's own pay button, which stays enabled.

export const PACKAGE_PAYMENT_COPY = {
  offline:
    "This phone is offline, so the payment did not start and nothing was charged. Check your connection, then start again.",
  connectionDropped:
    "The connection dropped during the payment. Check your connection, then start again. If the payment went through, your plan shows in Membership within a minute.",
  sessionEnded:
    "Your session has ended, so nothing was charged. Sign in again, then choose your plan.",
  sdkMissing:
    "Card payments need the latest version of the app. Update the app from your app store, then choose your plan again.",
  declined:
    "Your bank declined this card, so nothing was charged. Start again with a different card, or ask your bank about the decline.",
  insufficientFunds:
    "This card does not have enough funds, so nothing was charged. Start again with a different card.",
  expiredCard:
    "This card has expired, so nothing was charged. Start again with a different card.",
  incorrectDetails:
    "The card number or security code did not match, so nothing was charged. Start again and check the card details.",
  authFailed:
    "Your bank could not confirm this payment, so nothing was charged. Start again to confirm with your bank, or use a different card.",
  setupDeclined:
    "Your bank did not accept this card for the trial, so the trial has not started and nothing was charged. Start again with a different card.",
  sheetTimeout:
    "The payment form closed before it finished, so nothing was charged. Start again when you are ready.",
  packageUnavailable:
    "This plan is no longer offered, so nothing was charged. Pull down to see your coach’s current plans, or message your coach.",
  packageUnavailableShareLink:
    "This plan cannot be bought from this account. It is either no longer offered or it belongs to a coach you are not connected with. Nothing was charged. Message the coach who shared the link.",
  accountMissing:
    "Your account could not be found, so nothing was charged. Sign out, sign back in, then choose your plan.",
  coachMissing: (ref: string | null) =>
    `Your coach’s account could not be found, so nothing was charged. Email support${ref ? ` and quote reference ${ref}` : ""}, and the team will reconnect you.`,
  coachNotConnected:
    "Your coach has not set up card payments yet, so this plan cannot start and nothing was charged. Message your coach, then choose the plan once they are set up.",
  coachNotReady:
    "Your coach cannot take card payments right now, so this plan cannot start and nothing was charged. Message your coach, then choose the plan once they are ready.",
  contractRequired:
    "This plan needs a signed coaching agreement before payment, so nothing was charged. Message your coach for the agreement, then choose the plan again.",
  inProgress:
    "This payment is still being set up. Wait a few seconds, then start again. You will not be charged twice.",
  retrySameAttempt:
    "The last attempt did not finish and nothing was charged. Start again to continue where it stopped. You will not be charged twice.",
  rateLimited: (minutes: number) =>
    `There have been too many payment attempts, so this one did not start. Wait ${minutes} ${minutes === 1 ? "minute" : "minutes"}, then start again.`,
  termsChanged:
    "Your coach changed how this plan is billed, so nothing was charged. The plan now shows its current terms. Review them, then start again.",
  intervalInvalid:
    "This plan has no valid billing period, so it cannot start and nothing was charged. Message your coach to fix the plan.",
  priceChanged: (oldPrice: string | null, newPrice: string | null) =>
    newPrice
      ? `The price of this plan changed${oldPrice ? ` from ${oldPrice}` : ""} to ${newPrice}. Nothing was charged. Confirm the new price to continue.`
      : "The price of this plan changed, so nothing was charged. Pull down to see the current price, then choose the plan again.",
  confirmNewPrice: (newPrice: string) => `Continue at ${newPrice}`,
  alreadyActive:
    "You already have this plan, so nothing more was charged. Open your plan to see your next charge date.",
  alreadyActiveEnding:
    "You already have this plan, and it is set to end at the close of this period. Open your plan to keep it instead of starting it again.",
  openPlan: "Open your plan",
  planNotFound:
    "This plan could not be found on your account, so nothing changed. Pull down to refresh your plans.",
  planAlreadyEnded:
    "This plan has already ended, so nothing changed and nothing more is charged. Choose a plan below to start again.",
  freePending:
    "This free plan is saved. It starts once your coaching agreement is accepted. Message your coach if it does not start.",
  freeRevoked:
    "Your coach removed this plan from your account. Message your coach to have it restored.",
  freeNoLongerFree:
    "This plan is no longer free, so it was not added. Pull down to see its current price, then choose it again.",
  setupUnavailable: (ref: string | null) =>
    `The trial could not be set up right now and nothing was charged. Wait a minute, then start again. If it keeps happening, email support${ref ? ` and quote reference ${ref}` : ""}.`,
  stripeUnavailable: (ref: string | null) =>
    `The payment service did not answer, so nothing was charged. Wait a minute, then start again. If it keeps happening, email support${ref ? ` and quote reference ${ref}` : ""}.`,
  paymentsOff: (ref: string | null) =>
    `Card payments are not switched on for this app yet, so nothing was charged. Email support${ref ? ` and quote reference ${ref}` : ""}.`,
  unknown: (ref: string | null) =>
    `The payment did not go through and nothing was charged. Email support${ref ? ` and quote reference ${ref}` : ""}, and the team will sort it out with you.`,
  planPaymentFailed:
    "Your card was not charged for this plan. Start again with a different card, or ask your bank about the payment.",
  // Progress and success
  starting: "Preparing a secure payment form.",
  confirmingPlan: "Confirming your plan.",
  confirming: "Payment received. Setting up your plan.",
  confirmingFree: "Adding your free plan.",
  confirmSlow:
    "Your card was accepted. Stripe is still confirming your plan, which usually takes under a minute. You can carry on; your plan appears in Membership as soon as it is confirmed.",
  confirmedPending:
    "Your payment went through. Your plan can take a minute to show in the app. Choose Continue to carry on.",
  confirmedPendingFree:
    "Your free plan is added. It can take a minute to show in the app. Choose Continue to carry on.",
  checkAgain: "Check again",
  continue: "Continue",
  successTitle: "Your plan is active",
  successTrialTitle: "Your trial has started",
  successFreeTitle: "Your free plan is added",
  successBody: (name: string, next: string | null) =>
    `Welcome to ${name || "your plan"}.${next ? ` ${next}` : ""} Your coach can see you are on board.`,
  nextChargeOn: (amount: string, date: string) =>
    `Your next charge of ${amount} is on ${date}.`,
  firstChargeOn: (amount: string, date: string) =>
    `Your first charge of ${amount} is on ${date}.`,
  supportAction: "Email support",
  supportSubject: (ref: string | null) =>
    ref ? `Help with a plan payment (ref ${ref})` : "Help with a plan payment",
} as const;

export interface PackagePaymentNotice {
  message: string;
  /** Stable machine name of the cause, for tests and Sentry. */
  cause: string;
  /** Show the support email action. */
  support: boolean;
  /** Short reference shown to the client and sent to Sentry. */
  reference: string | null;
  /** 'info' for guidance that is not a failure (free plan waiting on consent). */
  tone?: "info";
  /** The surface should reload its package list (terms or price moved). */
  reload?: boolean;
}

export type PaymentStep =
  | "payment_intent"
  | "subscription_intent"
  | "claim_free"
  | "sheet_init"
  | "sheet_present"
  | "plan_poll"
  | "plan_action"
  | "config";

/**
 * Report an unexpected failure. Only status, machine code, Stripe error code
 * and the short reference: never the request, the response or a secret.
 */
export function reportPackagePaymentFailure(
  step: PaymentStep,
  notice: PackagePaymentNotice,
  extra: {
    status?: number | null;
    code?: string | null;
    stripe?: StripeSdkError | null;
  } = {},
): void {
  try {
    captureError(new Error(`package payment failed: ${notice.cause}`), {
      where: "packagePurchase",
      step,
      cause: notice.cause,
      status: extra.status ?? null,
      code: extra.code ?? null,
      reference: notice.reference,
      stripe_error_code: extra.stripe?.code ?? null,
      stripe_decline_code: extra.stripe?.declineCode ?? null,
      stripe_error_type: extra.stripe?.type ?? null,
    });
  } catch {
    // Reporting can never break the payment flow.
  }
}

/** The backend machine code (`code`, else the thrown body's `error`), or null. */
export function backendCodeOf(err: unknown): string | null {
  const data = (err as { response?: { data?: unknown } } | null)?.response
    ?.data;
  if (!data || typeof data !== "object") return null;
  const d = data as { code?: unknown; error?: unknown };
  if (typeof d.code === "string" && d.code) return d.code;
  if (typeof d.error === "string" && d.error) return d.error;
  return null;
}

/** A field from an error body (present only if the backend filter keeps it). */
export function backendFieldOf(err: unknown, field: string): unknown {
  const data = (err as { response?: { data?: unknown } } | null)?.response
    ?.data;
  if (!data || typeof data !== "object") return undefined;
  return (data as Record<string, unknown>)[field];
}

function retryAfterMinutes(err: unknown): number {
  const data = (
    err as { response?: { data?: { retryAfter?: unknown } } } | null
  )?.response?.data;
  const seconds =
    typeof data?.retryAfter === "number" && data.retryAfter > 0
      ? data.retryAfter
      : 3600;
  return Math.max(1, Math.ceil(seconds / 60));
}

function notice(
  cause: string,
  message: string,
  reload = false,
): PackagePaymentNotice {
  return {
    cause,
    message,
    support: false,
    reference: null,
    ...(reload ? { reload: true } : {}),
  };
}

function supportNotice(
  cause: string,
  ref: string | null,
  message: string,
): PackagePaymentNotice {
  return { cause, message, support: true, reference: ref };
}

export interface DescribeContext {
  /** Share links (storefront) get their own PACKAGE_NOT_FOUND copy. */
  surface?: "sheet" | "plans" | "share_link";
}

/**
 * Map a failed backend call to what the client is told. `attemptRef` is the
 * short form of this attempt's idempotency key, used when the server sent no
 * request id. The two special 409s (PACKAGE_PRICE_CHANGED,
 * SUBSCRIPTION_ALREADY_ACTIVE) and the reroutes (PACKAGE_IS_FREE,
 * RECURRING_REQUIRES_SUBSCRIPTION, ONE_TIME_REQUIRES_PAYMENT_INTENT) are
 * handled by the purchase flow before this is called; the mapping below still
 * covers them so no code ever falls through to a generic message.
 */
export function describeBackendFailure(
  err: unknown,
  step:
    | "payment_intent"
    | "subscription_intent"
    | "claim_free"
    | "plan_poll"
    | "plan_action",
  attemptRef: string | null,
  ctx: DescribeContext = {},
): PackagePaymentNotice {
  if (err instanceof PaymentIntentShapeError) {
    const n = supportNotice(
      "response_shape",
      attemptRef,
      PACKAGE_PAYMENT_COPY.unknown(attemptRef),
    );
    reportPackagePaymentFailure(step, n, { status: 200, code: err.message });
    return n;
  }
  const status = errorStatus(err) ?? null;
  if (status === null) return notice("offline", PACKAGE_PAYMENT_COPY.offline);
  const code = backendCodeOf(err);
  const ref = shortReference(supportReferenceOf(err)) ?? attemptRef;

  if (status === 401)
    return notice("session_ended", PACKAGE_PAYMENT_COPY.sessionEnded);
  if (status === 429)
    return notice(
      "rate_limited",
      PACKAGE_PAYMENT_COPY.rateLimited(retryAfterMinutes(err)),
    );
  switch (code) {
    case "PACKAGE_NOT_FOUND":
      return ctx.surface === "share_link"
        ? notice(
            "package_unavailable",
            PACKAGE_PAYMENT_COPY.packageUnavailableShareLink,
          )
        : notice(
            "package_unavailable",
            PACKAGE_PAYMENT_COPY.packageUnavailable,
            true,
          );
    case "CLIENT_NOT_FOUND":
      return notice("account_missing", PACKAGE_PAYMENT_COPY.accountMissing);
    case "COACH_NOT_FOUND": {
      const n = supportNotice(
        "coach_missing",
        ref,
        PACKAGE_PAYMENT_COPY.coachMissing(ref),
      );
      reportPackagePaymentFailure(step, n, { status, code });
      return n;
    }
    case "COACH_NOT_CONNECTED":
      return notice(
        "coach_not_connected",
        PACKAGE_PAYMENT_COPY.coachNotConnected,
      );
    case "COACH_NOT_PAYOUT_READY":
      return notice("coach_not_ready", PACKAGE_PAYMENT_COPY.coachNotReady);
    case "CONTRACT_SIGNATURE_REQUIRED":
      return notice("contract_required", PACKAGE_PAYMENT_COPY.contractRequired);
    case "PAYMENT_IN_PROGRESS":
      return notice("in_progress", PACKAGE_PAYMENT_COPY.inProgress);
    case "PAYMENT_RETRY":
      return notice(
        "retry_same_attempt",
        PACKAGE_PAYMENT_COPY.retrySameAttempt,
      );
    case "RECURRING_REQUIRES_SUBSCRIPTION":
    case "ONE_TIME_REQUIRES_PAYMENT_INTENT":
      return notice("terms_changed", PACKAGE_PAYMENT_COPY.termsChanged, true);
    case "PACKAGE_INTERVAL_INVALID":
      return notice("interval_invalid", PACKAGE_PAYMENT_COPY.intervalInvalid);
    case "PACKAGE_PRICE_CHANGED":
      return notice(
        "price_changed",
        PACKAGE_PAYMENT_COPY.priceChanged(null, null),
        true,
      );
    case "SUBSCRIPTION_ALREADY_ACTIVE":
      return notice(
        "already_active",
        backendFieldOf(err, "cancel_at_period_end") === true
          ? PACKAGE_PAYMENT_COPY.alreadyActiveEnding
          : PACKAGE_PAYMENT_COPY.alreadyActive,
      );
    case "PACKAGE_IS_FREE":
    case "PACKAGE_NOT_FREE":
      return notice(
        code === "PACKAGE_NOT_FREE" ? "free_no_longer_free" : "terms_changed",
        code === "PACKAGE_NOT_FREE"
          ? PACKAGE_PAYMENT_COPY.freeNoLongerFree
          : PACKAGE_PAYMENT_COPY.termsChanged,
        true,
      );
    case "GRANT_REVOKED":
      return notice("free_revoked", PACKAGE_PAYMENT_COPY.freeRevoked);
    // Plan actions (End my plan / Keep my plan, backend #628 / #654)
    case "PURCHASE_NOT_FOUND":
    case "INVALID_PLAN_ID":
      return notice("plan_not_found", PACKAGE_PAYMENT_COPY.planNotFound, true);
    case "PLAN_ALREADY_ENDED":
      return notice(
        "plan_already_ended",
        PACKAGE_PAYMENT_COPY.planAlreadyEnded,
        true,
      );
    case "SUBSCRIPTION_SETUP_UNAVAILABLE": {
      const n = supportNotice(
        "setup_unavailable",
        ref,
        PACKAGE_PAYMENT_COPY.setupUnavailable(ref),
      );
      reportPackagePaymentFailure(step, n, { status, code });
      return n;
    }
    case "STRIPE_CHECKOUT_ERROR": {
      const n = supportNotice(
        "stripe_unavailable",
        ref,
        PACKAGE_PAYMENT_COPY.stripeUnavailable(ref),
      );
      reportPackagePaymentFailure(step, n, { status, code });
      return n;
    }
    case "CONNECT_NOT_CONFIGURED": {
      const n = supportNotice(
        "payments_not_configured",
        ref,
        PACKAGE_PAYMENT_COPY.paymentsOff(ref),
      );
      reportPackagePaymentFailure(step, n, { status, code });
      return n;
    }
    default: {
      const n = supportNotice(
        code
          ? `backend_${code.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`
          : `http_${status}`,
        ref,
        PACKAGE_PAYMENT_COPY.unknown(ref),
      );
      reportPackagePaymentFailure(step, n, { status, code });
      return n;
    }
  }
}

const DECLINE_INSUFFICIENT = new Set(["insufficient_funds"]);
const DECLINE_EXPIRED = new Set(["expired_card"]);
const DECLINE_DETAILS = new Set([
  "incorrect_cvc",
  "invalid_cvc",
  "incorrect_number",
  "invalid_number",
  "invalid_expiry_month",
  "invalid_expiry_year",
]);
const AUTH_FAILED = new Set([
  "payment_intent_authentication_failure",
  "authentication_required",
  "setup_intent_authentication_failure",
]);

/** Is this PaymentSheet result the client closing the sheet? (not an error) */
export function isSheetCanceled(
  error: StripeSdkError | undefined | null,
): boolean {
  return error?.code === "Canceled";
}

/** Map a PaymentSheet (init or present) error to what the client is told. */
export function describeSheetFailure(
  error: StripeSdkError,
  step: "sheet_init" | "sheet_present",
  attemptRef: string | null,
  mode: "payment" | "setup" = "payment",
): PackagePaymentNotice {
  const decline = error.declineCode ?? "";
  const stripeCode = error.stripeErrorCode ?? "";
  if (error.code === "Timeout")
    return notice("sheet_timeout", PACKAGE_PAYMENT_COPY.sheetTimeout);
  if (AUTH_FAILED.has(stripeCode) || AUTH_FAILED.has(decline)) {
    return notice("authentication_failed", PACKAGE_PAYMENT_COPY.authFailed);
  }
  if (
    DECLINE_INSUFFICIENT.has(decline) ||
    DECLINE_INSUFFICIENT.has(stripeCode)
  ) {
    return notice("insufficient_funds", PACKAGE_PAYMENT_COPY.insufficientFunds);
  }
  if (DECLINE_EXPIRED.has(decline) || DECLINE_EXPIRED.has(stripeCode)) {
    return notice("expired_card", PACKAGE_PAYMENT_COPY.expiredCard);
  }
  if (DECLINE_DETAILS.has(decline) || DECLINE_DETAILS.has(stripeCode)) {
    return notice("incorrect_details", PACKAGE_PAYMENT_COPY.incorrectDetails);
  }
  if (
    decline ||
    stripeCode === "card_declined" ||
    error.type === "card_error"
  ) {
    return mode === "setup"
      ? notice("card_declined", PACKAGE_PAYMENT_COPY.setupDeclined)
      : notice("card_declined", PACKAGE_PAYMENT_COPY.declined);
  }
  if (error.type === "api_connection_error") {
    return notice("connection_dropped", PACKAGE_PAYMENT_COPY.connectionDropped);
  }
  const n = supportNotice(
    `stripe_${step}`,
    attemptRef,
    PACKAGE_PAYMENT_COPY.unknown(attemptRef),
  );
  reportPackagePaymentFailure(step, n, { stripe: error });
  return n;
}

/** The SDK threw instead of answering (rare); always a support case. */
export function describeSheetCrash(
  step: "sheet_init" | "sheet_present",
  attemptRef: string | null,
): PackagePaymentNotice {
  const n = supportNotice(
    `stripe_${step}_threw`,
    attemptRef,
    PACKAGE_PAYMENT_COPY.unknown(attemptRef),
  );
  reportPackagePaymentFailure(step, n);
  return n;
}

/** This build has no Stripe native module (Expo Go, an old binary). */
export function describeSdkMissing(): PackagePaymentNotice {
  return notice("sdk_missing", PACKAGE_PAYMENT_COPY.sdkMissing);
}

/** No publishable key in the backend answer or the build: payments are off. */
export function describeMissingPublishableKey(
  attemptRef: string | null,
): PackagePaymentNotice {
  const n = supportNotice(
    "publishable_key_missing",
    attemptRef,
    PACKAGE_PAYMENT_COPY.paymentsOff(attemptRef),
  );
  reportPackagePaymentFailure("config", n);
  return n;
}

/** The plan answered payment_failed while confirming (declined after the sheet). */
export function describePlanPaymentFailed(): PackagePaymentNotice {
  return notice("plan_payment_failed", PACKAGE_PAYMENT_COPY.planPaymentFailed);
}
