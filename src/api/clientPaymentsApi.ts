/**
 * clientPaymentsApi — typed mobile client for the client-facing payments
 * surface.
 *
 * Real backend routes (CheckoutController, mounted at `/v1/checkout/*`):
 *   POST /v1/checkout/sessions                   — create Stripe Checkout session
 *   POST /v1/checkout/billing-portal             — Stripe Billing Portal URL
 *   GET  /v1/checkout/sessions/:id/confirm       — confirm a returned session
 *   GET  /v1/checkout/entitlement                — current entitlement_active flag
 *
 * Plus the client packages list (separate controller, not CheckoutController):
 *   GET  /v1/clients/me/coach/packages           — packages the coach offers this client
 *
 * History — round 1: the four checkout-shaped calls (sessions, confirm,
 * payment-status, billing-portal) previously pointed at five
 * `/v1/clients/me/coach/*` paths that do NOT exist on the backend. Every
 * call 404'd; the 404 was swallowed into a misleading "not configured"
 * empty state so the regression sat undetected for weeks.
 *
 * History — round 2 (this revision, per audit): the first-pass fix
 * invented a `GET /v1/checkout/status` route that ALSO does not exist
 * on the backend, and missed rewiring `getEntitlement`
 * (`/v1/clients/me/coach/entitlement` → `/v1/checkout/entitlement`).
 * The audit found the backend `checkout.controller.ts` exposes ONLY the
 * four routes listed above — there is no `/status` route. `getPaymentStatus`
 * is therefore derived from `getEntitlement` + `getPackages` (the only
 * authoritative signals available to the client today): backend dunning /
 * period-end / trial-end data is not exposed and is reported as null
 * rather than fabricated. When the backend ships a real status route this
 * derivation is the single place to replace.
 *
 * Envelope: only a 501 collapses into
 * `{ ok: false, reason: 'not_configured' }`. A 404 is treated as a real
 * transport/path failure and surfaced as `{ ok: false, reason: 'error' }`
 * so the UI can offer a retry instead of silently telling the buyer their
 * coach hasn't enabled payments. The true "no plans / not connected"
 * state is derived from an empty package list or `entitlement.active === false`
 * — never from a 404 on a broken route.
 *
 * Checkout return / cancel deep-links are handled by the navigator
 * (`com.growthproject.app://checkout/success` and
 * `com.growthproject.app://checkout/cancel`); this module only speaks HTTP.
 */

import api from '../services/api';
import type { AxiosResponse } from 'axios';
import { generateIdempotencyKey } from '../utils/idempotency';

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
  /**
   * Stripe-hosted Checkout URL — must be opened in the branded in-app
   * `BrandedCheckoutWebView` so the flow stays inside the app (Rule 8 /
   * Apple Rule 3.1.3(b)/(e) B2B exemption). Never open a payment URL
   * outside the branded webview on a payment surface.
   */
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
    /**
     * Client-side flag set when the past-due Billing-Portal mint fallback
     * failed (network / 5xx / 404). The UI uses this to render a
     * "Update card unavailable — contact support" notice instead of
     * silently dropping the CTA, which would leave the user with a past-due
     * banner and no recovery path (audit round 3 residual).
     */
    portal_unavailable?: boolean;
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

/**
 * "Not configured" is a server-side signal that the endpoint exists but the
 * backend has explicitly declined to serve it on this deployment (e.g. the
 * payments module is gated off). 501 Not Implemented is the only status we
 * accept as that signal.
 *
 * A 404 is NOT not_configured — it almost always means the client is
 * pointing at the wrong route, which is exactly the regression this PR
 * fixes. Treating 404 as "not_configured" silently masked four broken
 * checkout routes for weeks; the buyer saw "your coach hasn't enabled
 * payments yet" when the real cause was a typo in the mobile path.
 * 404 (and every other transport/HTTP failure) is surfaced as a real,
 * retryable error so the UI can recover or the user can see what's wrong.
 */
