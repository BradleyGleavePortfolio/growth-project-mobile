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
 *
 * BILLQUOTE-M (agent 144): what is due today and the date of the next charge
 * come only from the server's `quote` (backend #998, the same function the
 * checkout charges with). The phone never adds prices or dates a trial; with
 * no quote (an older server, or a read that carries none) those two facts are
 * not shown and Stripe's own sheet shows the amount.
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
  /** The server's charge quote for this client; null when the read has none. */
  quote?: ChargeQuote | null;
}

/**
 * Backend #998 `quote`: what checkout charges if the client pays now, and the
 * next charge after today (the trial end in a trial, else the first renewal;
 * B-343-4: a resumed checkout's pinned date).
 */
export interface ChargeQuote {
  dueTodayCents: number;
  currency: string;
  firstChargeAt: string | null;
  trialEnd: string | null;
}

function isoOrNull(v: unknown): string | null {
  return typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : null;
}

/** Read the server's `quote`; anything malformed counts as no quote. */
function chargeQuoteOf(raw: unknown): ChargeQuote | null {
  if (!raw || typeof raw !== "object") return null;
  const q = raw as Record<string, unknown>;
  const due = wholeCents(q.due_today_cents);
  if (due === null || typeof q.currency !== "string" || !q.currency) return null;
  return {
    dueTodayCents: due,
    currency: q.currency.toLowerCase(),
    firstChargeAt: isoOrNull(q.first_charge_at),
    trialEnd: isoOrNull(q.trial_end),
  };
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
 * FW-MONEY-128 U-3: the client list and detail carry `trial_offer` for THIS
 * client (backend packages.controller.ts, one free trial per client per
 * coach). A trial is advertised only when that offer is available; a row
 * without an offer (coach previews, older payloads) keeps its trial days.
 */
function offeredTrialDays(r: Record<string, unknown>): number {
  const offer = r.trial_offer;
  if (!offer || typeof offer !== "object") return positiveInt(r.trial_days, 0);
  const o = offer as Record<string, unknown>;
  return o.available === true
    ? positiveInt(o.trial_days, positiveInt(r.trial_days, 0))
    : 0;
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

  const quote = chargeQuoteOf(r.quote);
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
      trialDays: offeredTrialDays(r),
      quote,
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
      quote,
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
    quote,
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

/**
 * C5-S1: what a purchase's checkout charged, from the server only
 * (first_charge_cents), and only for a purchase that is in force and not in a
 * trial. Otherwise, or absent, zero or not whole cents: null, so no paid line
 * shows; never amount_cents (a subscription's renewal) or a price.
 */
export function paidAmount(p: {
  first_charge_cents?: number | null;
  currency?: string;
  status?: string;
  entitlement_active?: boolean;
}): string | null {
  const c = p.first_charge_cents;
  return p.entitlement_active === true && p.status !== "trialing" &&
    typeof c === "number" && Number.isInteger(c) && c > 0 && p.currency
    ? money(c, p.currency)
    : null;
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

export interface PlanTermsLines {
  /** "$49.00 a month" or "$99.00, paid once". */
  price: string;
  /** What happens today and next; null when the server sent no quote. */
  firstCharge: string | null;
  /** Renewal and cancel terms; null for a one-time plan. */
  renewal: string | null;
  /** The pay button label. */
  cta: string;
}

/**
 * Terms shown before paying. Today's amount and the next charge date are the
 * server's quote; without one, those lines are left out (never worked out).
 */
export function planTerms(pkg: PurchasablePackage): PlanTermsLines {
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
  const q = pkg.quote ?? null;
  const today = q ? money(q.dueTodayCents, q.currency) : null;
  const date = q?.firstChargeAt ? formatPlanDate(new Date(q.firstChargeAt)) : null;
  if (kind === "one_time") {
    return {
      price: `${amount}, paid once`,
      firstCharge: today ? `You pay ${today} today. It does not renew.` : null,
      renewal: null,
      cta: `Pay ${today ?? amount}`,
    };
  }
  const cadence = cadenceCopy(pkg.interval ?? "month", pkg.intervalCount);
  const renewal =
    `Renews automatically at ${amount} ${cadence} until you cancel. ` +
    "Cancel anytime in Your plans; you keep the plan until the end of the period you paid for.";
  if (pkg.trialDays > 0) {
    // With a trial the quote's date is the first charge, at the trial's end.
    return {
      price: `${amount} ${cadence}`,
      firstCharge: date
        ? `Free for ${pkg.trialDays} ${pkg.trialDays === 1 ? "day" : "days"}, then your first charge of ` +
          `${amount} is on ${date}. Your card is saved today and not charged. ` +
          "Cancel before then and you are never charged."
        : null,
      renewal,
      cta: "Start free trial",
    };
  }
  // No trial: the quote's date is the next renewal, in the app's existing
  // "next charge" words (PACKAGE_PAYMENT_COPY.nextChargeOn).
  const next = date ? ` Your next charge of ${amount} is on ${date}.` : "";
  const period =
    pkg.intervalCount > 1
      ? `${pkg.intervalCount} ${pkg.interval ?? "month"}s`
      : (pkg.interval ?? "month");
  if (pkg.oneTimeCents > 0) {
    return {
      price: `${amount} ${cadence}`,
      firstCharge: today
        ? `You pay ${today} today: ${money(pkg.oneTimeCents, pkg.currency)} once plus your first ` +
          `${period} at ${amount}.${next}`
        : null,
      renewal,
      cta: today
        ? `Subscribe, pay ${today} today`
        : `Subscribe for ${amount} ${cadence}`,
    };
  }
  return {
    price: `${amount} ${cadence}`,
    firstCharge: today
      ? `You pay ${today} today for your first ${period}.${next}`
      : null,
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

/**
 * B-334-4: reconcile what the client was shown with what the backend is about
 * to charge, BEFORE any chargeable sheet opens. Returns the package adopted to
 * the backend's terms (zero trial days stay zero), and whether anything the
 * client consents to differs: renewal price, one-time part, currency,
 * cadence, trial length, or the trial's first charge date. The adopted
 * package's quote is the checkout's own answer (today's charge, pinned trial
 * end), so a review shows the server's numbers, never the phone's.
 */
export function reconcileIntentTerms(
  pkg: PurchasablePackage,
  plan: IntentTerms,
  mode: "payment" | "setup" | "none",
): {
  adopted: PurchasablePackage;
  changed: boolean;
  trialRemoved: boolean;
  /** B-343-4: the pinned first-charge date is not the date the client saw. */
  trialDateMoved: boolean;
  /** Today's charge is not what the quote showed for the same terms: never open a sheet. */
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
  // opened. The client consents to the calendar date the quote showed.
  const pinned =
    mode === "setup" && trialDays > 0 ? isoOrNull(plan.trialEndsAt) : null;
  const shown = pkg.quote ?? null;
  const shownDate = pkg.trialDays > 0 ? (shown?.firstChargeAt ?? null) : null;
  const trialDateMoved =
    pinned !== null &&
    shownDate !== null &&
    formatPlanDate(new Date(pinned)) !== formatPlanDate(new Date(shownDate));
  const changed =
    adopted.amountCents !== pkg.amountCents ||
    adopted.currency !== pkg.currency.toLowerCase() ||
    adopted.interval !== pkg.interval ||
    adopted.intervalCount !== pkg.intervalCount ||
    adopted.oneTimeCents !== pkg.oneTimeCents ||
    adopted.trialDays !== pkg.trialDays ||
    trialDateMoved;
  // Today's charge is the checkout's own answer. With the terms unchanged it
  // must be what the quote showed; a mismatch is a broken answer, not a
  // change to review (reviewing it again would show the same terms).
  const serverToday = wholeCents(plan.firstChargeCents);
  const inconsistent =
    !changed &&
    shown !== null &&
    serverToday !== null &&
    serverToday !== shown.dueTodayCents;
  // New terms keep no shown date they may have moved (left out, not guessed).
  const kept = changed ? null : shown;
  const dueToday = serverToday ?? kept?.dueTodayCents ?? null;
  adopted.quote =
    dueToday === null
      ? null
      : {
          dueTodayCents: dueToday,
          currency: adopted.currency,
          firstChargeAt: pinned ?? kept?.firstChargeAt ?? null,
          trialEnd: pinned ?? kept?.trialEnd ?? null,
        };
  return {
    adopted,
    changed,
    trialRemoved: pkg.trialDays > 0 && adopted.trialDays === 0,
    trialDateMoved,
    inconsistent,
  };
}
