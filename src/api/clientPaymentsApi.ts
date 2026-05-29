/**
 * clientPaymentsApi — typed mobile client for the client-facing payments
 * surface.
 *
 * Real backend routes (verified against
 * `growth-project-backend/src/checkout/checkout.controller.ts` @ main,
 * cited inline below):
 *
 *   POST /v1/checkout/sessions                   — create Stripe Checkout session
 *                                                  (checkout.controller.ts:94)
 *   POST /v1/checkout/billing-portal             — Stripe Billing Portal URL
 *                                                  (checkout.controller.ts:207)
 *   GET  /v1/checkout/sessions/:id/confirm       — confirm a returned session
 *                                                  (checkout.controller.ts:236)
 *   GET  /v1/checkout/entitlement                — current entitlement flag
 *                                                  (checkout.controller.ts:168)
 *   GET  /v1/checkout/purchases                  — client's purchase history
 *                                                  (checkout.controller.ts:147)
 *
 * Plus the client packages list (separate controller, verified against
 * `growth-project-backend/src/packages/packages.controller.ts:161`):
 *   GET  /v1/clients/me/coach/packages           — packages the coach offers this client
 *
 * History — round 1: four checkout-shaped calls pointed at
 * `/v1/clients/me/coach/*` paths that don't exist on the backend; every
 * call 404'd and the 404 was swallowed as "not_configured".
 *
 * History — round 2 (per audit): the round-1 fix invented
 * `GET /v1/checkout/status` (also dead) and missed rewiring
 * `getEntitlement` (`/v1/clients/me/coach/entitlement` → `/v1/checkout/entitlement`).
 *
 * History — round 3 (THIS revision, per audit): the round-2 derivation
 * referenced a fabricated `is_current` field on the `CoachPackage` row
 * that does not exist in the backend Prisma schema
 * (`growth-project-backend/prisma/schema.prisma:2942-3000`), so the
 * "Current plan" pill and `package_name` were always null. Round 3
 * derives status from the REAL `GET /v1/checkout/purchases` response:
 * the `ClientPurchase` Prisma row carries `entitlement_active`,
 * `status`, `current_period_end`, `package_id`, `cancel_at_period_end`
 * — every field the screen needs, with the package_name joined from
 * `getPackages()` by `package_id`. No invented fields.
 *
 * Envelope: only a 501 collapses into
 * `{ ok: false, reason: 'not_configured' }`. A 404 is treated as a real
 * transport/path failure and surfaced as `{ ok: false, reason: 'error' }`
 * so the UI can offer a retry instead of silently telling the buyer their
 * coach hasn't enabled payments. The true "no plans / not connected"
 * state is derived from explicit signal — never from a 404 on a broken
 * route.
 *
 * Dunning gap: the `DunningState` table
 * (`growth-project-backend/prisma/schema.prisma:3424`) exists, but no
 * client-facing route reads it today. `dunning` is null on every page-load
 * response. The past-due banner in `ClientPackagesScreen` is wired and
 * ready; it will light up once the backend ships a dunning route.
 * TODO(backend): expose `GET /v1/checkout/dunning` (or fold dunning
 * fields into the purchases response) so the mobile past-due banner can
 * render real data instead of always-null.
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
 *
 * Field provenance (each field maps to a real column on the backend
 * `CoachPackage` Prisma model — see
 * `growth-project-backend/prisma/schema.prisma:2942-3000`):
 *   id            ← CoachPackage.id
 *   name          ← CoachPackage.name
 *   description   ← CoachPackage.description
 *   type          ← CoachPackage.billing_type  ('one_time' | 'recurring')
 *   price         ← CoachPackage.amount_cents / 100
 *   currency      ← CoachPackage.currency
 *   interval      ← CoachPackage.interval      ('month' | 'year' | null)
 *   trial_days    ← (not yet exposed by backend — always null)
 *   features      ← (not yet exposed by backend — always [])
 *
 * Round-3 audit fix: `is_current` is GONE. The backend `CoachPackage`
 * row has no such field; round 2 derived "current plan" from a fabricated
 * column, so the "Current" pill never lit up. The current package id is
 * now sourced from `ClientPaymentStatus.package_id` (joined out of the
 * `GET /v1/checkout/purchases` response), and the screen does the
 * equality check itself.
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
}

/**
 * A raw `ClientPurchase` row as returned by
 * `GET /v1/checkout/purchases`. Every field maps directly to a column
 * on the backend Prisma model — see
 * `growth-project-backend/prisma/schema.prisma:3189-3256`. The endpoint
 * returns the raw row (no `package` relation) — confirmed against
 * `growth-project-backend/src/checkout/checkout.service.ts:623-635`.
 *
 * Only the columns the mobile screens actually read are typed here.
 * Adding more is a one-line change; do not invent fields that are not
 * on the Prisma model.
 */
