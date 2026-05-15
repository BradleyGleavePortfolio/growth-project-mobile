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

export const coachConnectApi = {
  getStatus: (): Promise<ConnectResult<ConnectStatus>> =>
    wrap(api.get<ConnectStatus>('/coach/connect/status')),

  getMetrics: (): Promise<ConnectResult<BusinessMetrics>> =>
    wrap(api.get<BusinessMetrics>('/coach/connect/metrics')),

  getPayouts: (limit = 10): Promise<ConnectResult<Payout[]>> =>
    wrap(api.get<Payout[]>(`/coach/connect/payouts?limit=${limit}`)),

  getPackages: (): Promise<ConnectResult<CoachPackage[]>> =>
    wrap(api.get<CoachPackage[]>('/coach/connect/packages')),

  createOnboardingLink: (returnPath?: string): Promise<ConnectResult<OnboardingLink>> =>
    wrap(
      api.post<OnboardingLink>(
        '/coach/connect/onboarding-link',
        returnPath ? { return_path: returnPath } : {},
      ),
    ),
};
