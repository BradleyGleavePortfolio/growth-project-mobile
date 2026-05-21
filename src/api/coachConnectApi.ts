/**
 * coachConnectApi — typed client for the coach business / Stripe Connect
 * surface (backend PRs #215 / #216).
 *
 * The mobile contract is defined here even when the backend hasn't shipped the
 * endpoints yet: callers receive a typed `null` / `{ configured: false }`
 * response and render an honest "not connected" empty state, never a fake
 * dashboard.
 *
 * Endpoints consumed:
 *   GET  /coach/connect/status           — has the coach onboarded with Stripe?
 *   GET  /coach/connect/metrics          — revenue, churn, MRR, clients added
 *   GET  /coach/connect/payouts          — recent payouts
 *   GET  /coach/connect/packages         — products / subscription packages
 *   POST /coach/connect/onboarding-link  — returns Stripe-hosted onboarding URL
 *
 * 404 / 501 from any endpoint is treated as "not configured" — the screen
 * surfaces a "connect Stripe to enable" CTA rather than a crash.
 */

import api from '../services/api';
import type { AxiosResponse } from 'axios';
import { randomUUID } from 'expo-crypto';

export interface ConnectStatus {
  configured: boolean;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  account_id: string | null;
  /** ISO timestamp the coach last refreshed onboarding. Null until first onboarding link. */
  last_onboarded_at: string | null;
  /** Set when the coach must return to Stripe to finish KYC. */
  requirements_due: string[];
}

export interface BusinessMetrics {
  /** Trailing-30-day gross revenue, in the coach's display currency, in major units (e.g. 4250.00). */
  revenue_30d: number;
  /** Trailing-30-day net revenue after Stripe fees and platform fees. */
  net_30d: number;
  /** Display currency ISO 4217. */
  currency: string;
  /** Active paying clients at end of window. */
  active_clients: number;
  /** Clients newly attached to the coach within the window. */
  clients_added_30d: number;
  /** Clients who churned (subscription cancelled or expired) within the window. */
  clients_churned_30d: number;
  /** Monthly recurring revenue at end of window. */
  mrr: number;
  /** Sub-coach attributed revenue (head coach view only). */
  sub_coach_revenue_30d: number;
  /** Sub-coach attributed churn. */
  sub_coach_churn_30d: number;
  /** Sub-coach attributed acquisition. */
  sub_coach_acquisition_30d: number;
  /** Total lifetime revenue. */
  total_revenue: number;
  /** ISO timestamp the metrics snapshot was generated. */
  generated_at: string;
}

export interface Payout {
  id: string;
  amount: number;
  currency: string;
  status: 'pending' | 'in_transit' | 'paid' | 'failed' | 'canceled';
  arrival_date: string;
  created_at: string;
  description: string | null;
}

export interface CoachPackage {
  id: string;
  name: string;
  description: string | null;
  /** "one_time" or "recurring". */
  type: 'one_time' | 'recurring';
  /** Major-unit price (e.g. 199.00). */
  price: number;
  currency: string;
  /** Only set when type === 'recurring'. */
  interval: 'month' | 'year' | null;
  active: boolean;
  /** Live paying subscriber count for recurring packages. Always 0 for one_time. */
  active_subscribers: number;
}

export interface OnboardingLink {
  url: string;
  expires_at: string;
}

/**
 * Result envelope used by the screen to drive a tri-state UI:
 *  - { ok: true, data }        → render the metric
 *  - { ok: false, reason: 'not_configured' } → render "Connect Stripe to enable"
 *  - { ok: false, reason: 'error', message }  → render retry banner
 *
 * This keeps the screen agnostic to whether the backend route exists yet.
 */
export type ConnectResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: 'not_configured' }
  | { ok: false; reason: 'error'; message: string };

function isNotConfigured(err: unknown): boolean {
  const e = err as { response?: { status?: number } } | undefined;
  const status = e?.response?.status;
  return status === 404 || status === 501;
}

function wrap<T>(p: Promise<AxiosResponse<T>>): Promise<ConnectResult<T>> {
  return p
    .then((r) => ({ ok: true as const, data: r.data }))
    .catch((err) => {
      if (isNotConfigured(err)) return { ok: false as const, reason: 'not_configured' as const };
      const message =
        (err as { message?: string })?.message ?? 'Failed to load — try again.';
      return { ok: false as const, reason: 'error' as const, message };
    });
}

