import api from '../../services/api';
import { generateIdempotencyKey } from '../../utils/idempotency';

/**
 * Client read of the signed-in client's non-payment status (S-DUNNING).
 * Backend: `GET /v1/checkout/dunning` (DunningStatusController). Reachable
 * while locked. With the backend flag off it returns `enabled: false` and
 * the app renders nothing.
 */
export type DunningState = 'none' | 'past_due' | 'locked';

export interface ClientDunningStatus {
  enabled: boolean;
  state: DunningState;
  /**
   * 'dispute' = the bank reversed a payment on a recurring plan. Under
   * R-DISPUTE-PAUSE that plan's access has ended and its billing is paused
   * until its coach restarts it; a card update never ends it.
   */
  kind?: 'payment' | 'dispute' | null;
  /**
   * Backend D2c (#705): 'dispute_paused' for a dispute pause (no lock date,
   * no card or cancel path, `restart_by: 'coach'`); 'payment_failed' for a
   * failed renewal. Absent on older backends (null).
   */
  reason?: 'dispute_paused' | 'payment_failed' | null;
  /** The cycle is locked but another live plan keeps access (show the banner, not the lock). */
  lock_waived?: boolean;
  purchase_id: string | null;
  amount_cents: number | null;
  currency: string | null;
  failed_at: string | null;
  lockout_at: string | null;
  locked_at: string | null;
  day: number | null;
  coach_name: string | null;
  card_last4: string | null;
  card_brand: string | null;
}

/** Thrown when a 2xx body is missing a field the flow cannot continue without. */
export class DunningResponseShapeError extends Error {
  constructor(readonly route: string) {
    super('DUNNING_RESPONSE_SHAPE');
  }
}

/** The quote route; a shape error on it stops the payment before the card form opens. */
export const ROUTE_QUOTE = 'payment-method/quote';

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Integer minor units, or null when absent / not an integer (never a guessed 0). */
function cents(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null;
}

const ROUTE_STATUS = 'checkout/dunning';

/**
 * Strict normaliser (S-DUNNING-R3 B-322-5): an unexpected shape throws, so
 * the provider keeps its last known state instead of clearing a lockout or
 * a banner on a malformed answer.
 */
export function normalizeDunningStatus(raw: unknown): ClientDunningStatus {
  if (!raw || typeof raw !== 'object') throw new DunningResponseShapeError(ROUTE_STATUS);
  const r = raw as Record<string, unknown>;
  if (typeof r.enabled !== 'boolean') throw new DunningResponseShapeError(ROUTE_STATUS);
  if (r.state !== 'none' && r.state !== 'past_due' && r.state !== 'locked') {
    throw new DunningResponseShapeError(ROUTE_STATUS);
  }
  const state: DunningState = r.state;
  if (state !== 'none' && !str(r.purchase_id)) throw new DunningResponseShapeError(ROUTE_STATUS);
  const reason = r.reason === 'dispute_paused' || r.reason === 'payment_failed' ? r.reason : null;
  // R-DISPUTE-PAUSE: a dispute pause is a dispute whatever `kind` says, and a
  // dispute never carries a lock date (an older backend's grace-period date
  // is dropped here, so no surface can show one).
  const kind = r.kind === 'dispute' || reason === 'dispute_paused' ? 'dispute' : r.kind === 'payment' ? 'payment' : null;
  return {
    enabled: r.enabled,
    state,
    kind,
    reason,
    lock_waived: r.lock_waived === true,
    purchase_id: str(r.purchase_id),
    amount_cents: cents(r.amount_cents),
    currency: str(r.currency),
    failed_at: str(r.failed_at),
    lockout_at: kind === 'dispute' ? null : str(r.lockout_at),
    locked_at: str(r.locked_at),
    day: num(r.day),
    coach_name: str(r.coach_name),
    card_last4: str(r.card_last4),
    card_brand: str(r.card_brand),
  };
}

