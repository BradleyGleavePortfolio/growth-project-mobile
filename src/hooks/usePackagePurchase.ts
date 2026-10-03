/**
 * usePackagePurchase — the ONE purchase flow behind every surface that sells
 * a coach package (Day 1 / package_prompt sheet, Membership plans, share
 * links). Owner 16:04: renewing plans are sold as real subscriptions,
 * never as a one-time charge and never refused.
 *
 *   one-time package  -> POST /v1/checkout/payment-intent  -> PaymentSheet (payment)
 *                        -> bounded wait for the entitlement -> success
 *   renewing package  -> POST /v1/checkout/subscription-intent
 *                        -> PaymentSheet in payment mode (or setup mode for a trial)
 *                        -> "Confirming your plan": bounded polling of
 *                           GET /v1/checkout/subscriptions/:id until entitled
 *                        -> success moment (or a calm "still confirming" state)
 *   $0 package        -> POST /v1/packages/:id/claim-free (never Stripe)
 *
 * Idempotency: one key per purchase attempt (package + sale kind), reused on
 * every retry, cancel, decline and price confirmation, so the backend hands
 * back the same PaymentIntent / Subscription and nobody is charged twice. A
 * synchronous in-flight guard drops double taps before any request.
 *
 * Secrets (client secret, ephemeral key) live only in local variables of one
 * attempt: never in React state, storage, logs, Sentry or analytics.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { resolveStripePublishableKey } from "../config/stripe";
import { resolveWalletConfig } from "../config/wallets";
import { clientPaymentsApi } from "../api/clientPaymentsApi";
import { generateIdempotencyKey } from "../utils/idempotency";
import { shortReference } from "../utils/correlation";
import {
  PACKAGE_PAYMENT_COPY,
  STRIPE_RETURN_URL,
  STRIPE_URL_SCHEME,
  backendCodeOf,
  backendFieldOf,
  claimFreePackage,
  createPackagePaymentIntent,
  createSubscriptionIntent,
  describeBackendFailure,
  describeMissingPublishableKey,
  describePlanPaymentFailed,
  describeSdkMissing,
  describeSheetCrash,
  describeSheetFailure,
  fetchClientPackage,
  getClientPlan,
  isSheetCanceled,
  isUncertainSheetResult,
  listClientPlans,
  loadPackageStripeSdk,
  reportPackagePaymentFailure,
  type ClientPlan,
  type PackagePaymentNotice,
  type PaymentSheetSecrets,
  type StripeSdkError,
} from "../lib/packagePayment";
import {
  formatPlanDate,
  money,
  planTerms,
  purchasableFromCoachPackage,
  reconcileIntentTerms,
  saleKindOf,
  trialFirstChargeDate,
  type PurchasablePackage,
  type SaleKind,
} from "../lib/planTerms";

export type PurchasePhase =
  | "idle"
  | "starting"
  | "paying"
  | "confirming"
  | "confirm_slow"
  | "confirmed_pending"
  | "success";

export interface PurchaseSuccess {
  kind: "subscription" | "trial" | "one_time" | "free";
  title: string;
  body: string;
}

export interface PriceChange {
  pkg: PurchasablePackage;
  oldCents: number;
  newCents: number;
  /**
   * B-334-4: the review copy when more than the renewal price moved (trial,
   * one-time part, currency, cadence). Absent: the price-change copy.
   */
  message?: string;
  /** The confirm button label for a terms review. */
  confirmLabel?: string;
}

export interface PurchaseState {
  phase: PurchasePhase;
  packageId: string | null;
  /** How the current attempt is sold (drives the progress copy). */
  saleKind: SaleKind | null;
  notice: PackagePaymentNotice | null;
  priceChange: PriceChange | null;
  alreadyActive: { purchaseId: string | null } | null;
  success: PurchaseSuccess | null;
  /** The calm slow-state copy (no sheet ran: never "Your card was accepted"). */
  slowMessage: string | null;
}

export type PurchaseSurface = "sheet" | "plans" | "share_link";