function isNotConfigured(err: unknown): boolean {
  const e = err as { response?: { status?: number } } | undefined;
  return e?.response?.status === 501;
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
   *
   * Route: `POST /v1/checkout/billing-portal` (CheckoutController). The
   * previous `/v1/clients/me/coach/billing-portal` path did not exist on
   * the backend and 404'd on every call.
   */
  createBillingPortalSession: (): Promise<PaymentsResult<{ url: string }>> =>
    wrap(api.post<{ url: string }>('/v1/checkout/billing-portal', {})),

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
   * opens the returned URL in the branded in-app `BrandedCheckoutWebView`
   * screen; on success Stripe redirects to
   * `com.growthproject.app://checkout/success?session_id={CHECKOUT_SESSION_ID}`,
   * on cancel to `com.growthproject.app://checkout/cancel`. The deep-link
   * scheme must match the exact-match gate in
   * `BrandedCheckoutWebViewScreen.parseReturnDeepLink` so the webview
   * dismisses on return; if these drift, payment looks "stuck" after a
   * successful charge.
   *
   * Route: `POST /v1/checkout/sessions` (CheckoutController). Same
   * endpoint `publicPackagesApi.createCheckoutSession` (used by the
   * working `PackageCheckoutScreen`) hits. The previous
   * `/v1/clients/me/coach/checkout` path did not exist on the backend
   * and 404'd on every buy. Every mutation carries a client-generated
   * `Idempotency-Key` (rule R19) so retries / double-taps don't mint
   * duplicate Checkout sessions.
   */
  createCheckoutSession: (
    packageId: string,
  ): Promise<PaymentsResult<CheckoutSession>> =>
    wrap(
      api.post<CheckoutSession>(
        '/v1/checkout/sessions',
        {
          package_id: packageId,
          success_url:
            'com.growthproject.app://checkout/success?session_id={CHECKOUT_SESSION_ID}',
          cancel_url: 'com.growthproject.app://checkout/cancel',
        },
        { headers: { 'Idempotency-Key': generateIdempotencyKey() } },
      ),
    ),

  /**
   * Returns the client's current subscription state for the packages
   * screen.
   *
   * IMPORTANT — derived, not fetched. The backend `CheckoutController`
   * does NOT expose a `/status` route (audit verified the controller
   * exposes only sessions, sessions/:id/confirm, billing-portal, and
   * entitlement). To avoid a third generation of dead-route bugs, status
   * is composed from the two authoritative signals the controller DOES
   * expose:
   *
   *   • `GET /v1/checkout/entitlement` — single source of truth for
   *     whether the client currently has paid access (R20).
   *   • `GET /v1/clients/me/coach/packages` — the client's package list
   *     also carries an `is_current` flag, naming the package the user
   *     is on right now.
   *
   * Fields the backend doesn't yet surface (period_end, trial_ends_at,
   * past-due dunning summary / update_card_url) are reported as null so
   * the UI degrades honestly rather than rendering invented values
   * (rule 18). When the backend ships a real status route, this whole
   * method is the single point to replace.
   *
   * Transport contract: if either upstream call returns an explicit
   * `not_configured` (501), the whole call returns `not_configured`. If
   * either fails with a real transport error (404, 5xx, network), the
   * whole call returns `reason: 'error'` and the UI surfaces it as
   * retryable (rule 9) rather than masking it as "not enabled yet" — the
   * exact regression PR-1 round 1 was supposed to fix.
   */
  getPaymentStatus: async (): Promise<PaymentsResult<ClientPaymentStatus>> => {
    const [entitlementResult, packagesResult] = await Promise.all([
      clientPaymentsApi.getEntitlement(),
      clientPaymentsApi.getPackages(),
    ]);

    // Explicit "backend has declined to serve this on this deployment"
    // signal wins — same envelope semantics as before so screens that
    // already gate on `reason: 'not_configured'` continue to work.
    if (!entitlementResult.ok && entitlementResult.reason === 'not_configured') {
      return entitlementResult;
    }
    if (!packagesResult.ok && packagesResult.reason === 'not_configured') {
      return packagesResult;
    }
    // Any other failure (404, 5xx, network) bubbles up as a real,
    // retryable error. Entitlement is the load-bearing signal; if it
    // failed, we cannot honestly report state — fail loud, not silent.
    if (!entitlementResult.ok) return entitlementResult;
    if (!packagesResult.ok) return packagesResult;

    const active = entitlementResult.data.active === true;
    const currentPackage = packagesResult.data.find((p) => p.is_current) ?? null;
    const state: ClientPaymentStatus['state'] = active ? 'active' : 'none';

    return {
      ok: true,
      data: {
        state,
        package_name: currentPackage?.name ?? null,
        // Backend does not yet expose these on any route. Null tells the
        // UI to omit the rows instead of fabricating values (rule 18).
        current_period_end: null,
        trial_ends_at: null,
        // No status route → no past-due signal. Past-due dunning is
        // currently unreachable from page-load; once the backend ships a
        // real status route this is where the dunning object reappears.
        dunning: null,
      },
    };
  },

  /**
   * Returns the client's current entitlement status. Used by
   * EntitlementProvider to gate paid features. Conforms to the standard
   * PaymentsResult envelope so callers can distinguish a configured-but-
   * inactive state from a transport failure (the latter must fail closed —
   * see ProtectedScreen).
   *
   * Route: `GET /v1/checkout/entitlement` (CheckoutController). The
   * previous `/v1/clients/me/coach/entitlement` path does not exist on
   * the backend — every entitlement check was 404'ing and (per
   * `EntitlementProvider.refreshEntitlement`) fail-closing the whole app
   * for paying clients. This was the fifth dead route the first pass
   * missed (audit round 2).
   */
  getEntitlement: (): Promise<PaymentsResult<{ active: boolean; reason?: string }>> =>
    wrap(api.get<{ active: boolean; reason?: string }>('/v1/checkout/entitlement')),

  /**
   * Called on the checkout success deep-link to confirm the session
   * actually granted entitlement before the UI flips to "access granted".
   * Returns the full ClientPaymentStatus directly from the backend.
   *
   * Route: `GET /v1/checkout/sessions/:id/confirm` (CheckoutController).
   * The previous `POST /v1/clients/me/coach/checkout/confirm` had both a
   * wrong verb AND a wrong path — every successful charge stuck in
   * "confirmation pending" forever. The real endpoint is idempotent (the
   * session id is the dedup key on the server side), so it does not
   * require a client-supplied Idempotency-Key header.
   */
  confirmCheckoutSession: (
    sessionId: string,
  ): Promise<PaymentsResult<ClientPaymentStatus>> =>
    wrap(
      api.get<ClientPaymentStatus>(
        `/v1/checkout/sessions/${encodeURIComponent(sessionId)}/confirm`,
      ),
    ),
};
