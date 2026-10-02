/**
 * S-COACH-MOB-2 — typed client for TGP Money (coach Home card + Money page).
 *
 * Every number comes from a live backend route (backend #641 and existing
 * Connect routes); nothing is estimated on the device:
 *   GET  /v1/coach/money/summary?from&to&compare_from&compare_to
 *   GET  /v1/coach/money/charges?status&cursor&limit
 *   GET  /v1/coach/money/charges/:id         price - processing - TGP 2% = net
 *   GET  /v1/coach/money/attention           failed payments, disputes, Stripe
 *   GET  /coach/connect/payouts?limit        Stripe payouts (pending + paid)
 *   GET  /coach/connect/metrics              roster counts (no amounts)
 *   POST /v1/connect/accounts/dashboard-link Stripe Express dashboard link
 *
 * Fields the backend adds later (the amount held from the next sale after a
 * refund or chargeback, backend #627 / OR-111-1) are feature-detected: they
 * are `null` until the server sends them and the UI hides the row.
 * Errors are thrown as-is; screens turn them into specific copy with
 * describeError (src/lib/coachSetup/errors.ts).
 */
import api from "../services/api";

export type MoneyRange = "today" | "30d" | "90d" | "ytd";
export const MONEY_RANGES: readonly MoneyRange[] = [
  "today",
  "30d",
  "90d",
  "ytd",
];

export type ProcessingPaidBy = "coach" | "platform" | "mixed" | "none";

export interface MoneyTotals {
  grossCents: number;
  processingCents: number;
  platformFeeCents: number;
  headCoachSplitCents: number;
  refundedCents: number;
  headCoachIncomeCents: number;
  netCents: number;
  chargeCount: number;
  processingPaidBy: ProcessingPaidBy;
}

export interface MoneySummary {
  currency: string;
  window: { from: string; to: string };
  totals: MoneyTotals;
  compareTotals: MoneyTotals | null;
  changeCents: number | null;
  changePct: number | null;
  recurring: {
    mrrCents: number;
    payingClients: number;
    churned30d: number;
    newClients30d: number;
  };
  attentionCount: number;
  /**
   * What TGP holds from the coach's next sale after a refund or chargeback
   * (TGP 2% + Stripe fees, OR-111-1). null = the server does not send it yet.
   */
  heldFromNextSaleCents: number | null;
  generatedAt: string;
}

/** Coach-facing charge states, including ones newer backends add. */
export type ChargeState =
  | "paid"
  | "failed"
  | "refunded"
  | "partially_refunded"
  | "disputed"
  | "charged_back"
  | "pending"
  | "canceled";

export const CHARGE_STATES: readonly ChargeState[] = [
  "paid",
  "failed",
  "refunded",
  "partially_refunded",
  "disputed",
  "charged_back",
  "pending",
  "canceled",
];

export interface MoneyCharge {
  id: string;
  client: { id: string; name: string };
  packageName: string;
  amountCents: number;
  currency: string;
  billingType: "one_time" | "recurring";
  /** null when the server sent a state this build does not know. */
  state: ChargeState | null;
  rawState: string;
  refundedCents: number;
  createdAt: string;
}

export interface MoneyChargeBreakdown {
  charge: MoneyCharge;
  priceCents: number;
  processingCents: number;
  platformFeeCents: number;
  headCoachSplitCents: number;
  refundedCents: number;
  netCents: number;
  processingPaidBy: ProcessingPaidBy;
  settled: boolean;
}

export type ChargeFilter = "all" | "paid" | "failed" | "refunded";
export const CHARGE_FILTERS: readonly ChargeFilter[] = [
  "all",
  "paid",
  "failed",
  "refunded",
];

export interface MoneyChargesPage {
  charges: MoneyCharge[];
  nextCursor: string | null;
}

export type AttentionKind =
  "failed_payment" | "dispute" | "stripe_requirements";

