import api from '../../services/api';

/**
 * R-DISPUTE-PAUSE, coach side: a bank dispute or inquiry on a client's
 * recurring plan ends the client's access and pauses billing. Nothing ends
 * that pause except the plan's own coach restarting it.
 *
 * Reads (coach routes, own roster only):
 *   GET  /v1/coach/purchases                       roster purchases (cursor)
 *   GET  /v1/coach/payments/purchases/:id          one purchase + its dunning row
 * Write:
 *   POST /v1/coach/purchases/:id/dispute-restart   200 { restarted: true }
 *     404 PURCHASE_NOT_FOUND; 409 PLAN_NOT_DISPUTE_PAUSED | PLAN_ENDED |
 *     OTHER_LIVE_PLAN | NEW_DISPUTE | BILLING_BUSY; 503 BILLING_UNAVAILABLE.
 *
 * The Restart plan button shows only when the backend's dunning row for the
 * purchase says the plan is dispute-paused (the same test the backend's
 * restart pre-check uses).
 */

/** Backend DUNNING_V2_REVERSAL_REASON. */
export const DISPUTE_PAUSE_REASON = 'charge_disputed';
export const REFUND_PAUSE_REASON = 'charge_refunded';

/** Purchase statuses the backend treats as ended (restart refused). */
const PLAN_ENDED_STATUSES = new Set(['canceled', 'expired', 'incomplete_expired']);

/** Roster pages read per client view (100 purchases each). */
const MAX_ROSTER_PAGES = 5;

export interface DisputePausedPlan {
  purchaseId: string;
  amountCents: number | null;
  currency: string | null;
  pausedAt: string | null;
  pauseReason?: 'refund' | 'dispute';
}

interface RosterPurchase {
  id?: unknown;
  client_user_id?: unknown;
  billing_type?: unknown;
  entitlement_active?: unknown;
  status?: unknown;
}