export interface ClientPurchase {
  id: string;
  package_id: string;
  /** ClientPurchase.status — pending | paid | active | past_due | canceled | payment_failed | expired (schema.prisma:3214). */
  status:
    | 'pending'
    | 'paid'
    | 'active'
    | 'past_due'
    | 'canceled'
    | 'payment_failed'
    | 'expired';
  entitlement_active: boolean;
  access_expires_at: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  canceled_at: string | null;
  created_at: string;
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
 *
 * Field provenance (each field maps to a real column on the backend
 * `ClientPurchase` Prisma model — see
 * `growth-project-backend/prisma/schema.prisma:3189-3256`):
 *   state               ← derived from ClientPurchase.entitlement_active
 *                         (true → 'active', false → 'none') and
 *                         ClientPurchase.status when explicit (past_due,
 *                         canceled). 'trialing' is NOT exposed by the
 *                         backend today and is therefore never produced
 *                         by this client.
 *   package_id          ← ClientPurchase.package_id
 *   package_name        ← joined from `getPackages()` by package_id
 *                         (the purchases endpoint does NOT include the
 *                         `package` relation — verified against
 *                         `checkout.service.ts:623-635`).
 *   current_period_end  ← ClientPurchase.current_period_end
 *   trial_ends_at       ← (not exposed by backend — always null)
 *   dunning             ← (no client-facing dunning route exists today —
 *                         always null. DunningState lives in the DB at
 *                         `prisma/schema.prisma:3424` but is only read
 *                         by internal services. TODO(backend): ship a
 *                         dunning read route so the past-due banner can
 *                         render real data.)
 */
export interface ClientPaymentStatus {
  /**
   * - 'active'    — subscription healthy
   * - 'trialing'  — inside trial window (not exposed by backend yet)
   * - 'past_due'  — last invoice failed, in retry window
   * - 'canceled'  — subscription ended
   * - 'none'      — no subscription yet (coach manages access externally)
   */
  state: 'active' | 'trialing' | 'past_due' | 'canceled' | 'none';
  /** ClientPurchase.package_id — null when state === 'none'. */
  package_id: string | null;
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
   * Lists the client's own purchase history. Backed by
   * `GET /v1/checkout/purchases` (`checkout.controller.ts:147`), which
   * returns raw `ClientPurchase` Prisma rows (no `package` relation —
   * verified `checkout.service.ts:623-635`). Each row carries the
   * authoritative status, period-end, and entitlement signals the
   * mobile screens need.
   */
  getPurchases: (): Promise<PaymentsResult<ClientPurchase[]>> =>
    wrap(
      api
        .get<{ purchases?: ClientPurchase[] } | ClientPurchase[]>(
          '/v1/checkout/purchases',
        )
        .then((r) => ({
          ...r,
          data: Array.isArray(r.data)
            ? r.data
            : Array.isArray(r.data?.purchases)
              ? r.data!.purchases
              : [],
        })),
    ),

