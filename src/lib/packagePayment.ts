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
  /**
   * B-334-4: the one-time part the client was shown (0 for a pure renewing
   * plan). The backend answers PACKAGE_PRICE_CHANGED when it moved.
   */
  expected_one_time_cents?: number;
  /**
   * The share-link token, sent only from a share link. The backend uses it
   * only to explain a refusal (PACKAGE_COACH_NOT_CONNECTED); it never widens
   * who can buy.
   */
  share_token?: string;
}

/** Same shape the backend DTO accepts (21 chars, nanoid alphabet). */
const SHARE_TOKEN_SHAPE = /^[A-Za-z0-9_-]{21}$/;

export interface PaymentSheetSecrets {
  clientSecret: string;
  ephemeralKey: string;
  customerId: string;
  /** '' when the backend did not send one; the caller falls back to the build key. */
  publishableKey: string;
}

export interface SubscriptionIntent extends PaymentSheetSecrets {
  /**
   * 'payment' charges now; 'setup' saves a card for a free trial.
   * 'none' (backend #654 B-654-6): Stripe needs nothing from the client (the
   * first invoice was settled without a sheet, or its payment is already
   * processing). No sheet opens; the plan is confirmed by polling. The
   * secrets are '' then.
   */
  mode: "payment" | "setup" | "none";
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
  shareToken?: string | null,
  expectedOneTimeCents?: number | null,
): Promise<SubscriptionIntent> {
  const body: SubscriptionIntentRequest = {
    package_id: packageId,
    idempotency_key: idempotencyKey,
  };
  if (typeof expectedAmountCents === "number")
    body.expected_amount_cents = expectedAmountCents;
  if (
    typeof expectedOneTimeCents === "number" &&
    Number.isInteger(expectedOneTimeCents) &&
    expectedOneTimeCents >= 0
  )
    body.expected_one_time_cents = expectedOneTimeCents;
  if (typeof shareToken === "string" && SHARE_TOKEN_SHAPE.test(shareToken))
    body.share_token = shareToken;
  const res = await api.post<Record<string, unknown>>(
    SUBSCRIPTION_INTENT_PATH,
    body,
  );
  const d = res?.data ?? {};
  const mode =
    d.mode === "setup"
      ? "setup"
      : d.mode === "payment"
        ? "payment"
        : d.mode === "none"
          ? "none"
          : null;
  if (mode === "none") {
    // Nothing for the sheet: only the purchase id is needed to confirm.
    if (!nonEmpty(d.purchase_id))
      throw new PaymentIntentShapeError("subscription_intent");
    return {
      mode,
      clientSecret: "",
      ephemeralKey: "",
      customerId: nonEmpty(d.customer_id) ? d.customer_id : "",
      publishableKey: "",
      purchaseId: d.purchase_id,
      plan: intentPlanOf(d.plan),
    };
  }
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
  return {
    mode,
    clientSecret: d.client_secret,
    ephemeralKey: d.ephemeral_key,
    customerId: d.customer_id,
    publishableKey: nonEmpty(d.publishable_key) ? d.publishable_key : "",
    purchaseId: d.purchase_id,
    plan: intentPlanOf(d.plan),
  };
}

