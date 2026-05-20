/**
 * clientPaymentsApi — typed mobile client for the client-facing payments
 * surface from backend PR #215 (packages + checkout + dunning).
 *
 * Endpoints consumed:
 *   GET  /v1/clients/me/coach/packages           — packages the coach offers this client
 *   GET  /v1/clients/me/coach/payment-status     — subscription + dunning state
 *   POST /v1/clients/me/coach/checkout           — create Stripe Checkout session
 *   POST /v1/clients/me/coach/checkout/confirm   — confirm a returned session
 *   POST /v1/clients/me/coach/billing-portal     — Stripe Billing Portal URL
 *   GET  /v1/clients/me/coach/entitlement        — current entitlement_active flag
 *
 * Same envelope convention as `coachConnectApi`: 404 / 501 collapses into
 * `{ ok: false, reason: 'not_configured' }` so the screen renders a calm
 * "your coach has not enabled checkout yet" empty state instead of a crash.
 *
 * Checkout return / cancel deep-links are handled by the navigator
 * (`tgp://checkout/success` and `tgp://checkout/cancel`); this module only
 * speaks HTTP.
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

function normalizeClientPackage(raw: Record<string, unknown>): ClientCoachPackage {
  const amountCents = typeof raw.amount_cents === 'number' ? raw.amount_cents : null;
  const price = typeof raw.price === 'number' ? raw.price : (amountCents != null ? amountCents / 100 : 0);
  return {
    id: String(raw.id ?? ''),
    name: String(raw.name ?? ''),
    description: (raw.description as string | null) ?? null,
    type: (raw.type as 'one_time' | 'recurring') ?? (raw.billing_type as 'one_time' | 'recurring') ?? 'one_time',
    price,
    currency: String(raw.currency ?? 'usd'),
    interval: (raw.interval as 'month' | 'year' | null) ?? null,
    trial_days: null,
    features: Array.isArray(raw.features) ? (raw.features as string[]) : [],
    is_current: Boolean(raw.is_current ?? false),
  };
}

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

export const clientPaymentsApi = {
  /**
   * Creates a Stripe Billing Portal session for the signed-in client.
   * Returns a Stripe-hosted URL the app should open in an in-app browser.
   */
  createBillingPortalSession: (): Promise<PaymentsResult<{ url: string }>> =>
    wrap(api.post<{ url: string }>('/v1/clients/me/coach/billing-portal', {})),

  getPackages: (): Promise<PaymentsResult<ClientCoachPackage[]>> =>
    wrap(
      api
        .get<{ packages: unknown[] } | unknown[]>(
          '/v1/clients/me/coach/packages',
        )
        .then((r) => {
          const raw: unknown[] = Array.isArray(r.data)
            ? r.data
            : (r.data as { packages: unknown[] }).packages ?? [];
          return {
            ...r,
            data: raw.map((item) =>
              normalizeClientPackage(item as Record<string, unknown>),
            ),
          };
        }),
    ),

  /**
   * Creates a Stripe Checkout session for the given package. The caller
   * opens the returned URL in a browser sheet; on success Stripe redirects
   * to `tgp://checkout/success?session_id={CHECKOUT_SESSION_ID}`, on cancel
   * to `tgp://checkout/cancel`. The navigator handles both deep links.
   */
  createCheckoutSession: (
    packageId: string,
  ): Promise<PaymentsResult<CheckoutSession>> =>
    wrap(
      api.post<CheckoutSession>('/v1/clients/me/coach/checkout', {
        package_id: packageId,
        success_url:
          'tgp://checkout/success?session_id={CHECKOUT_SESSION_ID}',
        cancel_url: 'tgp://checkout/cancel',
      }),
    ),

  /**
   * Returns the client's current subscription + dunning status. Backend
   * renders the dunning summary copy verbatim; the app does not assemble
   * any client-side billing copy.
   */
  getPaymentStatus: (): Promise<PaymentsResult<ClientPaymentStatus>> =>
    wrap(api.get<ClientPaymentStatus>('/v1/clients/me/coach/payment-status')),

  /**
   * Returns the client's current entitlement status. Used by
   * EntitlementProvider to gate paid features.
   */
  async getEntitlement(): Promise<{ active: boolean; reason?: string }> {
    const res = await api.get('/v1/clients/me/coach/entitlement');
    return res.data;
  },

  /**
   * Called on the checkout success deep-link to confirm the session
   * actually granted entitlement before the UI flips to "access granted".
   * Returns the full ClientPaymentStatus directly from the backend.
   */
  confirmCheckoutSession: (
    sessionId: string,
  ): Promise<PaymentsResult<ClientPaymentStatus>> =>
    wrap(
      api.post<ClientPaymentStatus>(
        '/v1/clients/me/coach/checkout/confirm',
        { session_id: sessionId },
      ),
    ),
};
