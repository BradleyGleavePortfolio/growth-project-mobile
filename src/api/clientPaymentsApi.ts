/**
 * clientPaymentsApi — typed mobile client for the client-facing payments
 * surface from backend PR #215 (packages + checkout + dunning).
 *
 * Endpoints consumed:
 *   GET  /v1/clients/me/coach/packages   — packages the coach offers this client
 *   POST /v1/checkout/sessions           — create Stripe Checkout session
 *   GET  /v1/checkout/entitlement        — current entitlement_active flag
 *   GET  /v1/checkout/purchases          — recent purchases (for status mapping)
 *
 * Same envelope convention as `coachConnectApi`: 404 / 501 collapses into
 * `{ ok: false, reason: 'not_configured' }` so the screen renders a calm
 * "your coach has not enabled checkout yet" empty state instead of a crash.
 *
 * Checkout return / cancel deep-links are handled by the navigator
 * (`com.growthproject.app://checkout/success` and
 * `com.growthproject.app://checkout/cancel`); this module only speaks HTTP.
 */

import api from '../services/api';
import type { AxiosResponse } from 'axios';

/**
 * A package as the client sees it. Subset of the coach-side CoachPackage
 * — the client never sees subscriber counts or sub-coach attribution.
 */
export interface ClientCoachPackage {
  id: string;
  name: string;
  description: string | null;
  type: 'one_time' | 'recurring';
  /** Major-unit price (e.g. 199.00). */
  price: number;
  currency: string;
  interval: 'month' | 'year' | null;
  /** Optional trial in days (recurring only). */
  trial_days: number | null;
  /** Coach-supplied bullet points. Already plain text — never assemble HTML on the client. */
  features: string[];
  /**
   * When set, this is the client's current package. Used by the screen to
   * render a "Current plan" pill and disable the buy CTA.
   */
  is_current: boolean;
}

export interface CheckoutSession {
  /** Stripe-hosted Checkout URL — open in a system browser sheet. */
  url: string;
  /** Session id, surfaced for logging only. */
  session_id: string;
  /** Useful when the client returns via the success deep-link and we want to confirm. */
  expires_at: string;
}

/**
 * Subscription / dunning state for the signed-in client. Mirrors the
 * coach billing shape but reports the client's view (their own subscription
 * to their coach, not the coach's own SaaS subscription).
 */
export interface ClientPaymentStatus {
  /**
   * - 'active'    — subscription healthy
   * - 'trialing'  — inside trial window
   * - 'past_due'  — last invoice failed, in retry window
   * - 'canceled'  — subscription ended
   * - 'none'      — no subscription yet (coach manages access externally)
   */
  state: 'active' | 'trialing' | 'past_due' | 'canceled' | 'none';
  package_name: string | null;
  current_period_end: string | null;
  trial_ends_at: string | null;
  /**
   * Set when state === 'past_due'. The backend renders a human summary
   * (e.g. "Your last payment failed on May 12. Update your card to keep access.")
   * and the URL of a Stripe-hosted card-update page. The app renders the
   * summary verbatim — no client-side copy assembly.
   */
  dunning: {
    summary: string;
    update_card_url: string | null;
    /** ISO timestamp the coach loses access if the card isn't updated. */
    grace_until: string | null;
  } | null;
}

export type PaymentsResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: 'not_configured' }
  | { ok: false; reason: 'error'; message: string };

function isNotConfigured(err: unknown): boolean {
  const e = err as { response?: { status?: number } } | undefined;
  const status = e?.response?.status;
  return status === 404 || status === 501;
}

function wrap<T>(p: Promise<AxiosResponse<T>>): Promise<PaymentsResult<T>> {
  return p
    .then((r) => ({ ok: true as const, data: r.data }))
    .catch((err) => {
      if (isNotConfigured(err)) return { ok: false as const, reason: 'not_configured' as const };
      const message =
        (err as { message?: string })?.message ?? 'Failed to load — try again.';
      return { ok: false as const, reason: 'error' as const, message };
    });
}

// Shape of a row in the backend's GET /v1/checkout/purchases response. The
// purchase `status` field is mapped to `ClientPaymentStatus.state` in
// `getPaymentStatus()` below.
interface RawPurchase {
  id?: string;
  status?: string;
  package_name?: string | null;
  current_period_end?: string | null;
  trial_ends_at?: string | null;
}