function intentPlanOf(raw: unknown): SubscriptionIntent["plan"] {
  const p = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  const interval =
    p.interval === "week" || p.interval === "month" || p.interval === "year"
      ? p.interval
      : null;
  return {
    amountCents: numOrNull(p.amount_cents),
    currency: typeof p.currency === "string" ? p.currency : null,
    interval,
    intervalCount: numOrNull(p.interval_count),
    firstChargeCents: numOrNull(p.first_charge_cents),
    oneTimeCents: numOrNull(p.one_time_cents),
    trialDays: numOrNull(p.trial_days),
    trialEndsAt: typeof p.trial_ends_at === "string" ? p.trial_ends_at : null,
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

/**
 * Backend #654 (B-334-3): what Stripe shows for a plan still confirming,
 * on GET /v1/checkout/subscriptions/:id only. awaiting_payment /
 * awaiting_card are the only proof that nothing was charged.
 */
export type CheckoutState =
  | "awaiting_payment"
  | "awaiting_card"
  | "processing"
  | "paid"
  | "card_saved"
  | "ended"
  | "unknown";

const CHECKOUT_STATES: ReadonlySet<string> = new Set([
  "awaiting_payment",
  "awaiting_card",
  "processing",
  "paid",
  "card_saved",
  "ended",
  "unknown",
]);

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
  /** null when the backend did not report it (list route, entitled plan). */
  checkoutState: CheckoutState | null;
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
    checkoutState:
      typeof r.checkout_state === "string" &&
      CHECKOUT_STATES.has(r.checkout_state)
        ? (r.checkout_state as CheckoutState)
        : null,
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
  // B-342-1 (Sol): no answer at all (offline, timeout, dropped). The request
  // may have reached the server, and a replay may follow an unclear card
  // step, so this never claims that nothing was charged. The key is kept.
  noAnswer: (ref: string | null) =>
    `The app could not reach the server, so this step is not confirmed. Check your connection, then open your plan in Membership to see where it stands before you start again. If it is still unclear, email support${ref ? ` and quote reference ${ref}` : ""}.`,
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
  // B-334-3: the card form ended without a clear answer. Said only after
  // Stripe itself shows no payment (awaiting_payment / awaiting_card).
  sheetNotFinished:
    "The payment form closed before the payment finished. Stripe shows no payment for this plan, so nothing was charged. Start again when you are ready.",
  sheetNotFinishedTrial:
    "The card form closed before your card was saved, so the trial has not started and nothing was charged. Start again when you are ready.",
  // B-334-3: the outcome is not known yet. Never claims that nothing was charged.
  outcomeUnknown: (ref: string | null) =>
    `The payment form closed before it could confirm the result, so it is not yet clear whether this payment went through. Choose Check again in a moment. If it is still unclear, email support${ref ? ` and quote reference ${ref}` : ""}.`,
  checkoutEnded:
    "This checkout closed before the payment finished, so nothing was charged. Choose the plan again to start a new checkout.",
  endedWhileConfirming: (ref: string | null) =>
    `This plan closed before it was confirmed. If your card statement shows a charge for it, email support${ref ? ` and quote reference ${ref}` : ""}, and the team will put it right.`,
  // B-334-4: the backend's terms differ from what the client was shown.
  termsReviewTrialRemoved:
    "This plan no longer includes a free trial for you, so it starts with a charge today. Nothing was charged yet. Review the current terms, then confirm to continue.",
  termsReview:
    "The terms of this plan changed since it was shown. Nothing was charged yet. Review the current terms, then confirm to continue.",
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
  // One-time payment-intent only: there PAYMENT_RETRY means the first request
  // failed before the card form ever got its secret (proven no charge).
  retrySameAttempt:
    "The last attempt did not finish and nothing was charged. Start again to continue where it stopped. You will not be charged twice.",
  // B-342-1: the backend has not confirmed the result (recurring PAYMENT_RETRY,
  // STRIPE_CHECKOUT_ERROR, SUBSCRIPTION_SETUP_UNAVAILABLE). Never a no-charge claim.
  notConfirmed: (ref: string | null) =>
    `The last attempt to start this plan did not finish, and its result is not confirmed yet. Open your plan in Membership to check whether it started before you start again. If it is still unclear, email support${ref ? ` and quote reference ${ref}` : ""}.`,
  // B-342-2: backend #661 answers for a one-time key whose payment finished.
  alreadyComplete:
    "This payment already went through, so nothing more was charged. Open your plan to use it.",
  refundedOrInReview: (ref: string | null) =>
    `This payment was refunded or is under review, so it cannot be paid again from here. Open your plan in Membership to see its status, or email support${ref ? ` and quote reference ${ref}` : ""}.`,
  checkoutClosed:
    "This checkout has closed, so it can no longer be paid. Choose the plan again to start a new checkout.",
  keyOtherPlan:
    "That checkout was opened for a different plan, so it was not used for this one. Choose the plan again to start a new checkout.",
  planChangeUnconfirmed:
    "The change to this plan was sent, but the payment service has not confirmed it yet. Pull down in a minute to refresh your plans, and choose the change again if your plan still shows the old state.",
  // The backend in use has no renewing-plan checkout yet (route not found).
  renewingUnavailable:
    "This plan renews automatically, and renewing plans cannot be started from the app yet, so this plan did not start and nothing was charged. Message your coach to arrange it.",
  // B-343-4: the trial already started when this checkout first opened.
  termsReviewTrialDate:
    "The free trial on this plan started when this checkout first opened, so the first charge date differs from the one shown. Nothing was charged yet. Review the date, then confirm to continue.",
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
  alreadyIncluded: (by: "invite" | "free_claim" | "purchase" | null) =>
    by === "invite"
      ? "Your coach already added this plan to your account with your invite, so nothing was charged. Open your plan to use it."
      : by === "free_claim"
        ? "You already added this free plan to your account, so nothing was charged. Open your plan to use it."
        : by === "purchase"
          ? "You already paid for this plan and it is still active, so nothing more was charged. Open your plan to use it."
          : "This plan is already on your account, so nothing was charged. Open your plan to use it.",
  attemptExpired:
    "That checkout ended before it finished, so nothing was charged. Choose the plan again to start a new checkout.",
  attemptExpiredTermsChanged:
    "The terms of this plan changed after that checkout started, so it was closed and nothing was charged. Choose the plan again to see the current terms.",
  packageCoachNotConnectedNoCoach:
    "This plan is from a coach you are not connected with yet, so it cannot be started from this account and nothing was charged. Ask that coach for their invite code, join with it, then open the link again.",
  packageCoachNotConnectedOtherCoach:
    "This plan is from a different coach than yours, so it cannot be started from this account and nothing was charged. Message the coach who shared the link.",
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
  stripeUnavailable: (ref: string | null) =>
    `The payment service did not answer, so nothing was charged. Wait a minute, then start again. If it keeps happening, email support${ref ? ` and quote reference ${ref}` : ""}.`,
  paymentsOff: (ref: string | null) =>
    `Card payments are not switched on for this app yet, so nothing was charged. Email support${ref ? ` and quote reference ${ref}` : ""}.`,
  // B-342-1: an unmapped answer proves nothing about money: no charge claim.
  unknown: (ref: string | null) =>
    `This step did not finish, and its result is not confirmed yet. Open your plan in Membership to see where it stands before you start again. If it is still unclear, email support${ref ? ` and quote reference ${ref}` : ""}.`,
  planPaymentFailed:
    "Your card was not charged for this plan. Start again with a different card, or ask your bank about the payment.",
  // Progress and success
  starting: "Preparing a secure payment form.",
  confirmingPlan: "Confirming your plan.",
  confirming: "Payment received. Setting up your plan.",
  // B-343-1 (Opus): the card step ended without a clear answer; still reading.
  checkingPayment: "Checking whether the payment went through.",
  confirmingFree: "Adding your free plan.",
  confirmSlow:
    "Your card was accepted. Stripe is still confirming your plan, which usually takes under a minute. You can carry on; your plan appears in Membership as soon as it is confirmed.",
  confirmSlowNoSheet:
    "Stripe is still confirming your plan, which usually takes under a minute. You can carry on; your plan appears in Membership as soon as it is confirmed.",
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
  /** B-334-3: offer Check again (the outcome of the card step is unknown). */
  checkAgain?: boolean;
  /** Offer "Open your plan" (Membership shows where the plan stands). */
  openPlan?: boolean;
  /** The attempt behind this key is finished: the next tap starts a new one. */
  retireKey?: boolean;
  /** The backend proved this payment completed: refresh the entitlement. */
  completed?: boolean;
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
    captureError(
      new Error(
        `package payment failed: ${machineLabel(notice.cause) ?? "unrecognized"}`,
      ),
      {
        where: "packagePurchase",
        step,
        cause: machineLabel(notice.cause) ?? "unrecognized",
        status: extra.status ?? null,
        code: machineCode(extra.code),
        reference: notice.reference,
        stripe_error_code: machineLabel(extra.stripe?.code),
        stripe_decline_code: machineLabel(extra.stripe?.declineCode),
        stripe_error_type: machineLabel(extra.stripe?.type),
      },
    );
  } catch {
    // Reporting can never break the payment flow.
  }
}