export interface AttentionItem {
  kind: AttentionKind;
  id: string;
  client: { id: string; name: string } | null;
  amountCents: number | null;
  currency: string | null;
  createdAt: string | null;
  failedPayment: {
    packageName: string;
    attempt: number;
    maxAttempts: number;
    nextRetryAt: string | null;
    lockedOutAt: string | null;
    cardUpdateLinkSentAt: string | null;
    lastFailureReason: string | null;
  } | null;
  dispute: {
    status: string;
    reason: string | null;
    evidenceDueBy: string | null;
  } | null;
  stripeRequirements: {
    currentlyDue: string[];
    pastDue: string[];
    currentDeadline: string | null;
    disabledReason: string | null;
  } | null;
}

export interface MoneyAttention {
  count: number;
  items: AttentionItem[];
}

export type PayoutStatus =
  "pending" | "in_transit" | "paid" | "failed" | "canceled";

export interface MoneyPayout {
  id: string;
  amountCents: number;
  currency: string;
  status: PayoutStatus;
  arrivalDate: string | null;
  failureMessage: string | null;
}

/**
 * Roster figures from /coach/connect/metrics (the old Business metrics
 * screen). Money amounts are NOT read from it: every amount on the Money
 * page comes from the Money read model so two numbers never disagree.
 */
export interface RosterMetrics {
  rosterClients: number;
  joined30d: number;
  team: { acquired30d: number; churned30d: number };
}

// ─── parsing helpers (the server is the contract; be strict on types) ──────

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {};
const num = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;
const numOrNull = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : d);
const strOrNull = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : null;
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

function invalidPayload(what: string): Error {
  return Object.assign(new Error(`${what} payload invalid`), {
    response: { status: 502, data: { code: "MONEY_PAYLOAD_INVALID" } },
  });
}

const PAID_BY: readonly ProcessingPaidBy[] = [
  "coach",
  "platform",
  "mixed",
  "none",
];

function toTotals(raw: unknown): MoneyTotals {
  const t = obj(raw);
  const by = str(t.processing_paid_by) as ProcessingPaidBy;
  return {
    grossCents: num(t.gross_cents),
    processingCents: num(t.processing_cents),
    platformFeeCents: num(t.platform_fee_cents),
    headCoachSplitCents: num(t.head_coach_split_cents),
    refundedCents: num(t.refunded_cents),
    headCoachIncomeCents: num(t.head_coach_income_cents),
    netCents: num(t.net_cents),
    chargeCount: num(t.charge_count),
    processingPaidBy: PAID_BY.includes(by) ? by : "none",
  };
}

/** Exported for tests. */
export function toSummary(raw: unknown): MoneySummary {
  const s = obj(raw);
  if (!s.totals || typeof s.totals !== "object")
    throw invalidPayload("summary");
  const r = obj(s.recurring);
  const w = obj(s.window);
  const held = obj(s.open_balance);
  return {
    currency: str(s.currency, "usd"),
    window: { from: str(w.from), to: str(w.to) },
    totals: toTotals(s.totals),
    compareTotals: s.compare_totals ? toTotals(s.compare_totals) : null,
    changeCents: numOrNull(s.change_cents),
    changePct: numOrNull(s.change_pct),
    recurring: {
      mrrCents: num(r.mrr_cents),
      payingClients: num(r.paying_clients),
      churned30d: num(r.churned_30d),
      newClients30d: num(r.new_clients_30d),
    },
    attentionCount: num(s.attention_count),
    heldFromNextSaleCents:
      numOrNull(s.held_from_next_sale_cents) ??
      numOrNull(s.held_cents) ??
      numOrNull(held.held_cents) ??
      numOrNull(held.amount_cents),
    generatedAt: str(s.generated_at),
  };
}

/** Exported for tests. */
export function toCharge(raw: unknown): MoneyCharge {
  const c = obj(raw);
  const client = obj(c.client);
  const pkg = obj(c.package);
  const rawState = str(c.state);
  return {
    id: str(c.id),
    client: { id: str(client.id), name: str(client.name, "Client") },
    packageName: str(pkg.name),
    amountCents: num(c.amount_cents),
    currency: str(c.currency, "usd"),
    billingType: c.billing_type === "recurring" ? "recurring" : "one_time",
    state: (CHARGE_STATES as readonly string[]).includes(rawState)
      ? (rawState as ChargeState)
      : null,
    rawState,
    refundedCents: num(c.refunded_cents),
    createdAt: str(c.created_at),
  };
}

