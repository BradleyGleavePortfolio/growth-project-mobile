/**
 * clientPaymentsApi — typed mobile client for the client-facing payments
 * surface from backend PR #215 (packages + checkout + dunning).
 *
 * Endpoints consumed:
 *   GET  /v1/clients/me/coach/packages          — packages the coach offers this client
 *   POST /v1/clients/me/coach/checkout          — create Stripe Checkout session
 *   GET  /v1/clients/me/payment-status          — current subscription / dunning state
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
  getPackages: (): Promise<PaymentsResult<ClientCoachPackage[]>> =>
    wrap(api.get<ClientCoachPackage[]>('/v1/clients/me/coach/packages')),

  /**
   * Creates a Stripe Checkout session for the given package. The caller
   * opens the returned URL in a browser sheet; on success Stripe redirects
   * to `tgp://checkout/success?session_id=...`, on cancel to
   * `tgp://checkout/cancel`. The navigator handles both deep links.
   */
  createCheckoutSession: (
    packageId: string,
  ): Promise<PaymentsResult<CheckoutSession>> =>
    wrap(
      api.post<CheckoutSession>('/v1/clients/me/coach/checkout', {
        package_id: packageId,
        success_url: 'tgp://checkout/success?session_id={CHECKOUT_SESSION_ID}',
        cancel_url: 'tgp://checkout/cancel',
      }),
    ),

  getPaymentStatus: (): Promise<PaymentsResult<ClientPaymentStatus>> =>
    wrap(api.get<ClientPaymentStatus>('/v1/clients/me/payment-status')),

  /**
   * Fetched on the checkout success deep-link to confirm the session
   * actually completed (Stripe redirects with `session_id` in the URL but
   * the client should still ask the backend to verify before showing
   * "access granted" copy — webhooks may not have landed yet).
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