/**
 * C-342-1 (Sol): only bounded machine labels reach Sentry. A backend code is
 * UPPER_SNAKE; a Stripe native label is a short identifier. Anything else
 * (free text, an address, a sentence) is dropped.
 */
const MACHINE_CODE = /^[A-Z][A-Z0-9_]{1,63}$/;
const MACHINE_LABEL = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
export function machineCode(v: unknown): string | null {
  return typeof v === "string" && MACHINE_CODE.test(v) ? v : null;
}
function machineLabel(v: unknown): string | null {
  return typeof v === "string" && MACHINE_LABEL.test(v) ? v : null;
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
    const n: PackagePaymentNotice = {
      ...supportNotice(
        "response_shape",
        attemptRef,
        PACKAGE_PAYMENT_COPY.unknown(attemptRef),
      ),
      openPlan: true,
    };
    reportPackagePaymentFailure(step, n, { status: 200, code: err.message });
    return n;
  }
  const status = errorStatus(err) ?? null;
  const code = backendCodeOf(err);
  const ref = shortReference(supportReferenceOf(err)) ?? attemptRef;
  if (status === null) {
    return {
      ...supportNotice("no_answer", ref, PACKAGE_PAYMENT_COPY.noAnswer(ref)),
      openPlan: true,
    };
  }

  // Today's production backend has no renewing-plan checkout: the route
  // itself is missing (a bare 404, no machine code), so nothing ran.
  if (
    status === 404 &&
    step === "subscription_intent" &&
    (code === null || code === "Not Found")
  ) {
    const n = notice(
      "renewing_unavailable",
      PACKAGE_PAYMENT_COPY.renewingUnavailable,
    );
    reportPackagePaymentFailure(step, n, { status });
    return n;
  }
  /** B-342-1: the backend has not confirmed the result; the key is kept. */
  const notConfirmed = (): PackagePaymentNotice => {
    const n: PackagePaymentNotice = {
      ...supportNotice(
        "not_confirmed",
        ref,
        PACKAGE_PAYMENT_COPY.notConfirmed(ref),
      ),
      openPlan: true,
    };
    reportPackagePaymentFailure(step, n, { status, code });
    return n;
  };

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
      return step === "subscription_intent"
        ? notConfirmed()
        : notice("retry_same_attempt", PACKAGE_PAYMENT_COPY.retrySameAttempt);
    // B-342-2: backend #661 replay answers for a finished one-time key.
    case "PAYMENT_ALREADY_COMPLETE":
      return {
        ...notice("already_complete", PACKAGE_PAYMENT_COPY.alreadyComplete),
        openPlan: true,
        completed: true,
        retireKey: true,
      };
    case "PAYMENT_REFUNDED_OR_IN_REVIEW":
      return {
        ...supportNotice(
          "refunded_or_in_review",
          ref,
          PACKAGE_PAYMENT_COPY.refundedOrInReview(ref),
        ),
        openPlan: true,
      };
    case "PAYMENT_CHECKOUT_CLOSED":
      return {
        ...notice("checkout_closed", PACKAGE_PAYMENT_COPY.checkoutClosed),
        retireKey: true,
      };
    case "CHECKOUT_KEY_OTHER_PLAN":
      return {
        ...notice("key_other_plan", PACKAGE_PAYMENT_COPY.keyOtherPlan),
        retireKey: true,
      };
    case "PLAN_CHANGE_UNCONFIRMED":
      return notice(
        "plan_change_unconfirmed",
        PACKAGE_PAYMENT_COPY.planChangeUnconfirmed,
        true,
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
    case "PACKAGE_ALREADY_INCLUDED": {
      const by = backendFieldOf(err, "included_by");
      return notice(
        "already_included",
        PACKAGE_PAYMENT_COPY.alreadyIncluded(
          by === "invite" || by === "free_claim" || by === "purchase"
            ? by
            : null,
        ),
      );
    }
    case "SUBSCRIPTION_ATTEMPT_EXPIRED":
      return {
        ...(backendFieldOf(err, "reason") === "terms_changed"
          ? notice(
              "attempt_expired_terms_changed",
              PACKAGE_PAYMENT_COPY.attemptExpiredTermsChanged,
              true,
            )
          : notice("attempt_expired", PACKAGE_PAYMENT_COPY.attemptExpired)),
        retireKey: true,
      };
    case "PACKAGE_COACH_NOT_CONNECTED":
      return notice(
        "package_coach_not_connected",
        backendFieldOf(err, "reason") === "no_coach"
          ? PACKAGE_PAYMENT_COPY.packageCoachNotConnectedNoCoach
          : PACKAGE_PAYMENT_COPY.packageCoachNotConnectedOtherCoach,
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
    // B-342-1: on subscription-intent these two codes do not prove no charge.
    case "SUBSCRIPTION_SETUP_UNAVAILABLE":
      return notConfirmed();
    case "STRIPE_CHECKOUT_ERROR": {
      if (step === "subscription_intent") return notConfirmed();
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
      // B-342-1: an unmapped answer proves nothing: neutral copy, key kept.
      const known = machineCode(code);
      const n: PackagePaymentNotice = {
        ...supportNotice(
          known ? `backend_${known.toLowerCase()}` : `http_${status}`,
          ref,
          PACKAGE_PAYMENT_COPY.unknown(ref),
        ),
        openPlan: true,
      };
      reportPackagePaymentFailure(step, n, { status, code: known });
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

/**
 * B-334-3: is this presentPaymentSheet error a definite answer (a decline,
 * an authentication failure, wrong card details: the card was not charged)
 * or an unknown outcome (timeout, dropped connection, a failure without any
 * card detail)? An unknown outcome is never reported as "nothing was
 * charged": the plan is read from the backend first.
 */
export function isUncertainSheetResult(error: StripeSdkError): boolean {
  if (isSheetCanceled(error)) return false;
  const decline = error.declineCode ?? "";
  const stripeCode = error.stripeErrorCode ?? "";
  if (error.code === "Timeout") return true;
  if (error.type === "api_connection_error") return true;
  if (AUTH_FAILED.has(stripeCode) || AUTH_FAILED.has(decline)) return false;
  if (
    decline ||
    stripeCode === "card_declined" ||
    error.type === "card_error" ||
    DECLINE_INSUFFICIENT.has(stripeCode) ||
    DECLINE_EXPIRED.has(stripeCode) ||
    DECLINE_DETAILS.has(stripeCode)
  )
    return false;
  return true;
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
  const n: PackagePaymentNotice = {
    ...supportNotice(
      `stripe_${step}`,
      attemptRef,
      PACKAGE_PAYMENT_COPY.unknown(attemptRef),
    ),
    openPlan: true,
  };
  reportPackagePaymentFailure(step, n, { stripe: error });
  return n;
}

/** The SDK threw instead of answering (rare); always a support case. */
export function describeSheetCrash(
  step: "sheet_init" | "sheet_present",
  attemptRef: string | null,
): PackagePaymentNotice {
  const n: PackagePaymentNotice = {
    ...supportNotice(
      `stripe_${step}_threw`,
      attemptRef,
      PACKAGE_PAYMENT_COPY.unknown(attemptRef),
    ),
    openPlan: true,
  };
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