/**
 * Native card update (OR-110-2). Backend: ClientBillingController.
 *  1. GET  /v1/checkout/payment-method/quote -> every open invoice the update
 *     would pay, per currency (shown before the client acts).
 *  2. POST /v1/checkout/payment-method/setup-intent -> a SetupIntent on the
 *     client's Stripe customer (platform account) + an ephemeral key.
 *  3. PaymentSheet collects and confirms the card on the device.
 *  4. POST /v1/checkout/payment-method/confirm with the approved invoices ->
 *     the backend makes the card the default and (1A) pays exactly those.
 */
export interface CardSetup {
  setup_intent_id: string;
  setup_intent_client_secret: string;
  ephemeral_key: string;
  customer_id: string;
  publishable_key: string | null;
  merchant_display_name: string;
}

export interface MoneyTotal {
  currency: string;
  amount_cents: number;
}

export interface QuoteLine {
  invoice_id: string;
  purchase_id: string;
  coach_name: string | null;
  currency: string;
  amount_cents: number;
}

/**
 * A plan with a disputed payment open: the bank reversed a payment already
 * made. Its access has ended and its billing is paused until its coach
 * restarts it (R-DISPUTE-PAUSE); a card update never ends it. The amount is
 * known only on a dispute cycle.
 */
export interface QuoteDispute {
  purchase_id: string;
  coach_name: string | null;
  currency: string | null;
  amount_cents: number | null;
}

export interface PaymentQuote {
  quote_id: string;
  lines: QuoteLine[];
  totals: MoneyTotal[];
  /** Plans with a disputed payment open (a card update does not settle them). */
  disputes: QuoteDispute[];
}

export interface ApprovedInvoice {
  invoice_id: string;
  amount_cents: number;
  currency: string;
}

export function approvalFor(quote: PaymentQuote | null): ApprovedInvoice[] {
  return (quote?.lines ?? []).map((l) => ({
    invoice_id: l.invoice_id,
    amount_cents: l.amount_cents,
    currency: l.currency,
  }));
}

export type CardUpdateOutcome =
  | 'paid'
  | 'saved'
  | 'requires_action'
  | 'declined'
  | 'processing'
  | 'approval_required'
  | 'payment_uncertain'
  | 'failed'
  /**
   * B-322-7: part of the update ran (e.g. one plan paid) while another
   * change to a different plan was still being processed on the server.
   * Not an error: the known payment is shown and "Check again" repeats the
   * same confirm (same SetupIntent and approval), which never charges twice.
   */
  | 'in_progress';

export type AccessState = 'restored' | 'partial' | 'updating' | 'unchanged';

export interface CardUpdateResponse {
  outcome: CardUpdateOutcome;
  card_last4: string | null;
  card_brand: string | null;
  /** Integer minor units paid (single currency only; null when mixed or unknown). */
  amount_paid_cents: number | null;
  /** Integer minor units still open (single currency only; null when mixed or unknown). */
  amount_due_cents: number | null;
  currency: string | null;
  paid_totals: MoneyTotal[];
  due_totals: MoneyTotal[];
  /** True only when the server confirmed every plan's access is back. */
  access_restored: boolean;
  access_state: AccessState;
  quote: PaymentQuote | null;
  payment_intent_client_secret: string | null;
  decline_code: string | null;
  /**
   * B-353-2 / C-352-5: plans whose disputed payment is still open after this
   * update (from the server's per-plan `dispute_open`, merged with the quote's
   * disputes). Saving a card did not settle them, so the copy says so. Null
   * when the answer carries neither (the screen then uses the quote it read
   * before the card form).
   */
  disputes: QuoteDispute[] | null;
  /** The server's own truthful sentence (leads with what was paid). */
  message: string | null;
}

export type CancelOutcome = 'ended' | 'scheduled' | 'already_ended';

export interface CancelPlanResponse {
  outcome: CancelOutcome;
  purchase_id: string;
  access_ends_at: string | null;
  voided_invoice_count: number;
  /** Integer minor units forgiven by voiding (never collected). */
  voided_amount_cents: number;
  currency: string | null;
  /** A payment that landed meanwhile kept the paid period (plan ends at period end). */
  paid_period_kept: boolean;
  message: string | null;
}