interface PurchaseDetail {
  purchase?: {
    id?: unknown;
    status?: unknown;
    billing_type?: unknown;
    amount_cents?: unknown;
    currency?: unknown;
  } | null;
  dunning?: {
    status?: unknown;
    last_failure_reason?: unknown;
    entered_at?: unknown;
  } | null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** True when the backend reports this purchase as paused by a dispute or inquiry. */
export function isDisputePaused(detail: PurchaseDetail | null | undefined): boolean {
  const p = detail?.purchase;
  const d = detail?.dunning;
  if (!p || !d) return false;
  if (p.billing_type !== 'recurring') return false;
  if (typeof p.status === 'string' && PLAN_ENDED_STATUSES.has(p.status)) return false;
  return d.status === 'active' &&
    (d.last_failure_reason === DISPUTE_PAUSE_REASON || d.last_failure_reason === REFUND_PAUSE_REASON) &&
    str(d.entered_at) !== null;
}

/** A roster row that could be dispute-paused (recurring, access off, not ended). */
function isCandidate(row: RosterPurchase, clientUserId: string): boolean {
  return (
    row.client_user_id === clientUserId &&
    row.billing_type === 'recurring' &&
    row.entitlement_active === false &&
    !(typeof row.status === 'string' && PLAN_ENDED_STATUSES.has(row.status)) &&
    str(row.id) !== null
  );
}

/** Purchases of this client that the backend reports as dispute-paused. */
export async function loadDisputePausedPlans(clientUserId: string): Promise<DisputePausedPlan[]> {
  const ids: string[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_ROSTER_PAGES; page += 1) {
    const res: { data?: { purchases?: unknown; next_cursor?: unknown } } = await api.get(
      '/v1/coach/purchases',
      { params: cursor ? { limit: 100, cursor } : { limit: 100 } },
    );
    const rows = Array.isArray(res.data?.purchases) ? (res.data?.purchases as RosterPurchase[]) : [];
    for (const row of rows) if (isCandidate(row, clientUserId)) ids.push(row.id as string);
    cursor = str(res.data?.next_cursor);
    if (!cursor) break;
  }
  const out: DisputePausedPlan[] = [];
  for (const id of ids) {
    const res: { data?: PurchaseDetail } = await api.get(
      `/v1/coach/payments/purchases/${encodeURIComponent(id)}`,
    );
    const detail = res.data;
    if (!isDisputePaused(detail)) continue;
    const amount = detail?.purchase?.amount_cents;
    out.push({
      purchaseId: id,
      amountCents: typeof amount === 'number' ? amount : null,
      currency: str(detail?.purchase?.currency),
      pausedAt: str(detail?.dunning?.entered_at),
      ...(detail?.dunning?.last_failure_reason === REFUND_PAUSE_REASON ? { pauseReason: 'refund' as const } : {}),
    });
  }
  return out;
}

export type RestartOutcome =
  | { ok: true; message: string }
  | { ok: false; code: string; message: string; final: boolean };

export const RESTART_SUCCESS =
  'Plan restarted. Billing has resumed on its usual schedule and the client has access again.';

/** One plain sentence per backend refusal code. `final`: the plan cannot be restarted from here. */
const REFUSAL_COPY: Record<string, { message: string; final: boolean }> = {
  PURCHASE_NOT_FOUND: {
    message:
      'That plan is not on your roster, so nothing was changed. Pull down to refresh, then try again.',
    final: true,
  },
  PLAN_NOT_DISPUTE_PAUSED: {
    message:
      'This plan is not paused by a refund, payment dispute or inquiry, so there is nothing to restart. Pull down to refresh.',
    final: true,
  },
  PLAN_ENDED: {
    message: 'This plan has ended, so it cannot be restarted. The client can buy the package again.',
    final: true,
  },
  OTHER_LIVE_PLAN: {
    message:
      'The client already has another active plan for this package, so restarting this one would bill them twice. Nothing was changed.',
    final: true,
  },
  NEW_DISPUTE: {
    message:
      'The bank opened another payment dispute or inquiry on this plan, so it stays paused and nothing was charged.',
    final: false,
  },
  BILLING_BUSY: {
    message:
      'Billing for this plan is being updated right now, so nothing was changed. Try again in a minute.',
    final: false,
  },
  BILLING_UNAVAILABLE: {
    message:
      'Billing could not be reached, so the plan stays paused and nothing was charged. Try again in a few minutes.',
    final: false,
  },
};

const NO_ANSWER =
  'No answer came back from the server, so the result is not known yet. Pull down to refresh to see whether the plan restarted.';
const UNKNOWN_REFUSAL =
  'The plan could not be restarted, so it stays paused and nothing was charged. Pull down to refresh, then try again.';

/** Map a failed restart call to its one-sentence outcome. */
export function restartRefusal(err: unknown): Extract<RestartOutcome, { ok: false }> {
  const response = (err as { response?: { status?: number; data?: unknown } } | null)?.response;
  if (!response) return { ok: false, code: 'NO_RESPONSE', message: NO_ANSWER, final: false };
  const body = (response.data && typeof response.data === 'object' ? response.data : {}) as {
    code?: unknown;
    error?: unknown;
    message?: unknown;
  };
  const code = str(body.code) ?? str(body.error) ?? `HTTP_${response.status ?? 'ERROR'}`;
  const known = REFUSAL_COPY[code];
  if (known) return { ok: false, code, ...known };
  const server = typeof body.message === 'string' ? body.message.trim() : '';
  return { ok: false, code, message: server || UNKNOWN_REFUSAL, final: false };
}

/** Restart a dispute-paused plan. Never throws. */
export async function restartDisputePausedPlan(purchaseId: string): Promise<RestartOutcome> {
  try {
    const res: { data?: { restarted?: unknown } } = await api.post(
      `/v1/coach/purchases/${encodeURIComponent(purchaseId)}/dispute-restart`,
      {},
    );
    if (res.data?.restarted === true) return { ok: true, message: RESTART_SUCCESS };
    return { ok: false, code: 'UNEXPECTED_RESPONSE', message: NO_ANSWER, final: false };
  } catch (err) {
    return restartRefusal(err);
  }
}
