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

const EMPTY: ClientDunningStatus = {
  enabled: false,
  state: 'none',
  purchase_id: null,
  amount_cents: null,
  currency: null,
  failed_at: null,
  lockout_at: null,
  locked_at: null,
  day: null,
  coach_name: null,
  card_last4: null,
  card_brand: null,
};

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Defensive normaliser: an unexpected shape degrades to "no banner". */
export function normalizeDunningStatus(raw: unknown): ClientDunningStatus {
  if (!raw || typeof raw !== 'object') return EMPTY;
  const r = raw as Record<string, unknown>;
  const state: DunningState =
    r.state === 'past_due' || r.state === 'locked' ? r.state : 'none';
  return {
    enabled: r.enabled === true,
    state,
    purchase_id: str(r.purchase_id),
    amount_cents: num(r.amount_cents),
    currency: str(r.currency),
    failed_at: str(r.failed_at),
    lockout_at: str(r.lockout_at),
    locked_at: str(r.locked_at),
    day: num(r.day),
    coach_name: str(r.coach_name),
    card_last4: str(r.card_last4),
    card_brand: str(r.card_brand),
  };
}

/**
 * Native card update (OR-110-2). Backend: ClientBillingController.
 *  1. POST /v1/checkout/payment-method/setup-intent -> a SetupIntent on the
 *     client's Stripe customer (platform account) + an ephemeral key.
 *  2. PaymentSheet collects and confirms the card on the device.
 *  3. POST /v1/checkout/payment-method/confirm -> the backend makes it the
 *     default for the customer and every live subscription and, while the
 *     client is in dunning, pays the open invoice right away (1A).
 */
export interface CardSetup {
  setup_intent_id: string;
  setup_intent_client_secret: string;
  ephemeral_key: string;
  customer_id: string;
  publishable_key: string | null;
  merchant_display_name: string;
}

export type CardUpdateOutcome = 'paid' | 'saved' | 'requires_action' | 'declined' | 'processing';

export interface CardUpdateResponse {
  outcome: CardUpdateOutcome;
  card_last4: string | null;
  card_brand: string | null;
  /** Integer minor units charged by this request. */
  amount_paid_cents: number;
  /** Integer minor units still open after this request. */
  amount_due_cents: number;
  currency: string | null;
  access_restored: boolean;
  payment_intent_client_secret: string | null;
  decline_code: string | null;
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
}

/** Thrown when a 2xx body is missing a field the flow cannot continue without. */
export class DunningResponseShapeError extends Error {
  constructor(readonly route: string) {
    super('DUNNING_RESPONSE_SHAPE');
  }
}

function int(v: unknown): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0;
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

const OUTCOMES: ReadonlySet<string> = new Set(['paid', 'saved', 'requires_action', 'declined', 'processing']);

export function normalizeCardUpdate(raw: unknown): CardUpdateResponse {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (typeof r.outcome !== 'string' || !OUTCOMES.has(r.outcome)) {
    throw new DunningResponseShapeError('payment-method/confirm');
  }
  const card = (r.card && typeof r.card === 'object' ? r.card : {}) as Record<string, unknown>;
  return {
    outcome: r.outcome as CardUpdateOutcome,
    card_last4: str(card.last4),
    card_brand: str(card.brand),
    amount_paid_cents: int(r.amount_paid_cents),
    amount_due_cents: int(r.amount_due_cents),
    currency: str(r.currency),
    access_restored: r.access_restored === true,
    payment_intent_client_secret: str(r.payment_intent_client_secret),
    decline_code: str(r.decline_code),
  };
}

const CANCEL_OUTCOMES: ReadonlySet<string> = new Set(['ended', 'scheduled', 'already_ended']);

export function normalizeCancelPlan(raw: unknown): CancelPlanResponse {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const purchaseId = str(r.purchase_id);
  if (typeof r.outcome !== 'string' || !CANCEL_OUTCOMES.has(r.outcome) || !purchaseId) {
    throw new DunningResponseShapeError('subscriptions/cancel');
  }
  return {
    outcome: r.outcome as CancelOutcome,
    purchase_id: purchaseId,
    access_ends_at: str(r.access_ends_at),
    voided_invoice_count: int(r.voided_invoice_count),
    voided_amount_cents: int(r.voided_amount_cents),
    currency: str(r.currency),
  };
}

export const dunningApi = {
  /** Throws the axios error on failure; callers map it with describeDunningError. */
  async getStatus(): Promise<ClientDunningStatus> {
    const res = await api.get<unknown>('/v1/checkout/dunning');
    return normalizeDunningStatus(res.data);
  },
  /** Step 1 of the native card update. One idempotency key per tap. */
  async createCardSetup(idempotencyKey: string = generateIdempotencyKey()): Promise<CardSetup> {
    const res = await api.post<unknown>('/v1/checkout/payment-method/setup-intent', {
      idempotency_key: idempotencyKey,
    });
    return normalizeCardSetup(res.data);
  },
  /** Step 3: make the confirmed card the default and (in dunning) pay now. Safe to repeat. */
  async confirmCardUpdate(setupIntentId: string): Promise<CardUpdateResponse> {
    const res = await api.post<unknown>('/v1/checkout/payment-method/confirm', {
      setup_intent_id: setupIntentId,
    });
    return normalizeCardUpdate(res.data);
  },
  /**
   * End a plan. In dunning (2A) the unpaid invoice is voided and access ends
   * now; otherwise (option A) access runs to the end of the paid period.
   */
  async cancelPlan(purchaseId: string): Promise<CancelPlanResponse> {
    const res = await api.post<unknown>(
      `/v1/checkout/subscriptions/${encodeURIComponent(purchaseId)}/cancel`,
      {},
    );
    return normalizeCancelPlan(res.data);
  },
};

/** Stripe zero-decimal currencies: the minor unit is the whole unit. */
const ZERO_DECIMAL = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
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
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}