export interface UsePackagePurchaseOptions {
  surface: PurchaseSurface;
  /** TGP-themed PaymentSheet appearance (OR-110-2). */
  appearance: Record<string, unknown>;
  colorScheme: "light" | "dark" | null | undefined;
  /** Waits between GET /subscriptions/:id polls. About 30 s by default. */
  planPollDelaysMs?: number[];
  /** Waits between entitlement checks after a one-time payment. About 10 s. */
  entitlementPollDelaysMs?: number[];
  /** "Check again" from the calm slow state. */
  recheckDelaysMs?: number[];
  /** Called once the plan is entitled (refresh the entitlement cache). */
  onEntitled?: () => void;
  /** The surface's package list may be stale (price or terms moved). */
  onReloadNeeded?: () => void;
  /**
   * Share links only: the link's token, sent with subscription-intent so a
   * refusal for a coach the client is not connected with is explained
   * (PACKAGE_COACH_NOT_CONNECTED). Never sent to payment-intent.
   */
  shareToken?: string | null;
  now?: () => Date;
}

export const PLAN_POLL_DELAYS_MS = [
  0, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 5000, 6000,
];
export const ENTITLEMENT_POLL_DELAYS_MS = [0, 1500, 2500, 3000, 3000];
export const RECHECK_DELAYS_MS = [0, 2000, 4000];
const MERCHANT_DISPLAY_NAME = "The Growth Project";

const IDLE: PurchaseState = {
  phase: "idle",
  packageId: null,
  saleKind: null,
  notice: null,
  priceChange: null,
  alreadyActive: null,
  success: null,
  slowMessage: null,
};

type SheetOutcome =
  | { kind: "done" }
  | { kind: "canceled" }
  | { kind: "notice"; notice: PackagePaymentNotice }
  // B-334-3: the sheet was presented but ended without a clear answer (the
  // native call threw, timed out, lost the connection, or failed without
  // any card detail). The payment may have committed: read before telling.
  | { kind: "uncertain"; cause: string; stripe: StripeSdkError | null };

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

function infoNotice(cause: string, message: string): PackagePaymentNotice {
  return { cause, message, support: false, reference: null, tone: "info" };
}

function dateCopy(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : formatPlanDate(d);
}

/** B-334-4: the price-change / terms-review state for an adopted package. */
function priceChangeFor(
  pkg: PurchasablePackage,
  adopted: PurchasablePackage,
  trialRemoved = pkg.trialDays > 0 && adopted.trialDays === 0,
): PriceChange {
  const onlyPrice =
    adopted.amountCents !== pkg.amountCents &&
    adopted.oneTimeCents === pkg.oneTimeCents &&
    adopted.currency === pkg.currency &&
    adopted.interval === pkg.interval &&
    adopted.intervalCount === pkg.intervalCount &&
    adopted.trialDays === pkg.trialDays;
  if (onlyPrice) {
    return {
      pkg: adopted,
      oldCents: pkg.amountCents,
      newCents: adopted.amountCents,
    };
  }
  return {
    pkg: adopted,
    oldCents: pkg.amountCents,
    newCents: adopted.amountCents,
    message: trialRemoved
      ? PACKAGE_PAYMENT_COPY.termsReviewTrialRemoved
      : PACKAGE_PAYMENT_COPY.termsReview,
    confirmLabel: planTerms(adopted).cta,
  };
}