function totals(v: unknown, route: string): MoneyTotal[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new DunningResponseShapeError(route);
  return v.map((t) => {
    const r = (t && typeof t === 'object' ? t : {}) as Record<string, unknown>;
    const currency = str(r.currency);
    const amount = cents(r.amount_cents);
    if (!currency || amount === null) throw new DunningResponseShapeError(route);
    return { currency, amount_cents: amount };
  });
}

export function normalizeCardSetup(raw: unknown): CardSetup {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const id = str(r.setup_intent_id);
  const secret = str(r.setup_intent_client_secret);
  const key = str(r.ephemeral_key);
  const customer = str(r.customer_id);
  if (!id || !secret || !key || !customer) {
    throw new DunningResponseShapeError('payment-method/setup-intent');
  }
  return {
    setup_intent_id: id,
    setup_intent_client_secret: secret,
    ephemeral_key: key,
    customer_id: customer,
    publishable_key: str(r.publishable_key),
    merchant_display_name: str(r.merchant_display_name) ?? 'The Growth Project',
  };
}

/**
 * B-322-5: a quote is money the client is about to approve, so it must be
 * complete and internally consistent or the flow stops before the card form
 * opens (no fail-open into an approval the button does not show):
 *  - `complete: true` (the server read every plan and every invoice page);
 *  - `lines` and `totals` both present; every line a unique invoice with an
 *    integer amount; every total a unique currency;
 *  - the per-currency totals equal the per-currency sums of the lines
 *    (zero amounts aside), so the "Save card and pay ..." label and the
 *    approved invoices always describe the same money.
 * A complete quote with no lines and no totals is valid (Save card only).
 */
export function normalizePaymentQuote(raw: unknown, route: string = ROUTE_QUOTE): PaymentQuote {
  const r = (raw && typeof raw === 'object' ? raw : null) as Record<string, unknown> | null;
  if (!r || !str(r.quote_id) || !Array.isArray(r.lines) || !Array.isArray(r.totals) || r.complete !== true) {
    throw new DunningResponseShapeError(route);
  }
  const seenInvoices = new Set<string>();
  const lines = r.lines.map((l) => {
    const x = (l && typeof l === 'object' ? l : {}) as Record<string, unknown>;
    const invoice = str(x.invoice_id);
    const purchase = str(x.purchase_id);
    const currency = str(x.currency);
    const amount = cents(x.amount_cents);
    if (!invoice || !purchase || !currency || amount === null) throw new DunningResponseShapeError(route);
    if (seenInvoices.has(invoice)) throw new DunningResponseShapeError(route);
    seenInvoices.add(invoice);
    return {
      invoice_id: invoice,
      purchase_id: purchase,
      coach_name: str(x.coach_name),
      currency,
      amount_cents: amount,
    };
  });
  const quoteTotals = totals(r.totals, route);
  const byCurrency = (list: Array<{ currency: string; amount_cents: number }>, unique: boolean) => {
    const out = new Map<string, number>();
    for (const t of list) {
      const cur = t.currency.toLowerCase();
      if (unique && out.has(cur)) throw new DunningResponseShapeError(route);
      out.set(cur, (out.get(cur) ?? 0) + t.amount_cents);
    }
    for (const [cur, amount] of [...out]) if (amount === 0) out.delete(cur);
    return out;
  };
  const fromLines = byCurrency(lines, false);
  const fromTotals = byCurrency(quoteTotals, true);
  if (fromLines.size !== fromTotals.size || [...fromLines].some(([cur, amount]) => fromTotals.get(cur) !== amount)) {
    throw new DunningResponseShapeError(route);
  }
  const disputes = Array.isArray(r.disputes) ? r.disputes.map(normalizeDispute) : [];
  return {
    quote_id: str(r.quote_id) as string,
    lines,
    totals: quoteTotals.filter((t) => t.amount_cents > 0),
    disputes,
  };
}

function normalizeDispute(d: unknown): QuoteDispute {
  const x = (d && typeof d === 'object' ? d : {}) as Record<string, unknown>;
  return {
    purchase_id: str(x.purchase_id) ?? '',
    coach_name: str(x.coach_name),
    currency: str(x.currency),
    amount_cents: cents(x.amount_cents),
  };
}

