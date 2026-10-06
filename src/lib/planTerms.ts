/**
 * Plan terms: the one model every package-selling surface uses to decide HOW
 * a package is sold and WHAT the client is told before paying.
 *
 * Sales routing (backend #654, B-RECUR):
 *   - renewing (billing_type 'recurring', or a one-time package with a
 *     recurring second price) -> POST /v1/checkout/subscription-intent
 *   - one-time with a price      -> POST /v1/checkout/payment-intent
 *   - one-time $0                -> POST /v1/packages/:id/claim-free
 * The rule mirrors the backend `isRecurringPackage()` in
 * src/checkout/checkout.service.ts exactly, so the app never sends a renewing
 * plan to payment-intent (which answers RECURRING_REQUIRES_SUBSCRIPTION).
 *
 * Terms shown before paying (owner bar): renewal price and interval, what is
 * charged today (including any one-time part), the trial length and the date
 * of the first charge, and that the plan can be canceled anytime in the app.
 */
import { formatCurrencyCents } from "../utils/currency";

export type PlanInterval = "week" | "month" | "year";

export interface PurchasablePackage {
  id: string;
  name: string;
  currency: string;
  /** Renewing: what each renewal charges. One-time: the single charge. */
  amountCents: number;
  /** Sold as a Stripe subscription (renews until canceled). */
  renewing: boolean;
  /** Renewing only. */
  interval: PlanInterval | null;
  intervalCount: number;
  /** One-time part charged today together with the first period (combo package). */
  oneTimeCents: number;
  /** Free trial before the first charge (pure renewing packages only). */
  trialDays: number;
  /**
   * B-343-4: the first-charge instant the backend already pinned for this
   * client's trial (a resumed checkout). Shown instead of now + trialDays.
   */
  trialEndsAt?: string | null;
}

export type SaleKind = "subscription" | "one_time" | "free";

export function saleKindOf(pkg: PurchasablePackage): SaleKind {
  if (pkg.renewing) return "subscription";
  return pkg.amountCents === 0 ? "free" : "one_time";
}

function asInterval(v: unknown): PlanInterval | null {
  if (v === "week" || v === "month" || v === "year") return v;
  // Older payloads spell the cadence out.
  if (v === "weekly") return "week";
  if (v === "monthly") return "month";
  if (v === "yearly" || v === "annual") return "year";
  return null;
}

function wholeCents(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
}

function positiveInt(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isInteger(v) && v > 0 ? v : fallback;
}

/**
 * Adapt a raw backend `CoachPackage` row (GET /v1/clients/me/coach/packages,
 * GET /v1/clients/me/coach/packages/:id). Returns null for rows that cannot be
 * sold honestly (no id, no whole-cent price, renewing without a cadence), so a
 * surface never shows a made-up price.
 */
export function purchasableFromCoachPackage(
  raw: unknown,
): PurchasablePackage | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id) return null;
  const amount = wholeCents(r.amount_cents) ?? wholeCents(r.price_cents);
  if (amount === null) return null;
  const name = typeof r.name === "string" ? r.name : "";
  const currency =
    typeof r.currency === "string" && r.currency
      ? r.currency.toLowerCase()
      : "usd";

  const recurringAmount = wholeCents(r.recurring_amount_cents);
  const recurringInterval = asInterval(r.recurring_interval);
  const isCombo =
    r.billing_type !== "recurring" &&
    recurringAmount !== null &&
    r.recurring_interval != null;

  if (r.billing_type === "recurring") {
    const interval = asInterval(r.interval);
    if (!interval) return null;
    return {
      id: r.id,
      name,
      currency,
      amountCents: amount,
      renewing: true,
      interval,
      intervalCount: positiveInt(r.interval_count, 1),
      oneTimeCents: 0,
      trialDays: positiveInt(r.trial_days, 0),
    };
  }
  if (isCombo) {
    if (!recurringInterval) return null;
    return {
      id: r.id,
      name,
      currency,
      amountCents: recurringAmount,
      renewing: true,
      interval: recurringInterval,
      intervalCount: positiveInt(r.recurring_interval_count, 1),
      oneTimeCents: amount,
      // Trials apply to pure renewing packages only (backend packageTrialDays).
      trialDays: 0,
    };
  }
  return {
    id: r.id,
    name,
    currency,
    amountCents: amount,
    renewing: false,
    interval: null,
    intervalCount: 1,
    oneTimeCents: 0,
    trialDays: 0,
  };
}

// ─── Copy ──────────────────────────────────────────────────────────────────

function unitWord(interval: PlanInterval): string {
  return interval;
}

/** "a month", "every 3 months", "a year". */
export function cadenceCopy(interval: PlanInterval, count: number): string {
  if (count > 1) return `every ${count} ${unitWord(interval)}s`;
  return `a ${unitWord(interval)}`;
}

