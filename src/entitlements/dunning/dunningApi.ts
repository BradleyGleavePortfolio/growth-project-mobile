import api from '../../services/api';

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
  };
}

export const dunningApi = {
  /** Throws the axios error on failure; callers map it with describeDunningError. */
  async getStatus(): Promise<ClientDunningStatus> {
    const res = await api.get<unknown>('/v1/checkout/dunning');
    return normalizeDunningStatus(res.data);
  },
  /** Mint a Stripe Billing Portal session (update card / pay the open invoice). */
  async createPortalUrl(): Promise<string> {
    const res = await api.post<{ url?: unknown }>('/v1/checkout/billing-portal', {});
    const url = res.data?.url;
    if (typeof url !== 'string' || url.length === 0) {
      throw new Error('PORTAL_URL_MISSING');
    }
    return url;
  },
};

/** "$150.00" for USD, "150.00 EUR" otherwise; null when the amount is unknown. */
export function formatDunningAmount(cents: number | null, currency: string | null): string | null {
  if (cents == null) return null;
  const cur = (currency ?? 'usd').toUpperCase();
  const amount = (cents / 100).toFixed(2);
  return cur === 'USD' ? `$${amount}` : `${amount} ${cur}`;
}

/** "Wednesday, October 14" in the device time zone; null when unknown. */
export function formatDunningDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}