/**
 * Validate a Stripe-hosted URL before handing it to `Linking.openURL`.
 *
 * H3-P1-2 (Hunter #3): the backend-supplied Connect URL was previously
 * passed verbatim to `Linking.openURL` with no allow-list check. If the
 * backend is compromised, or a MITM on a misconfigured TLS endpoint
 * substitutes the JSON payload, the coach is silently redirected to an
 * attacker-controlled domain. The mitigation here is a strict scheme +
 * hostname allow-list applied at every call site before the URL leaves
 * the app:
 *
 *   - Scheme must be exactly `https:` — refuses `http:`, `javascript:`,
 *     `tgp:` (custom scheme), and any other protocol.
 *   - Hostname must be exactly `stripe.com` or end with `.stripe.com`
 *     (`connect.stripe.com`, `dashboard.stripe.com`, etc.). The leading
 *     dot is important — `endsWith('stripe.com')` alone would also
 *     accept `evilstripe.com`.
 *
 * Returns `false` for malformed URLs, non-HTTPS schemes, and any host
 * outside the allow-list. The caller surfaces a structured user-facing
 * error and does NOT open the URL.
 */
export function isTrustedStripeUrl(rawUrl: string): boolean {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0) return false;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  if (host === 'stripe.com') return true;
  if (host.endsWith('.stripe.com')) return true;
  return false;
}

/**
 * In-flight Promise cache for `createOnboardingLink`, keyed by `returnPath`.
 *
 * H3-P1-1 (Hunter #3): the `onboardBusy` UI flag does not cover the network
 * race that opens between a first tap on "Connect Stripe" firing a POST and
 * the second tap arriving before React has re-rendered with the disabled
 * state. Without an in-flight cache the second tap minted a second
 * onboarding URL on the backend — duplicate account-link requests are
 * wasteful (Stripe rate-limits) and create UX confusion ("which link is
 * canonical?"). The Idempotency-Key header gives the backend a way to
 * deduplicate; the in-flight Promise cache short-circuits the redundant
 * call entirely on the client side so the second tap awaits the same
 * Promise the first tap is already awaiting.
 *
 * Keyed by `returnPath` so two callers asking for different return paths
 * still each get their own link.
 */
const onboardingLinkInflight = new Map<
  string,
  Promise<ConnectResult<OnboardingLink>>
>();

/** Build a stable idempotency key per onboarding attempt. RFC 4122 UUID v4
 *  produced by `expo-crypto`; Stripe treats it as opaque and dedupes on it. */
function newOnboardingIdempotencyKey(): string {
  return `coach-connect-onboarding-${randomUUID()}`;
}

export const coachConnectApi = {
  getStatus: (): Promise<ConnectResult<ConnectStatus>> =>
    wrap(api.get<ConnectStatus>('/coach/connect/status')),

  getMetrics: (): Promise<ConnectResult<BusinessMetrics>> =>
    wrap(api.get<BusinessMetrics>('/coach/connect/metrics')),

  getPayouts: (limit = 10): Promise<ConnectResult<Payout[]>> =>
    wrap(api.get<Payout[]>(`/coach/connect/payouts?limit=${limit}`)),

  getPackages: (): Promise<ConnectResult<CoachPackage[]>> =>
    wrap(api.get<CoachPackage[]>('/coach/connect/packages')),

  /**
   * Mint a Stripe-hosted onboarding URL for the coach to complete KYC.
   *
   * H3-P1-1: idempotent under rapid double-tap. The function caches the
   * in-flight Promise keyed by `returnPath`, so a second concurrent call
   * with the same `returnPath` returns the same Promise as the first.
   * It also forwards an `Idempotency-Key` header so the backend can
   * deduplicate on its side even when concurrent calls come from
   * different React renders (or, in dev, a Fast Refresh-triggered
   * remount). The key is generated once per first call and reused
   * implicitly by any callers awaiting the same in-flight Promise.
   */
  createOnboardingLink: (
    returnPath?: string,
  ): Promise<ConnectResult<OnboardingLink>> => {
    const cacheKey = returnPath ?? '';
    const existing = onboardingLinkInflight.get(cacheKey);
    if (existing) return existing;
    const idempotencyKey = newOnboardingIdempotencyKey();
    const inflight = wrap(
      api.post<OnboardingLink>(
        '/coach/connect/onboarding-link',
        returnPath ? { return_path: returnPath } : {},
        { headers: { 'Idempotency-Key': idempotencyKey } },
      ),
    ).finally(() => {
      // Clear the in-flight slot once the request settles. A failed mint
      // must not poison subsequent retries; a successful mint already
      // returned a URL the screen can act on. The 0ms timeout pushes the
      // clear past the resolve/reject so concurrent awaits see the same
      // settled Promise.
      onboardingLinkInflight.delete(cacheKey);
    });
    onboardingLinkInflight.set(cacheKey, inflight);
    return inflight;
  },
};

/**
 * Test-only hook. Production code MUST NOT call this. Imported by screen
 * tests to reset the in-flight Promise cache between cases without
 * resorting to module-reset shenanigans that would also blow away the
 * axios mock state.
 */
export function __resetOnboardingInflightForTests(): void {
  onboardingLinkInflight.clear();
}