function toAttentionItem(raw: unknown): AttentionItem {
  const a = obj(raw);
  const client = a.client ? obj(a.client) : null;
  const fp = a.failed_payment ? obj(a.failed_payment) : null;
  const d = a.dispute ? obj(a.dispute) : null;
  const sr = a.stripe_requirements ? obj(a.stripe_requirements) : null;
  const kind = str(a.kind) as AttentionKind;
  return {
    kind,
    id: str(a.id),
    client: client
      ? { id: str(client.id), name: str(client.name, "Client") }
      : null,
    amountCents: numOrNull(a.amount_cents),
    currency: strOrNull(a.currency),
    createdAt: strOrNull(a.created_at),
    failedPayment: fp
      ? {
          packageName: str(fp.package_name),
          attempt: num(fp.attempt),
          maxAttempts: num(fp.max_attempts),
          nextRetryAt: strOrNull(fp.next_retry_at),
          lockedOutAt: strOrNull(fp.locked_out_at),
          cardUpdateLinkSentAt: strOrNull(fp.card_update_link_sent_at),
          lastFailureReason: strOrNull(fp.last_failure_reason),
        }
      : null,
    dispute: d
      ? {
          status: str(d.status),
          reason: strOrNull(d.reason),
          evidenceDueBy: strOrNull(d.evidence_due_by),
        }
      : null,
    stripeRequirements: sr
      ? {
          currentlyDue: strings(sr.currently_due),
          pastDue: strings(sr.past_due),
          currentDeadline: strOrNull(sr.current_deadline),
          disabledReason: strOrNull(sr.disabled_reason),
        }
      : null,
  };
}

const KINDS: readonly AttentionKind[] = [
  "failed_payment",
  "dispute",
  "stripe_requirements",
];

const PAYOUT_STATUSES: readonly PayoutStatus[] = [
  "pending",
  "in_transit",
  "paid",
  "failed",
  "canceled",
];

/** /coach/connect/payouts returns major units; convert to cents. */
export function toPayout(raw: unknown): MoneyPayout {
  const p = obj(raw);
  const status = str(p.status) as PayoutStatus;
  const arrival = strOrNull(p.arrival_date);
  return {
    id: str(p.id),
    amountCents: Math.round(num(p.amount) * 100),
    currency: str(p.currency, "usd"),
    status: PAYOUT_STATUSES.includes(status) ? status : "pending",
    // The snapshot fallback sends the epoch when it has no date.
    arrivalDate: arrival && Date.parse(arrival) > 0 ? arrival : null,
    failureMessage: status === "failed" ? strOrNull(p.description) : null,
  };
}

/**
 * The next payout: the soonest pending or in-transit payout. Stripe lists
 * pending payouts too, so this is Stripe's own figure. Exported for tests.
 */
export function nextPayout(payouts: MoneyPayout[]): MoneyPayout | null {
  const open = payouts.filter(
    (p) => p.status === "pending" || p.status === "in_transit",
  );
  open.sort(
    (a, b) =>
      (a.arrivalDate ? Date.parse(a.arrivalDate) : Infinity) -
      (b.arrivalDate ? Date.parse(b.arrivalDate) : Infinity),
  );
  return open[0] ?? null;
}

// ─── windows (device computes calendar windows in the coach's time zone) ───

export interface MoneyWindows {
  from: Date;
  to: Date;
  compareFrom: Date;
  compareTo: Date;
}

/**
 * Today = local midnight to now, compared with yesterday over the same
 * hours. 30d / 90d = the last N days, compared with the N days before.
 * YTD = 1 January to now, compared with the same span last year.
 * Exported for tests.
 */