export function money(cents: number, currency: string): string {
  return formatCurrencyCents(cents, currency);
}

/** Short price label for a list row: "$49.00 a month", "$99.00 once", "Free". */
export function priceLabel(pkg: PurchasablePackage): string {
  if (!pkg.renewing) {
    return pkg.amountCents === 0
      ? "Free"
      : `${money(pkg.amountCents, pkg.currency)} once`;
  }
  const base = `${money(pkg.amountCents, pkg.currency)} ${cadenceCopy(pkg.interval ?? "month", pkg.intervalCount)}`;
  if (pkg.trialDays > 0) return `${base}, ${pkg.trialDays}-day free trial`;
  if (pkg.oneTimeCents > 0)
    return `${base}, plus ${money(pkg.oneTimeCents, pkg.currency)} once`;
  return base;
}

export function formatPlanDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/** The date the first charge happens after a trial that starts now. */
export function trialFirstChargeDate(
  trialDays: number,
  now: Date = new Date(),
): Date {
  const d = new Date(now.getTime());
  d.setDate(d.getDate() + trialDays);
  return d;
}

export interface PlanTermsLines {
  /** "$49.00 a month" or "$99.00, paid once". */
  price: string;
  /** What happens today and next. */
  firstCharge: string;
  /** Renewal and cancel terms; null for a one-time plan. */
  renewal: string | null;
  /** The pay button label. */
  cta: string;
}

/**
 * Terms shown before paying. `trialEndsAt` (from the backend answer) wins
 * over the locally computed date when the backend already set the trial.
 */
export function planTerms(
  pkg: PurchasablePackage,
  now: Date = new Date(),
  trialEndsAt?: string | null,
): PlanTermsLines {
  const kind = saleKindOf(pkg);
  if (kind === "free") {
    return {
      price: "Free",
      firstCharge: "No card is needed and nothing is charged.",
      renewal: null,
      cta: "Add this free plan",
    };
  }
  const amount = money(pkg.amountCents, pkg.currency);
  if (kind === "one_time") {
    return {
      price: `${amount}, paid once`,
      firstCharge: `You pay ${amount} today. It does not renew.`,
      renewal: null,
      cta: `Pay ${amount}`,
    };
  }
  const cadence = cadenceCopy(pkg.interval ?? "month", pkg.intervalCount);
  const renewal =
    `Renews automatically at ${amount} ${cadence} until you cancel. ` +
    "Cancel anytime in Membership; you keep the plan until the end of the period you paid for.";
  if (pkg.trialDays > 0) {
    const pinned = trialEndsAt ?? pkg.trialEndsAt ?? null;
    const parsed = pinned ? new Date(pinned) : null;
    const firstDate =
      parsed && !Number.isNaN(parsed.getTime())
        ? parsed
        : trialFirstChargeDate(pkg.trialDays, now);
    return {
      price: `${amount} ${cadence}`,
      firstCharge:
        `Free for ${pkg.trialDays} ${pkg.trialDays === 1 ? "day" : "days"}, then your first charge of ` +
        `${amount} is on ${formatPlanDate(firstDate)}. Your card is saved today and not charged. ` +
        "Cancel before then and you are never charged.",
      renewal,
      cta: "Start free trial",
    };
  }
  if (pkg.oneTimeCents > 0) {
    const today = money(pkg.oneTimeCents + pkg.amountCents, pkg.currency);
    return {
      price: `${amount} ${cadence}`,
      firstCharge:
        `You pay ${today} today: ${money(pkg.oneTimeCents, pkg.currency)} once plus your first ` +
        `${pkg.intervalCount > 1 ? `${pkg.intervalCount} ${pkg.interval ?? "month"}s` : (pkg.interval ?? "month")} at ${amount}.`,
      renewal,
      cta: `Subscribe, pay ${today} today`,
    };
  }
  return {
    price: `${amount} ${cadence}`,
    firstCharge: `You pay ${amount} today for your first ${
      pkg.intervalCount > 1
        ? `${pkg.intervalCount} ${pkg.interval ?? "month"}s`
        : (pkg.interval ?? "month")
    }.`,
    renewal,
    cta: `Subscribe for ${amount} ${cadence}`,
  };
}

/**
 * Adapt the public share-link view (GET /v1/packages/public/join/:token,
 * adapted by packagesApi.adaptPublicPackage). That payload has no combo
 * fields, so a package is renewing exactly when its billing cycle is not
 * one-time.
 */