/**
 * Open disputes after a confirm: every plan the server marks `dispute_open`,
 * plus the quote's disputes (which carry the reversed amount), one per plan.
 * A dispute flag is never dropped, even when the plan entry is incomplete.
 */
function confirmDisputes(plans: unknown, quote: PaymentQuote | null): QuoteDispute[] | null {
  if (!Array.isArray(plans) && !quote) return null;
  const out = new Map<string, QuoteDispute>();
  for (const d of quote?.disputes ?? []) out.set(d.purchase_id, d);
  if (Array.isArray(plans)) {
    plans.forEach((p, i) => {
      const x = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>;
      if (x.dispute_open !== true) return;
      const id = str(x.purchase_id) ?? `plan-${i}`;
      if (out.has(id)) return;
      out.set(id, { purchase_id: id, coach_name: str(x.coach_name), currency: str(x.currency), amount_cents: null });
    });
  }
  return [...out.values()];
}

const OUTCOMES: ReadonlySet<string> = new Set([
  'paid',
  'saved',
  'requires_action',
  'declined',
  'processing',
  'approval_required',
  'payment_uncertain',
  'failed',
  'in_progress',
]);
const ACCESS: ReadonlySet<string> = new Set(['restored', 'partial', 'updating', 'unchanged']);

/**
 * Fail closed (B-322-5): an unknown outcome, a money field that is not an
 * integer, or a bank step without its secret is a shape error (reported,
 * shown as "could not confirm"), never "nothing was charged" or "paid".
 */
export function normalizeCardUpdate(raw: unknown): CardUpdateResponse {
  const route = 'payment-method/confirm';
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (typeof r.outcome !== 'string' || !OUTCOMES.has(r.outcome)) {
    throw new DunningResponseShapeError(route);
  }
  const outcome = r.outcome as CardUpdateOutcome;
  const paidTotals = totals(r.paid_totals, route);
  const dueTotals = totals(r.due_totals, route);
  const paid = r.amount_paid_cents === null ? null : cents(r.amount_paid_cents);
  const due = r.amount_due_cents === null ? null : cents(r.amount_due_cents);
  if (r.amount_paid_cents !== null && paid === null && paidTotals.length === 0) {
    throw new DunningResponseShapeError(route);
  }
  const secret = str(r.payment_intent_client_secret);
  if (outcome === 'requires_action' && !secret) throw new DunningResponseShapeError(route);
  const access =
    typeof r.access_state === 'string' && ACCESS.has(r.access_state)
      ? (r.access_state as AccessState)
      : r.access_restored === true
        ? 'restored'
        : 'unchanged';
  const card = (r.card && typeof r.card === 'object' ? r.card : {}) as Record<string, unknown>;
  const quote = r.quote ? normalizePaymentQuote(r.quote, route) : null;
  return {
    outcome,
    card_last4: str(card.last4),
    card_brand: str(card.brand),
    amount_paid_cents: paid,
    amount_due_cents: due,
    currency: str(r.currency),
    paid_totals:
      paidTotals.length > 0 || paid === null || paid === 0
        ? paidTotals
        : [{ currency: str(r.currency) ?? 'usd', amount_cents: paid }],
    due_totals:
      dueTotals.length > 0 || due === null || due === 0
        ? dueTotals
        : [{ currency: str(r.currency) ?? 'usd', amount_cents: due }],
    access_restored: r.access_restored === true && access === 'restored',
    access_state: access,
    quote,
    payment_intent_client_secret: secret,
    decline_code: str(r.decline_code),
    disputes: confirmDisputes(r.plans, quote),
    message: str(r.message),
  };
}

const CANCEL_OUTCOMES: ReadonlySet<string> = new Set(['ended', 'scheduled', 'already_ended']);