export function windowsFor(range: MoneyRange, now: Date): MoneyWindows {
  const to = new Date(now.getTime());
  if (range === "today") {
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const span = to.getTime() - from.getTime();
    const compareFrom = new Date(from.getTime() - 86_400_000);
    return {
      from,
      to,
      compareFrom,
      compareTo: new Date(compareFrom.getTime() + Math.max(span, 1)),
    };
  }
  if (range === "ytd") {
    const from = new Date(now.getFullYear(), 0, 1);
    const compareFrom = new Date(now.getFullYear() - 1, 0, 1);
    const compareTo = new Date(
      now.getFullYear() - 1,
      now.getMonth(),
      now.getDate(),
      now.getHours(),
      now.getMinutes(),
      now.getSeconds(),
    );
    return { from, to, compareFrom, compareTo };
  }
  const days = range === "30d" ? 30 : 90;
  const from = new Date(to.getTime() - days * 86_400_000);
  return {
    from,
    to,
    compareFrom: new Date(from.getTime() - days * 86_400_000),
    compareTo: from,
  };
}

// ─── API ───────────────────────────────────────────────────────────────────

export const coachMoneyApi = {
  async summary(range: MoneyRange, now = new Date()): Promise<MoneySummary> {
    const w = windowsFor(range, now);
    const res = await api.get("/v1/coach/money/summary", {
      params: {
        from: w.from.toISOString(),
        to: w.to.toISOString(),
        compare_from: w.compareFrom.toISOString(),
        compare_to: w.compareTo.toISOString(),
      },
    });
    return toSummary(res.data);
  },

  async charges(
    filter: ChargeFilter,
    opts: { cursor?: string | null; limit?: number } = {},
  ): Promise<MoneyChargesPage> {
    const res = await api.get("/v1/coach/money/charges", {
      params: {
        status: filter,
        limit: opts.limit ?? 20,
        ...(opts.cursor ? { cursor: opts.cursor } : {}),
      },
    });
    const d = obj(res.data);
    if (!Array.isArray(d.charges)) throw invalidPayload("charges");
    return {
      charges: d.charges.map(toCharge),
      nextCursor: strOrNull(d.next_cursor),
    };
  },

  async charge(id: string): Promise<MoneyChargeBreakdown> {
    const res = await api.get(
      `/v1/coach/money/charges/${encodeURIComponent(id)}`,
    );
    const d = obj(res.data);
    if (!d.charge || !d.breakdown) throw invalidPayload("charge");
    const b = obj(d.breakdown);
    const by = str(b.processing_paid_by) as ProcessingPaidBy;
    return {
      charge: toCharge(d.charge),
      priceCents: num(b.price_cents),
      processingCents: num(b.processing_cents),
      platformFeeCents: num(b.platform_fee_cents),
      headCoachSplitCents: num(b.head_coach_split_cents),
      refundedCents: num(b.refunded_cents),
      netCents: num(b.net_cents),
      processingPaidBy: PAID_BY.includes(by) ? by : "none",
      settled: b.settled === true,
    };
  },

  async attention(): Promise<MoneyAttention> {
    const res = await api.get("/v1/coach/money/attention");
    const d = obj(res.data);
    if (!Array.isArray(d.items)) throw invalidPayload("attention");
    const items = d.items
      .map(toAttentionItem)
      .filter((i) => KINDS.includes(i.kind));
    return { count: num(d.count) || items.length, items };
  },

  async payouts(limit = 10): Promise<MoneyPayout[]> {
    const res = await api.get("/coach/connect/payouts", {
      params: { limit },
    });
    if (!Array.isArray(res.data)) throw invalidPayload("payouts");
    return res.data.map(toPayout);
  },

  async roster(): Promise<RosterMetrics> {
    const res = await api.get("/coach/connect/metrics");
    const m = obj(res.data);
    return {
      rosterClients: num(m.active_clients),
      joined30d: num(m.clients_added_30d),
      team: {
        acquired30d: num(m.sub_coach_acquisition_30d),
        churned30d: num(m.sub_coach_churn_30d),
      },
    };
  },

  /** Stripe Express dashboard (Payout settings). */
  async dashboardLink(): Promise<string> {
    const res = await api.post("/v1/connect/accounts/dashboard-link");
    const url = str(obj(res.data).url);
    if (!url) throw invalidPayload("dashboard link");
    return url;
  },
};