export function usePackagePurchase(opts: UsePackagePurchaseOptions) {
  const {
    surface,
    appearance,
    colorScheme,
    planPollDelaysMs = PLAN_POLL_DELAYS_MS,
    entitlementPollDelaysMs = ENTITLEMENT_POLL_DELAYS_MS,
    recheckDelaysMs = RECHECK_DELAYS_MS,
  } = opts;
  const [state, setState] = useState<PurchaseState>(IDLE);

  // Latest callbacks without re-creating the flow on every render.
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /** One key per attempt: same package + same sale kind reuses it. */
  const attemptRef = useRef<{
    packageId: string;
    kind: SaleKind;
    key: string;
  } | null>(null);
  const inFlightRef = useRef(false);
  /** The plan being confirmed (for Check again). Ids only, never secrets. */
  const confirmingRef = useRef<{
    purchaseId: string;
    pkg: PurchasablePackage;
    trial: boolean;
    /** B-334-3: the card step ended without a clear answer. */
    uncertain: boolean;
    /** Short reference of the attempt (support), never a secret. */
    ref: string | null;
    /** No sheet ran (backend mode 'none'). */
    noSheet?: boolean;
  } | null>(null);
  /** B-334-3: a one-time payment whose card step ended without a clear answer. */
  const oneTimeUnknownRef = useRef<{
    pkg: PurchasablePackage;
    ref: string | null;
  } | null>(null);

  const set = useCallback((patch: Partial<PurchaseState>) => {
    if (mountedRef.current) setState((s) => ({ ...s, ...patch }));
  }, []);

  const attemptKeyFor = useCallback((pkg: PurchasablePackage): string => {
    const kind = saleKindOf(pkg);
    const cur = attemptRef.current;
    if (cur && cur.packageId === pkg.id && cur.kind === kind) return cur.key;
    const next = { packageId: pkg.id, kind, key: generateIdempotencyKey() };
    attemptRef.current = next;
    return next.key;
  }, []);

  const finishSuccess = useCallback(
    (success: PurchaseSuccess) => {
      attemptRef.current = null;
      confirmingRef.current = null;
      oneTimeUnknownRef.current = null;
      try {
        optsRef.current.onEntitled?.();
      } catch {
        // a cache refresh can never break the success moment
      }
      set({
        phase: "success",
        success,
        notice: null,
        priceChange: null,
        alreadyActive: null,
      });
    },
    [set],
  );

  const showNotice = useCallback(
    (n: PackagePaymentNotice) => {
      set({ phase: "idle", notice: n });
      if (n.reload) {
        try {
          optsRef.current.onReloadNeeded?.();
        } catch {
          // best effort
        }
      }
    },
    [set],
  );

  // ── PaymentSheet ──────────────────────────────────────────────────────────
  const runSheet = useCallback(
    async (
      secrets: PaymentSheetSecrets,
      mode: "payment" | "setup",
      pkg: PurchasablePackage,
      ref: string | null,
    ): Promise<SheetOutcome> => {
      const sdk = loadPackageStripeSdk();
      if (!sdk) return { kind: "notice", notice: describeSdkMissing() };
      // The backend key always matches the secret key that minted the
      // intent (same mode, same account); the build key is the fallback.
      const publishableKey =
        secrets.publishableKey || resolveStripePublishableKey();
      if (!publishableKey)
        return { kind: "notice", notice: describeMissingPublishableKey(ref) };
      const wallet = resolveWalletConfig({
        currency: pkg.currency,
        publishableKey,
      });

      let init: { error?: StripeSdkError } | undefined;
      try {
        await sdk.initStripe({
          publishableKey,
          ...(wallet.merchantIdentifier
            ? { merchantIdentifier: wallet.merchantIdentifier }
            : {}),
          urlScheme: STRIPE_URL_SCHEME,
          setReturnUrlSchemeOnAndroid: true,
        });
        init = await sdk.initPaymentSheet({
          merchantDisplayName: MERCHANT_DISPLAY_NAME,
          customerId: secrets.customerId,
          customerEphemeralKeySecret: secrets.ephemeralKey,
          ...(mode === "setup"
            ? {
                setupIntentClientSecret: secrets.clientSecret,
                primaryButtonLabel: "Start free trial",
              }
            : { paymentIntentClientSecret: secrets.clientSecret }),
          returnURL: STRIPE_RETURN_URL,
          allowsDelayedPaymentMethods: false,
          style: colorScheme === "dark" ? "alwaysDark" : "alwaysLight",
          appearance,
          ...(wallet.applePay ? { applePay: wallet.applePay } : {}),
          ...(wallet.googlePay ? { googlePay: wallet.googlePay } : {}),
        });
      } catch {
        return {
          kind: "notice",
          notice: describeSheetCrash("sheet_init", ref),
        };
      }
      if (init?.error) {
        return {
          kind: "notice",
          notice: describeSheetFailure(init.error, "sheet_init", ref, mode),
        };
      }
      let presented: { error?: StripeSdkError } | undefined;
      try {
        presented = await sdk.presentPaymentSheet();
      } catch {
        // The native call threw after the sheet was shown: the payment may
        // have committed (B-334-3).
        return {
          kind: "uncertain",
          cause: "sheet_present_threw",
          stripe: null,
        };
      }
      if (presented?.error) {
        if (isSheetCanceled(presented.error)) return { kind: "canceled" };
        if (isUncertainSheetResult(presented.error)) {
          return {
            kind: "uncertain",
            cause:
              presented.error.code === "Timeout"
                ? "sheet_present_timeout"
                : presented.error.type === "api_connection_error"
                  ? "sheet_present_connection"
                  : "sheet_present_unknown",
            stripe: presented.error,
          };
        }
        return {
          kind: "notice",
          notice: describeSheetFailure(
            presented.error,
            "sheet_present",
            ref,
            mode,
          ),
        };
      }
      return { kind: "done" };
    },
    [appearance, colorScheme],
  );

  // ── Confirming a subscription ─────────────────────────────────────────────
  const successForPlan = useCallback(
    (
      plan: ClientPlan,
      pkg: PurchasablePackage,
      trial: boolean,
    ): PurchaseSuccess => {
      const amount = money(
        plan.amountCents || pkg.amountCents,
        plan.currency || pkg.currency,
      );
      if (trial || plan.state === "trialing") {
        const date =
          dateCopy(plan.trialEndsAt) ??
          formatPlanDate(
            trialFirstChargeDate(
              pkg.trialDays,
              (optsRef.current.now ?? (() => new Date()))(),
            ),
          );
        return {
          kind: "trial",
          title: PACKAGE_PAYMENT_COPY.successTrialTitle,
          body: PACKAGE_PAYMENT_COPY.successBody(
            plan.packageName || pkg.name,
            PACKAGE_PAYMENT_COPY.firstChargeOn(amount, date),
          ),
        };
      }
      const next = dateCopy(plan.nextChargeAt);
      return {
        kind: "subscription",
        title: PACKAGE_PAYMENT_COPY.successTitle,
        body: PACKAGE_PAYMENT_COPY.successBody(
          plan.packageName || pkg.name,
          next ? PACKAGE_PAYMENT_COPY.nextChargeOn(amount, next) : null,
        ),
      };
    },
    [],
  );

  /** true = finished (success or notice); false = still confirming after the delays. */
  const pollPlan = useCallback(
    async (delays: number[]): Promise<boolean> => {
      const c = confirmingRef.current;
      if (!c) return true;
      for (const delay of delays) {
        if (delay > 0) await wait(delay);
        if (!mountedRef.current) return true;
        let plan: ClientPlan | null = null;
        try {
          plan = await getClientPlan(c.purchaseId);
        } catch {
          // Stripe or the network is slow; the card step already finished.
          continue;
        }
        // C-334-3: unmounted or superseded while the read was in flight.
        if (!mountedRef.current || confirmingRef.current !== c) return true;
        if (!plan) continue;
        if (
          plan.entitlementActive &&
          (plan.state === "active" ||
            plan.state === "trialing" ||
            plan.state === "past_due")
        ) {
          finishSuccess(successForPlan(plan, c.pkg, c.trial));
          return true;
        }
        if (plan.state === "payment_failed") {
          confirmingRef.current = null;
          showNotice(describePlanPaymentFailed());
          return true;
        }
        if (plan.state === "ended") {
          confirmingRef.current = null;
          const ref = shortReference(c.purchaseId);
          const n: PackagePaymentNotice = {
            cause: "plan_ended_while_confirming",
            message: PACKAGE_PAYMENT_COPY.endedWhileConfirming(ref),
            support: true,
            reference: ref,
          };
          reportPackagePaymentFailure("plan_poll", n);
          showNotice(n);
          return true;
        }
      }
      return false;
    },
    [finishSuccess, showNotice, successForPlan],
  );

  /** The calm slow state, with copy that matches what actually happened. */
  const showSlow = useCallback(() => {
    const c = confirmingRef.current;
    try {
      optsRef.current.onEntitled?.();
    } catch {
      // best effort
    }
    set({
      phase: "confirm_slow",
      slowMessage: c?.noSheet ? PACKAGE_PAYMENT_COPY.confirmSlowNoSheet : null,
    });
  }, [set]);

  /** B-334-3: the outcome is not known; never claims that nothing was charged. */
  const showOutcomeUnknown = useCallback(
    (cause: string, ref: string | null, stripe: StripeSdkError | null) => {
      const n: PackagePaymentNotice = {
        cause,
        message: PACKAGE_PAYMENT_COPY.outcomeUnknown(ref),
        support: true,
        reference: ref,
        checkAgain: true,
      };
      reportPackagePaymentFailure("sheet_present", n, { stripe });
      set({ phase: "idle", notice: n });
    },
    [set],
  );

  /**
   * B-334-3: the card sheet of a subscription ended without a clear answer.
   * Read the plan (bounded) and tell only what the backend and Stripe show:
   * entitled -> success; paid / processing / card saved -> keep confirming;
   * awaiting payment / card -> nothing was charged (the same key replays the
   * same attempt); anything else -> outcome unknown, Check again.
   */
  const settleUncertain = useCallback(
    async (stripe: StripeSdkError | null, cause: string): Promise<void> => {
      const c = confirmingRef.current;
      if (!c) return;
      set({ phase: "confirming", notice: null });
      for (const delay of recheckDelaysMs) {
        if (delay > 0) await wait(delay);
        if (!mountedRef.current) return;
        if (confirmingRef.current !== c) return;
        let plan: ClientPlan | null = null;
        try {
          plan = await getClientPlan(c.purchaseId);
        } catch {
          continue;
        }
        if (!mountedRef.current || confirmingRef.current !== c) return;
        if (!plan) continue;
        if (
          plan.entitlementActive &&
          (plan.state === "active" ||
            plan.state === "trialing" ||
            plan.state === "past_due")
        ) {
          finishSuccess(successForPlan(plan, c.pkg, c.trial));
          return;
        }
        if (plan.state === "payment_failed") {
          confirmingRef.current = null;
          showNotice(describePlanPaymentFailed());
          return;
        }
        if (plan.state === "ended" || plan.checkoutState === "ended") {
          confirmingRef.current = null;
          attemptRef.current = null;
          showNotice({
            cause: "checkout_ended",
            message: PACKAGE_PAYMENT_COPY.checkoutEnded,
            support: false,
            reference: null,
          });
          return;
        }
        if (
          plan.checkoutState === "paid" ||
          plan.checkoutState === "processing" ||
          plan.checkoutState === "card_saved"
        ) {
          // The card step did finish: the webhook is on its way.
          attemptRef.current = null;
          confirmingRef.current = { ...c, uncertain: false };
          const finished = await pollPlan(planPollDelaysMs);
          if (!finished && mountedRef.current) showSlow();
          return;
        }
        if (
          plan.checkoutState === "awaiting_payment" ||
          plan.checkoutState === "awaiting_card"
        ) {
          // Stripe shows no payment and no saved card: proven not charged.
          // attemptRef stays, so the next tap replays the same attempt.
          confirmingRef.current = null;
          showNotice({
            cause: "sheet_not_finished",
            message: c.trial
              ? PACKAGE_PAYMENT_COPY.sheetNotFinishedTrial
              : PACKAGE_PAYMENT_COPY.sheetNotFinished,
            support: false,
            reference: null,
          });
          return;
        }
      }
      if (!mountedRef.current || confirmingRef.current !== c) return;
      showOutcomeUnknown(cause, c.ref, stripe);
    },
    [
      finishSuccess,
      planPollDelaysMs,
      pollPlan,
      recheckDelaysMs,
      set,
      showNotice,
      showOutcomeUnknown,
      showSlow,
      successForPlan,
    ],
  );

  /**
   * B-334-3: a one-time card sheet ended without a clear answer. Read the
   * client's purchases (bounded): an entitled purchase of this package means
   * it went through; otherwise the outcome is unknown (Check again).
   */
  const settleOneTimeUnknown = useCallback(
    async (stripe: StripeSdkError | null, cause: string): Promise<void> => {
      const u = oneTimeUnknownRef.current;
      if (!u) return;
      set({ phase: "confirming", notice: null });
      for (const delay of entitlementPollDelaysMs) {
        if (delay > 0) await wait(delay);
        if (!mountedRef.current || oneTimeUnknownRef.current !== u) return;
        try {
          const res = await clientPaymentsApi.getPurchases();
          if (!mountedRef.current || oneTimeUnknownRef.current !== u) return;
          const paid =
            res.ok &&
            res.data.some(
              (p) =>
                p.package_id === u.pkg.id &&
                p.entitlement_active === true &&
                (p.status === "paid" || p.status === "active"),
            );
          if (paid) {
            finishSuccess({
              kind: "one_time",
              title: PACKAGE_PAYMENT_COPY.successTitle,
              body: PACKAGE_PAYMENT_COPY.successBody(u.pkg.name, null),
            });
            return;
          }
        } catch {
          // keep reading; the outcome stays unknown until proven
        }
      }
      if (!mountedRef.current || oneTimeUnknownRef.current !== u) return;
      showOutcomeUnknown(cause, u.ref, stripe);
    },
    [entitlementPollDelaysMs, finishSuccess, set, showOutcomeUnknown],
  );

  const waitForEntitlement = useCallback(async (): Promise<boolean> => {
    for (const delay of entitlementPollDelaysMs) {
      if (delay > 0) await wait(delay);
      if (!mountedRef.current) return false;
      try {
        const res = await clientPaymentsApi.getEntitlement();
        if (res.ok && res.data?.active === true) return true;
      } catch {
        // keep polling; the payment itself is already confirmed
      }
    }
    return false;
  }, [entitlementPollDelaysMs]);

  // ── The three sale kinds ──────────────────────────────────────────────────
  const claimFree = useCallback(
    async (pkg: PurchasablePackage) => {
      set({ phase: "confirming" });
      let active: boolean;
      try {
        active = await claimFreePackage(pkg.id);
      } catch (err) {
        showNotice(
          describeBackendFailure(err, "claim_free", null, { surface }),
        );
        return;
      }
      if (!active) {
        showNotice(
          infoNotice("free_pending", PACKAGE_PAYMENT_COPY.freePending),
        );
        return;
      }
      finishSuccess({
        kind: "free",
        title: PACKAGE_PAYMENT_COPY.successFreeTitle,
        body: PACKAGE_PAYMENT_COPY.successBody(pkg.name, null),
      });
    },
    [finishSuccess, set, showNotice, surface],
  );

  const buyOneTime = useCallback(
    async (pkg: PurchasablePackage) => {
      if (!loadPackageStripeSdk()) {
        showNotice(describeSdkMissing());
        return;
      }
      const key = attemptKeyFor(pkg);
      const ref = shortReference(key);
      let secrets: PaymentSheetSecrets;
      try {
        secrets = await createPackagePaymentIntent(pkg.id, key);
      } catch (err) {
        // The coach made the plan free since the list loaded.
        if (backendCodeOf(err) === "PACKAGE_IS_FREE") {
          await claimFree({ ...pkg, amountCents: 0 });
          return;
        }
        showNotice(
          describeBackendFailure(err, "payment_intent", ref, { surface }),
        );
        return;
      }
      set({ phase: "paying" });
      const outcome = await runSheet(secrets, "payment", pkg, ref);
      if (outcome.kind === "canceled") {
        set({ phase: "idle" });
        return;
      }
      if (outcome.kind === "notice") {
        showNotice(outcome.notice);
        return;
      }
      if (outcome.kind === "uncertain") {
        // Keep the key: a retry gets the same PaymentIntent, never a second one.
        oneTimeUnknownRef.current = { pkg, ref };
        await settleOneTimeUnknown(outcome.stripe, outcome.cause);
        return;
      }
      attemptRef.current = null;
      set({ phase: "confirming" });
      const active = await waitForEntitlement();
      if (!mountedRef.current) return;
      if (active) {
        finishSuccess({
          kind: "one_time",
          title: PACKAGE_PAYMENT_COPY.successTitle,
          body: PACKAGE_PAYMENT_COPY.successBody(pkg.name, null),
        });
      } else {
        try {
          optsRef.current.onEntitled?.();
        } catch {
          // best effort
        }
        set({ phase: "confirmed_pending" });
      }
    },
    [
      attemptKeyFor,
      claimFree,
      finishSuccess,
      runSheet,
      set,
      settleOneTimeUnknown,
      showNotice,
      surface,
      waitForEntitlement,
    ],
  );

  const resolvePriceChange = useCallback(
    async (
      pkg: PurchasablePackage,
      err: unknown,
    ): Promise<PriceChange | null> => {
      const fromBody = backendFieldOf(err, "amount_cents");
      if (
        typeof fromBody === "number" &&
        Number.isInteger(fromBody) &&
        fromBody > 0
      ) {
        // B-334-4: adopt every current term the backend sent, not only the
        // renewal price (one-time part, currency, cadence).
        const int = (field: string, min: number): number | null => {
          const v = backendFieldOf(err, field);
          return typeof v === "number" && Number.isInteger(v) && v >= min
            ? v
            : null;
        };
        const cur = backendFieldOf(err, "currency");
        const iv = backendFieldOf(err, "interval");
        const adopted: PurchasablePackage = {
          ...pkg,
          amountCents: fromBody,
          oneTimeCents: int("one_time_cents", 0) ?? pkg.oneTimeCents,
          currency:
            typeof cur === "string" && /^[a-z]{3}$/i.test(cur)
              ? cur.toLowerCase()
              : pkg.currency,
          interval:
            iv === "week" || iv === "month" || iv === "year"
              ? iv
              : pkg.interval,
          intervalCount: int("interval_count", 1) ?? pkg.intervalCount,
        };
        return priceChangeFor(pkg, adopted);
      }
      // The error envelope dropped the price: read the package again.
      try {
        const raw = await fetchClientPackage(pkg.id);
        const fresh = purchasableFromCoachPackage(raw);
        if (fresh && fresh.renewing && fresh.amountCents > 0) {
          // Zero trial days stay zero: a removed trial is never resurrected.
          return priceChangeFor(pkg, { ...pkg, ...fresh });
        }
      } catch {
        // fall through to the reload notice
      }
      return null;
    },
    [],
  );

  const resolveExistingPlan = useCallback(
    async (pkg: PurchasablePackage, err: unknown): Promise<string | null> => {
      const fromBody = backendFieldOf(err, "purchase_id");
      if (typeof fromBody === "string" && fromBody) return fromBody;
      try {
        const plans = await listClientPlans();
        const live = plans.find(
          (p) =>
            p.packageId === pkg.id &&
            (p.state === "active" ||
              p.state === "trialing" ||
              p.state === "past_due"),
        );
        return live?.purchaseId ?? null;
      } catch {
        return null;
      }
    },
    [],
  );

  const buySubscription = useCallback(
    async (pkg: PurchasablePackage) => {
      if (!loadPackageStripeSdk()) {
        showNotice(describeSdkMissing());
        return;
      }
      let key = attemptKeyFor(pkg);
      let ref = shortReference(key);
      const request = (k: string) =>
        createSubscriptionIntent(
          pkg.id,
          k,
          pkg.amountCents,
          optsRef.current.shareToken ?? null,
          pkg.oneTimeCents,
        );
      let intent;
      try {
        try {
          intent = await request(key);
        } catch (first) {
          // The attempt behind this key has ended on the server (expired or
          // retired): its key is dead. Start once more with a fresh key.
          if (backendCodeOf(first) !== "SUBSCRIPTION_ATTEMPT_EXPIRED")
            throw first;
          attemptRef.current = null;
          key = attemptKeyFor(pkg);
          ref = shortReference(key);
          intent = await request(key);
        }
      } catch (err) {
        const code = backendCodeOf(err);
        if (code === "SUBSCRIPTION_ATTEMPT_EXPIRED") {
          // Never resend a dead key: the next tap starts a new attempt.
          attemptRef.current = null;
        }
        // The coach made the plan free since the list loaded.
        if (code === "PACKAGE_IS_FREE") {
          attemptRef.current = null;
          await claimFree({ ...pkg, amountCents: 0 });
          return;
        }
        if (code === "PACKAGE_ALREADY_INCLUDED") {
          attemptRef.current = null;
          set({
            phase: "idle",
            alreadyActive: { purchaseId: null },
            notice: describeBackendFailure(err, "subscription_intent", ref, {
              surface,
            }),
          });
          return;
        }
        if (code === "PACKAGE_PRICE_CHANGED") {
          const change = await resolvePriceChange(pkg, err);
          if (change) {
            set({ phase: "idle", priceChange: change, notice: null });
            return;
          }
        }
        if (code === "SUBSCRIPTION_ALREADY_ACTIVE") {
          const purchaseId = await resolveExistingPlan(pkg, err);
          set({
            phase: "idle",
            alreadyActive: { purchaseId },
            notice: describeBackendFailure(err, "subscription_intent", ref, {
              surface,
            }),
          });
          return;
        }
        showNotice(
          describeBackendFailure(err, "subscription_intent", ref, { surface }),
        );
        return;
      }
      if (!mountedRef.current) return;
      // B-334-4: the terms the backend is about to charge must be the terms
      // the client saw. Any difference (trial no longer offered, today's
      // charge, one-time part, currency, cadence) is reviewed first; the
      // confirm replays the SAME key, so it is the same attempt.
      const reconciled = reconcileIntentTerms(pkg, intent.plan, intent.mode);
      if (reconciled.inconsistent) {
        const n: PackagePaymentNotice = {
          cause: "intent_terms_inconsistent",
          message: PACKAGE_PAYMENT_COPY.unknown(ref),
          support: true,
          reference: ref,
        };
        reportPackagePaymentFailure("subscription_intent", n, { status: 200 });
        showNotice(n);
        return;
      }
      if (reconciled.changed) {
        set({
          phase: "idle",
          notice: null,
          priceChange: priceChangeFor(
            pkg,
            reconciled.adopted,
            reconciled.trialRemoved,
          ),
        });
        return;
      }
      const confirming = {
        purchaseId: intent.purchaseId,
        pkg: reconciled.adopted,
        trial: intent.mode === "setup",
        uncertain: false,
        ref,
      };
      if (intent.mode === "none") {
        // B-654-6: Stripe needs nothing from the client; confirm the plan.
        attemptRef.current = null;
        confirmingRef.current = { ...confirming, noSheet: true };
        set({ phase: "confirming" });
        const settled = await pollPlan(planPollDelaysMs);
        if (!settled && mountedRef.current) showSlow();
        return;
      }
      set({ phase: "paying" });
      const outcome = await runSheet(intent, intent.mode, pkg, ref);
      if (outcome.kind === "canceled") {
        set({ phase: "idle" });
        return;
      }
      if (outcome.kind === "notice") {
        showNotice(outcome.notice);
        return;
      }
      if (outcome.kind === "uncertain") {
        // B-334-3: keep the purchase and the key; read before telling.
        confirmingRef.current = { ...confirming, uncertain: true };
        await settleUncertain(outcome.stripe, outcome.cause);
        return;
      }
      // The card step finished: this attempt's key is spent. A later tap on
      // the same plan gets SUBSCRIPTION_ALREADY_ACTIVE or the open attempt.
      attemptRef.current = null;
      confirmingRef.current = confirming;
      set({ phase: "confirming" });
      const finished = await pollPlan(planPollDelaysMs);
      if (!finished && mountedRef.current) showSlow();
    },
    [
      attemptKeyFor,
      claimFree,
      planPollDelaysMs,
      pollPlan,
      resolveExistingPlan,
      resolvePriceChange,
      runSheet,
      set,
      settleUncertain,
      showNotice,
      showSlow,
      surface,
    ],
  );

  // ── Public API ────────────────────────────────────────────────────────────
  const start = useCallback(
    async (pkg: PurchasablePackage): Promise<void> => {
      if (inFlightRef.current) return; // double tap: one attempt only
      inFlightRef.current = true;
      // A new tap supersedes an earlier unknown outcome; its key (kept in
      // attemptRef) still makes the backend replay that same attempt.
      confirmingRef.current = null;
      oneTimeUnknownRef.current = null;
      setState({
        ...IDLE,
        phase: "starting",
        packageId: pkg.id,
        saleKind: saleKindOf(pkg),
      });
      try {
        const kind = saleKindOf(pkg);
        if (kind === "free") await claimFree(pkg);
        else if (kind === "one_time") await buyOneTime(pkg);
        else await buySubscription(pkg);
      } catch {
        // Anything not mapped above (e.g. no secure random source for the key).
        const ref = attemptRef.current
          ? shortReference(attemptRef.current.key)
          : null;
        const n: PackagePaymentNotice = {
          cause: "unexpected",
          message: PACKAGE_PAYMENT_COPY.unknown(ref),
          support: true,
          reference: ref,
        };
        reportPackagePaymentFailure("config", n);
        showNotice(n);
      } finally {
        inFlightRef.current = false;
      }
    },
    [buyOneTime, buySubscription, claimFree, showNotice],
  );

  /** Continue at the new price after PACKAGE_PRICE_CHANGED (same attempt key). */
  const confirmNewPrice = useCallback(async () => {
    const change = state.priceChange;
    if (!change) return;
    await start(change.pkg);
  }, [start, state.priceChange]);

  /**
   * From the calm slow state, or an unknown card-step outcome (B-334-3):
   * read the plan (or the one-time purchase) again, bounded.
   */
  const checkAgain = useCallback(async () => {
    if (inFlightRef.current) return;
    const c = confirmingRef.current;
    const oneTime = oneTimeUnknownRef.current;
    if (!c && !oneTime) return;
    inFlightRef.current = true;
    try {
      if (c?.uncertain) {
        await settleUncertain(null, "outcome_unknown_recheck");
      } else if (c) {
        set({ phase: "confirming", notice: null });
        const finished = await pollPlan(recheckDelaysMs);
        if (!finished && mountedRef.current) showSlow();
      } else {
        await settleOneTimeUnknown(null, "outcome_unknown_recheck");
      }
    } finally {
      inFlightRef.current = false;
    }
  }, [
    pollPlan,
    recheckDelaysMs,
    set,
    settleOneTimeUnknown,
    settleUncertain,
    showSlow,
  ]);

  const reset = useCallback(() => {
    if (inFlightRef.current) return;
    setState(IDLE);
  }, []);

  /** Clear a notice when the client picks another plan. */
  const clearNotice = useCallback(() => {
    if (inFlightRef.current) return;
    setState((s) => (s.phase === "idle" ? { ...IDLE } : s));
  }, []);

  const busy =
    state.phase === "starting" ||
    state.phase === "paying" ||
    state.phase === "confirming";
  return {
    state,
    busy,
    start,
    confirmNewPrice,
    checkAgain,
    reset,
    clearNotice,
  };
}

export type PackagePurchase = ReturnType<typeof usePackagePurchase>;