export function normalizeCancelPlan(raw: unknown): CancelPlanResponse {
  const route = 'subscriptions/cancel';
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const purchaseId = str(r.purchase_id);
  if (typeof r.outcome !== 'string' || !CANCEL_OUTCOMES.has(r.outcome) || !purchaseId) {
    throw new DunningResponseShapeError(route);
  }
  const voidedCount = cents(r.voided_invoice_count);
  const voidedCents = cents(r.voided_amount_cents);
  if (voidedCount === null || voidedCents === null) throw new DunningResponseShapeError(route);
  return {
    outcome: r.outcome as CancelOutcome,
    purchase_id: purchaseId,
    access_ends_at: str(r.access_ends_at),
    voided_invoice_count: voidedCount,
    voided_amount_cents: voidedCents,
    currency: str(r.currency),
    paid_period_kept: r.paid_period_kept === true,
    message: str(r.message),
  };
}

export const dunningApi = {
  /** Throws the axios error (or a shape error) on failure; callers map it with describeDunningError. */
  async getStatus(): Promise<ClientDunningStatus> {
    const res = await api.get<unknown>('/v1/checkout/dunning');
    return normalizeDunningStatus(res.data);
  },
  /** Every open invoice a card update would pay, read fresh before the client acts. */
  async getPaymentQuote(): Promise<PaymentQuote> {
    const res = await api.get<unknown>('/v1/checkout/payment-method/quote');
    return normalizePaymentQuote(res.data);
  },
  /** Step 2 of the native card update. One idempotency key per tap. */
  async createCardSetup(idempotencyKey: string = generateIdempotencyKey()): Promise<CardSetup> {
    const res = await api.post<unknown>('/v1/checkout/payment-method/setup-intent', {
      idempotency_key: idempotencyKey,
    });
    return normalizeCardSetup(res.data);
  },
  /**
   * Step 4: make the confirmed card the default and pay exactly the approved
   * invoices. Safe to repeat with the same SetupIntent and approval: the
   * server answers with what that confirm already paid.
   */
  async confirmCardUpdate(setupIntentId: string, approved: ApprovedInvoice[] = []): Promise<CardUpdateResponse> {
    const res = await api.post<unknown>('/v1/checkout/payment-method/confirm', {
      setup_intent_id: setupIntentId,
      approved_invoices: approved,
    });
    return normalizeCardUpdate(res.data);
  },
  /**
   * End a plan. In dunning (2A) the unpaid invoice is voided and access ends
   * now, unless a payment already landed (then the paid period is kept);
   * otherwise (option A) access runs to the end of the paid period.
   */
  async cancelPlan(purchaseId: string): Promise<CancelPlanResponse> {
    const res = await api.post<unknown>(`/v1/checkout/subscriptions/${encodeURIComponent(purchaseId)}/cancel`, {});
    return normalizeCancelPlan(res.data);
  },
};

/** Stripe zero-decimal currencies: the minor unit is the whole unit. */
const ZERO_DECIMAL = new Set([
  'BIF',
  'CLP',
  'DJF',
  'GNF',
  'JPY',
  'KMF',
  'KRW',
  'MGA',
  'PYG',
  'RWF',
  'UGX',
  'VND',
  'VUV',
  'XAF',
  'XOF',
  'XPF',
]);

/**
 * "$150.00" for USD, "150.00 EUR" otherwise; null when the amount is unknown.
 * Input is integer minor units (Stripe's amount fields).
 */
export function formatDunningAmount(cents: number | null, currency: string | null): string | null {
  if (cents == null || !Number.isFinite(cents)) return null;
  const cur = (currency ?? 'usd').toUpperCase();
  const amount = ZERO_DECIMAL.has(cur) ? String(Math.round(cents)) : (cents / 100).toFixed(2);
  return cur === 'USD' ? `$${amount}` : `${amount} ${cur}`;
}

/** "Wednesday, October 14" in the device time zone; null when unknown. */
export function formatDunningDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

/** "$150.00 and 80.00 EUR" for per-currency totals (never summed across currencies). */
export function formatDunningTotals(list: MoneyTotal[]): string | null {
  const parts = list.map((t) => formatDunningAmount(t.amount_cents, t.currency)).filter((x): x is string => Boolean(x));
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