export function purchasableFromPublicPackage(p: {
  id: string;
  title: string;
  priceCents: number;
  currency: string;
  billingInterval: "one_time" | "weekly" | "monthly" | "quarterly" | "yearly";
  intervalCount?: number;
  trialDays: number | null;
}): PurchasablePackage | null {
  if (!p.id || wholeCents(p.priceCents) === null) return null;
  const renewing = p.billingInterval !== "one_time";
  const interval: PlanInterval | null = !renewing
    ? null
    : p.billingInterval === "yearly"
      ? "year"
      : p.billingInterval === "weekly"
        ? "week"
        : "month";
  return {
    id: p.id,
    name: p.title,
    currency: (p.currency || "usd").toLowerCase(),
    amountCents: p.priceCents,
    renewing,
    interval,
    intervalCount: renewing
      ? p.billingInterval === "quarterly"
        ? 3
        : positiveInt(p.intervalCount, 1)
      : 1,
    oneTimeCents: 0,
    trialDays: renewing ? positiveInt(p.trialDays, 0) : 0,
  };
}

/** The money terms a subscription intent answers (backend #654 `plan`). */
export interface IntentTerms {
  amountCents: number | null;
  currency: string | null;
  interval: PlanInterval | null;
  intervalCount: number | null;
  firstChargeCents: number | null;
  oneTimeCents: number | null;
  trialDays: number | null;
  /** The first-charge instant of the trial the backend set (setup mode). */
  trialEndsAt?: string | null;
}

/** What the client is told is charged today for this package. */
export function firstChargeCentsOf(pkg: PurchasablePackage): number {
  return pkg.trialDays > 0 ? 0 : pkg.amountCents + pkg.oneTimeCents;
}

/**
 * B-334-4: reconcile what the client was shown with what the backend is about
 * to charge, BEFORE any chargeable sheet opens. Returns the package adopted to
 * the backend's terms (zero trial days stay zero), and whether anything the
 * client consents to differs: renewal price, one-time part, currency,
 * cadence, trial length, or today's charge.
 */
export function reconcileIntentTerms(
  pkg: PurchasablePackage,
  plan: IntentTerms,
  mode: "payment" | "setup" | "none",
  now: Date = new Date(),
): {
  adopted: PurchasablePackage;
  changed: boolean;
  trialRemoved: boolean;
  /** B-343-4: the pinned first-charge date is not the date the client saw. */
  trialDateMoved: boolean;
  /** Today's charge does not follow from the answered terms: never open a sheet. */
  inconsistent: boolean;
} {
  const trialDays =
    plan.trialDays !== null &&
    Number.isInteger(plan.trialDays) &&
    plan.trialDays >= 0
      ? plan.trialDays
      : mode === "setup"
        ? pkg.trialDays
        : 0;
  const adopted: PurchasablePackage = {
    ...pkg,
    amountCents:
      plan.amountCents !== null &&
      Number.isInteger(plan.amountCents) &&
      plan.amountCents > 0
        ? plan.amountCents
        : pkg.amountCents,
    currency: plan.currency ? plan.currency.toLowerCase() : pkg.currency,
    interval: plan.interval ?? pkg.interval,
    intervalCount:
      plan.intervalCount !== null &&
      Number.isInteger(plan.intervalCount) &&
      plan.intervalCount > 0
        ? plan.intervalCount
        : pkg.intervalCount,
    oneTimeCents:
      plan.oneTimeCents !== null &&
      Number.isInteger(plan.oneTimeCents) &&
      plan.oneTimeCents >= 0
        ? plan.oneTimeCents
        : pkg.oneTimeCents,
    trialDays,
  };
  // B-343-4: a resumed trial keeps the end date pinned when its checkout first
  // opened. The client consents to a calendar date, so compare dates as shown.
  const pinned =
    mode === "setup" && trialDays > 0 && plan.trialEndsAt
      ? new Date(plan.trialEndsAt)
      : null;
  let trialDateMoved = false;
  if (pinned && !Number.isNaN(pinned.getTime())) {
    const shownIso = pkg.trialEndsAt ? new Date(pkg.trialEndsAt) : null;
    const shown =
      shownIso && !Number.isNaN(shownIso.getTime())
        ? shownIso
        : trialFirstChargeDate(pkg.trialDays, now);
    trialDateMoved = formatPlanDate(pinned) !== formatPlanDate(shown);
    adopted.trialEndsAt = plan.trialEndsAt;
  }
  // Today's charge follows from the terms; a mismatch is a broken answer, not
  // a change to review (reviewing it again would show the same terms).
  const inconsistent =
    plan.firstChargeCents !== null &&
    plan.firstChargeCents !== firstChargeCentsOf(adopted);
  const changed =
    adopted.amountCents !== pkg.amountCents ||
    adopted.currency !== pkg.currency.toLowerCase() ||
    adopted.interval !== pkg.interval ||
    adopted.intervalCount !== pkg.intervalCount ||
    adopted.oneTimeCents !== pkg.oneTimeCents ||
    adopted.trialDays !== pkg.trialDays ||
    trialDateMoved;
  return {
    adopted,
    changed,
    trialRemoved: pkg.trialDays > 0 && adopted.trialDays === 0,
    trialDateMoved,
    inconsistent,
  };
}
