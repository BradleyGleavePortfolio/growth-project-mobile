/**
 * coachPaymentsApi — typed mobile client for the coach-facing payment ops
 * from backend PRs #215 (package CRUD, dunning ops) and #216 (payout
 * readiness, reconciliation, refunds/disputes, earnings, rollups).
 *
 * Endpoints consumed:
 *   GET    /v1/coach/packages                — list packages this coach offers
 *   POST   /v1/coach/packages                — create
 *   PATCH  /v1/coach/packages/:id            — update
 *   DELETE /v1/coach/packages/:id            — archive (Stripe keeps history)
 *   GET    /v1/coach/payouts/readiness       — Connect KYC + payout readiness
 *   GET    /v1/coach/payouts/recent          — recent payouts (with reconciliation)
 *   GET    /v1/coach/earnings                — coach earnings: gross/net/fees, current
 *                                              period, lifetime, sub-coach attribution
 *   GET    /v1/coach/reconciliation          — Stripe ↔ platform ledger health
 *   GET    /v1/coach/refunds                 — pending + recent refunds / disputes
 *   POST   /v1/coach/dashboard-link          — Stripe Express dashboard URL (signed-in coach)
 *
 * Same envelope as `coachConnectApi`: 404 / 501 means the route is not
 * deployed yet; the screen renders an honest setup CTA, never a fake number.
 *
 * Fee split rules (mobile copy mirrors backend):
 *   - The Growth Project platform fee: 2% of gross paid revenue (TGP)
 *   - Head coach / gym override: 5% of sub-coach gross (when applicable)
 *   - Stripe processing fees: passed through, not collected by TGP
 */

import api from '../services/api';
import type { AxiosResponse } from 'axios';
import type { ConnectResult } from './coachConnectApi';

export interface CoachPackageInput {
  name: string;
  description?: string | null;
  type: 'one_time' | 'recurring';
  /** Major-unit price (199.00 not 19900). */
  price: number;
  currency: string;
  interval?: 'month' | 'year' | null;
  trial_days?: number | null;
  features?: string[];
  active?: boolean;
}

export interface CoachPackageRecord extends CoachPackageInput {
  id: string;
  active: boolean;
  active_subscribers: number;
  created_at: string;
  updated_at: string;
}

export interface PayoutReadiness {
  /** Has the coach finished Stripe Connect onboarding? */
  onboarded: boolean;
  /** Stripe charges_enabled flag — can the coach accept money? */
  charges_enabled: boolean;
  /** Stripe payouts_enabled flag — will Stripe pay out to the bank? */
  payouts_enabled: boolean;
  /** Outstanding KYC / verification requirements. Empty when good. */
  requirements_due: string[];
  /** ISO timestamp when next payout is expected, when known. */
  next_payout_eta: string | null;
  /** Stripe Express dashboard slug, when known. */
  dashboard_available: boolean;
}

export interface RecentPayout {
  id: string;
  amount: number;
  currency: string;
  status: 'pending' | 'in_transit' | 'paid' | 'failed' | 'canceled';
  arrival_date: string;
  created_at: string;
  /** Number of charges grouped into this payout, when known. */
  charge_count: number | null;
  /** Backend reconciliation flag — true when our ledger total matches Stripe's. */
  reconciled: boolean;
  description: string | null;
}

export interface CoachEarnings {
  currency: string;
  /** Gross paid revenue current month-to-date. */
  gross_mtd: number;
  /** Net to coach after platform fees + Stripe fees, MTD. */
  net_mtd: number;
  /** Stripe processing fees deducted MTD. */
  stripe_fees_mtd: number;
  /** TGP platform fee deducted MTD (2% of gross). */
  platform_fees_mtd: number;
  /** Head coach / gym override deducted MTD when coach is a sub-coach. */
  head_coach_fees_mtd: number;
  /**
   * Lifetime gross paid revenue. Useful for "$X earned through TGP"
   * marketing claims but the screen renders it as a coach-only metric.
   */
  gross_lifetime: number;
  net_lifetime: number;
  /**
   * Sub-coach attribution for head coaches. Empty array when the coach
   * has no sub-coaches; the screen hides the section in that case.
   */
  sub_coach_breakdown: Array<{
    sub_coach_id: string;
    sub_coach_name: string;
    gross_mtd: number;
    override_mtd: number;
  }>;
  generated_at: string;
}

export interface ReconciliationHealth {
  /** "healthy" when Stripe and platform agree within tolerance for the window. */
  state: 'healthy' | 'drift' | 'unknown';
  /** Absolute drift in major units (e.g. 12.34). 0 when healthy. */
  drift_amount: number;
  currency: string;
  /** ISO window the reconciliation snapshot covers. */
  window_start: string;
  window_end: string;
  /** Backend-supplied human summary, rendered verbatim. */
  summary: string;
}

export interface RefundRow {
  id: string;
  amount: number;
  currency: string;
  /** 'requested' (coach must approve), 'processing', 'refunded', 'failed'. */
  status: 'requested' | 'processing' | 'refunded' | 'failed' | 'disputed';
  /** Original charge id. */
  charge_id: string;
  client_name: string | null;
  created_at: string;
  /** Coach-supplied reason or dispute label. */
  reason: string | null;
}

export interface DashboardLink {
  url: string;
  expires_at: string;
}

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

export const coachPaymentsApi = {
  // ── Package CRUD (PR #215) ────────────────────────────────────────────
  listPackages: (): Promise<ConnectResult<CoachPackageRecord[]>> =>
    wrap(api.get<CoachPackageRecord[]>('/v1/coach/packages')),

  createPackage: (input: CoachPackageInput): Promise<ConnectResult<CoachPackageRecord>> =>
    wrap(api.post<CoachPackageRecord>('/v1/coach/packages', input)),

  updatePackage: (
    id: string,
    patch: Partial<CoachPackageInput>,
  ): Promise<ConnectResult<CoachPackageRecord>> =>
    wrap(api.patch<CoachPackageRecord>(`/v1/coach/packages/${id}`, patch)),

  archivePackage: (id: string): Promise<ConnectResult<{ id: string; active: false }>> =>
    wrap(api.delete<{ id: string; active: false }>(`/v1/coach/packages/${id}`)),

  // ── Payout readiness + recent payouts (PR #216) ───────────────────────
  getPayoutReadiness: (): Promise<ConnectResult<PayoutReadiness>> =>
    wrap(api.get<PayoutReadiness>('/v1/coach/payouts/readiness')),

  getRecentPayouts: (limit = 10): Promise<ConnectResult<RecentPayout[]>> =>
    wrap(api.get<RecentPayout[]>(`/v1/coach/payouts/recent?limit=${limit}`)),

  // ── Earnings, reconciliation, refunds (PR #216) ───────────────────────
  getEarnings: (): Promise<ConnectResult<CoachEarnings>> =>
    wrap(api.get<CoachEarnings>('/v1/coach/earnings')),

  getReconciliation: (): Promise<ConnectResult<ReconciliationHealth>> =>
    wrap(api.get<ReconciliationHealth>('/v1/coach/reconciliation')),

  getRefunds: (): Promise<ConnectResult<RefundRow[]>> =>
    wrap(api.get<RefundRow[]>('/v1/coach/refunds')),

  // ── Stripe Express dashboard one-time link ────────────────────────────
  createDashboardLink: (): Promise<ConnectResult<DashboardLink>> =>
    wrap(api.post<DashboardLink>('/v1/coach/dashboard-link', {})),
};