  /**
   * Returns the client's current subscription state for the packages
   * screen.
   *
   * Round-3 audit fix — DERIVED FROM REAL FIELDS ONLY. The backend
   * `checkout.controller.ts` does not expose a `/status` route; the
   * round-2 derivation read a fabricated `is_current` column from the
   * packages list that does NOT exist in the
   * `CoachPackage` Prisma schema (`prisma/schema.prisma:2942-3000`), so
   * `package_name` was always null in practice. Round 3 sources state
   * from the routes that DO exist:
   *
   *   • `GET /v1/checkout/purchases` (`checkout.controller.ts:147`):
   *     returns raw `ClientPurchase` rows
   *     (`prisma/schema.prisma:3189-3256`) — the fields used here
   *     (`entitlement_active`, `status`, `current_period_end`,
   *     `package_id`, `cancel_at_period_end`) are columns confirmed
   *     present on that model.
   *   • `GET /v1/clients/me/coach/packages` (`packages.controller.ts:161`):
   *     the public package catalog — joined here by `package_id` to
   *     resolve the human-readable package name. The packages endpoint
   *     does NOT carry the join itself (`checkout.service.ts:623-635`
   *     uses a bare `findMany` with no `include`), so the join lives
   *     here on the client.
   *
   * Active row selection: an authoritative `ClientPurchase` is the row
   * where `entitlement_active === true`, optionally restricted to those
   * whose `access_expires_at` is null or in the future (mirrors the
   * server-side rule in `checkout.service.ts:744`). If multiple rows
   * are active (rare — both a one_time and a recurring), the most
   * recent by `created_at` wins; the purchases endpoint already orders
   * by `created_at desc` (`checkout.service.ts:630`).
   *
   * Status mapping (only values the backend can actually produce —
   * `ClientPurchase.status` is `pending | paid | active | past_due |
   * canceled | payment_failed | expired`, per
   * `prisma/schema.prisma:3214`):
   *   purchase.status === 'past_due'                  → 'past_due'
   *   purchase.status === 'canceled'                  → 'canceled'
   *   entitlement_active && status in (paid|active)   → 'active'
   *   otherwise                                       → 'none'
   *
   * 'trialing' is not produced — the backend has no trial state column
   * today.
   *
   * Transport contract: if either upstream returns an explicit
   * `not_configured` (501), the whole call returns `not_configured`. Any
   * other failure (404, 5xx, network) bubbles up as `reason: 'error'`
   * (retryable). 404 is NEVER mapped to `not_configured` — that's the
   * exact regression PR-1 round 1 was supposed to fix.
   *
   * Dunning: always null today. There is no client-facing dunning route
   * even though `DunningState` rows exist in the DB
   * (`prisma/schema.prisma:3424`). The screen's past-due banner is
   * wired and will light up when the backend ships a dunning read route.
   * TODO(backend): expose `GET /v1/checkout/dunning` (or include dunning
   * fields on the purchases response) so this null becomes real data.
   */
  getPaymentStatus: async (): Promise<PaymentsResult<ClientPaymentStatus>> => {
    const [purchasesResult, packagesResult] = await Promise.all([
      clientPaymentsApi.getPurchases(),
      clientPaymentsApi.getPackages(),
    ]);

    // Explicit "backend has declined to serve this on this deployment"
    // signal wins — same envelope semantics so screens that already gate
    // on `reason: 'not_configured'` keep working.
    if (!purchasesResult.ok && purchasesResult.reason === 'not_configured') {
      return purchasesResult;
    }
    if (!packagesResult.ok && packagesResult.reason === 'not_configured') {
      return packagesResult;
    }
    // Any other failure (404, 5xx, network) bubbles up as retryable.
    // Purchases is the load-bearing signal; we cannot honestly report
    // state without it. Fail loud, not silent.
    if (!purchasesResult.ok) return purchasesResult;
    if (!packagesResult.ok) return packagesResult;

    const now = Date.now();
    // Mirrors the server-side active-purchase rule in
    // `checkout.service.ts:744-757`.
    const activePurchase =
      purchasesResult.data.find((p) => {
        if (!p.entitlement_active) return false;
        if (p.access_expires_at == null) return true;
        const ts = Date.parse(p.access_expires_at);
        return Number.isNaN(ts) || ts > now;
      }) ?? null;

    // Surface a past_due or canceled signal even when entitlement has
    // already been turned off, so the screen can still show the user
    // what happened. Picks the most recent matching row.
    const pastDuePurchase = purchasesResult.data.find((p) => p.status === 'past_due') ?? null;
    const canceledPurchase = purchasesResult.data.find((p) => p.status === 'canceled') ?? null;

    const chosen = activePurchase ?? pastDuePurchase ?? canceledPurchase ?? null;
    const state: ClientPaymentStatus['state'] = chosen
      ? chosen.status === 'past_due'
        ? 'past_due'
        : chosen.status === 'canceled'
          ? 'canceled'
          : chosen.entitlement_active &&
              (chosen.status === 'paid' || chosen.status === 'active')
            ? 'active'
            : 'none'
      : 'none';

    const packageId = chosen?.package_id ?? null;
    const packageName = packageId
      ? (packagesResult.data.find((p) => p.id === packageId)?.name ?? null)
      : null;

    return {
      ok: true,
      data: {
        state,
        package_id: packageId,
        package_name: packageName,
        current_period_end: chosen?.current_period_end ?? null,
        // Backend has no trial column today. Null tells the UI to omit
        // the trial row instead of fabricating a date (rule 18).
        trial_ends_at: null,
        // No client-facing dunning route exists today — see file header
        // TODO. The past-due banner in `ClientPackagesScreen` is wired
        // and will render the moment this stops being null.
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
   * Route: `GET /v1/checkout/entitlement` (`checkout.controller.ts:168`).
   * The backend returns `{ active: boolean; entitlement_active: boolean }`
   * during the transition window (`checkout.controller.ts:182`); we read
   * `active`. The previous `/v1/clients/me/coach/entitlement` path does
   * not exist on the backend — every entitlement check was 404'ing and
   * (per `EntitlementProvider.refreshEntitlement`) fail-closing the
   * whole app for paying clients. This was the fifth dead route round 1
   * missed (audit round 2).
   */
  getEntitlement: (): Promise<PaymentsResult<{ active: boolean; reason?: string }>> =>
    wrap(api.get<{ active: boolean; reason?: string }>('/v1/checkout/entitlement')),

  /**
   * Called on the checkout success deep-link to confirm the session
   * actually granted entitlement before the UI flips to "access granted".
   *
   * Route: `GET /v1/checkout/sessions/:id/confirm`
   * (`checkout.controller.ts:236`). Real backend response shape
   * (verified `checkout.service.ts:677-735`):
   *
   *   { paid: boolean; status: string; package_name: string | null }
   *
   * `paid` is true when Stripe reports `payment_status === 'paid'` OR
   * the local purchase row has `entitlement_active === true` OR
   * `status in ('paid','active')` (`checkout.service.ts:723-727`).
   *
   * The mobile call sites (CheckoutReturnScreen) consume a
   * `ClientPaymentStatus`, so we adapt the wire shape into that envelope
   * here: `paid → state: 'active'|'none'`, propagate `package_name`,
   * leave period_end / dunning null (the confirm payload doesn't carry
   * them). The previous `POST /v1/clients/me/coach/checkout/confirm`
   * had both a wrong verb AND a wrong path — every successful charge
   * stuck in "confirmation pending" forever. The real endpoint is
   * idempotent (the session id is the dedup key on the server side),
   * so no client-supplied Idempotency-Key is needed.
   */
  confirmCheckoutSession: async (
    sessionId: string,
  ): Promise<PaymentsResult<ClientPaymentStatus>> => {
    const res = await wrap(
      api.get<{ paid: boolean; status: string; package_name: string | null }>(
        `/v1/checkout/sessions/${encodeURIComponent(sessionId)}/confirm`,
      ),
    );
    if (!res.ok) return res;
    const { paid, package_name } = res.data;
    return {
      ok: true,
      data: {
        state: paid ? 'active' : 'none',
        package_id: null, // confirm endpoint does not return package_id
        package_name: package_name ?? null,
        current_period_end: null,
        trial_ends_at: null,
        dunning: null,
      },
    };
  },
};