interface RawPurchaseListResponse {
  purchases?: RawPurchase[];
  next_cursor?: string | null;
}

function mapPurchaseToStatus(p: RawPurchase | undefined): ClientPaymentStatus {
  const known = new Set(['active', 'trialing', 'past_due', 'canceled']);
  const raw = (p?.status ?? 'none').toLowerCase();
  const state: ClientPaymentStatus['state'] = known.has(raw)
    ? (raw as ClientPaymentStatus['state'])
    : raw === 'payment_failed'
      ? 'past_due'
      : 'none';
  return {
    state,
    package_name: p?.package_name ?? null,
    current_period_end: p?.current_period_end ?? null,
    trial_ends_at: p?.trial_ends_at ?? null,
    dunning: null,
  };
}

export const clientPaymentsApi = {
  getPackages: (): Promise<PaymentsResult<ClientCoachPackage[]>> =>
    wrap(
      api
        .get<{ packages: ClientCoachPackage[] } | ClientCoachPackage[]>(
          '/v1/clients/me/coach/packages',
        )
        .then((r) => ({
          ...r,
          data: Array.isArray(r.data)
            ? r.data
            : (r.data as { packages: ClientCoachPackage[] }).packages ?? [],
        })),
    ),

  /**
   * Creates a Stripe Checkout session for the given package. The caller
   * opens the returned URL in a browser sheet; on success Stripe redirects
   * to `com.growthproject.app://checkout/success?session_id=...`, on cancel
   * to `com.growthproject.app://checkout/cancel`. The navigator handles
   * both deep links.
   */
  createCheckoutSession: (
    packageId: string,
  ): Promise<PaymentsResult<CheckoutSession>> =>
    wrap(
      api.post<CheckoutSession>('/v1/checkout/sessions', {
        package_id: packageId,
        success_url:
          'com.growthproject.app://checkout/success?session_id={CHECKOUT_SESSION_ID}',
        cancel_url: 'com.growthproject.app://checkout/cancel',
      }),
    ),

  /**
   * Returns the client's current subscription status. The backend exposes
   * the most recent purchase via GET /v1/checkout/purchases?limit=1; we
   * map the row's `status` field to ClientPaymentStatus.state. Empty
   * purchase list → state: 'none'. The dunning sub-object is not currently
   * surfaced by the entitlement / purchases endpoints, so we return null
   * here; the screen falls back to the generic past_due copy.
   */
  getPaymentStatus: (): Promise<PaymentsResult<ClientPaymentStatus>> =>
    wrap(
      api
        .get<RawPurchaseListResponse>('/v1/checkout/purchases?limit=1')
        .then((r) => ({
          ...r,
          data: mapPurchaseToStatus(r.data?.purchases?.[0]),
        })),
    ),

  /**
   * Called on the checkout success deep-link to confirm the session
   * actually granted entitlement before the UI flips to "access granted".
   * Stripe webhooks may lag the redirect by a beat — the entitlement
   * endpoint is the source of truth. We then surface the most recent
   * purchase shape so the screen can render `package_name` etc.
   *
   * If entitlement is still pending, we collapse to state 'none' so the
   * caller can render the "payment received — pending" copy instead of
   * "active".
   */
  confirmCheckoutSession: async (
    _sessionId: string,
  ): Promise<PaymentsResult<ClientPaymentStatus>> => {
    const entitlement = await wrap(
      api.get<{ entitlement_active: boolean }>('/v1/checkout/entitlement'),
    );
    if (!entitlement.ok) return entitlement;
    const purchases = await wrap(
      api.get<RawPurchaseListResponse>('/v1/checkout/purchases?limit=1'),
    );
    if (!purchases.ok) return purchases;
    const mapped = mapPurchaseToStatus(purchases.data?.purchases?.[0]);
    // If Stripe accepted the charge but the backend hasn't flipped the
    // entitlement yet, force state 'none' so the screen renders the
    // "payment received — confirmation pending" path rather than "active".
    if (!entitlement.data.entitlement_active) {
      return { ok: true, data: { ...mapped, state: 'none' } };
    }
    return { ok: true, data: mapped };
  },
};
