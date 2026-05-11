/**
 * holisticInsightsApi
 *
 * Typed client for the Sprint B v2 Holistic Insights endpoint
 * (PR #188 backend, v1). Read-only. The cross-pillar federation
 * source (finance pillar) ships in Sprint B-3 backend; until that
 * lands, the envelope's `status` is `finance_unavailable` for users
 * without a connected finance account.
 *
 * Backend contract source of truth:
 *   src/insights/holistic-insights.controller.ts
 *   src/insights/holistic-insights.types.ts
 *
 * Cache posture:
 *   - Successful envelopes (status === 'ok' or 'insufficient_data')
 *     cache server-side for 24h.
 *   - `finance_unavailable` envelopes cache for 5 minutes (Sprint B
 *     v2.1 audit fix).
 *   - `force=1` bypasses the cache. UI should expose a manual
 *     "refresh" affordance that calls with force=true.
 */

import api from '../services/api';

// ─── Status enum (mirror) ────────────────────────────────────────────────────

export type InsightStatus = 'ok' | 'insufficient_data' | 'finance_unavailable';

// ─── Series labels ───────────────────────────────────────────────────────────

/**
 * Stable string labels for the (fitness, finance) series pair on each
 * insight. Promoted from the backend's free-string `series` field so
 * mobile code can switch on them without literal string typos. Adding
 * a new label here requires a matching backend addition.
 */
export const FITNESS_SERIES = [
  'fitness:cardio_minutes',
  'fitness:strength_sessions',
  'fitness:weight_kg',
  'fitness:sleep_hours',
] as const;
export type FitnessSeries = (typeof FITNESS_SERIES)[number];

export const FINANCE_SERIES = [
  'finance:savings_rate_pct',
  'finance:spending_kusd',
  'finance:debt_to_income',
] as const;
export type FinanceSeries = (typeof FINANCE_SERIES)[number];

// ─── Envelope types ─────────────────────────────────────────────────────────

export interface HolisticInsight {
  /** Stable id (sha256 prefix of label + correlation pair). */
  id: string;
  /** Human-readable summary rendered server-side. */
  text: string;
  /** Pearson r in [-1, 1]. */
  correlation: number;
  weeks: number;
  weekKeyRange: { from: string; to: string };
  series: [FitnessSeries | string, FinanceSeries | string];
}

export interface HolisticInsightsEnvelope {
  /** Schema version. Mobile must branch on this if it ever changes. */
  version: 1;
  status: InsightStatus;
  /** ISO 8601. */
  generated_at: string;
  data_window: {
    window_days: number;
    weeks_observed: number;
  };
  insights: HolisticInsight[];
  /** Honest empty-state copy. Populated even when status === 'ok'. */
  notes: string[];
}

export interface HolisticInsightsParams {
  /** Server clamps to [30, 180]. Default 90. */
  windowDays?: number;
  /** Bypass the 24h cache. */
  force?: boolean;
}

// ─── API ─────────────────────────────────────────────────────────────────────

export const holisticInsightsApi = {
  /**
   * Pull the current holistic insights envelope for the calling user.
   * The endpoint is throttled at 30/min and returns 200 even on
   * `insufficient_data` / `finance_unavailable` states — callers
   * branch on `envelope.status` to render the right UI.
   */
  get: (params: HolisticInsightsParams = {}) => {
    const query: string[] = [];
    if (params.windowDays !== undefined) {
      query.push(`window_days=${params.windowDays}`);
    }
    if (params.force) {
      query.push('force=1');
    }
    const qs = query.length ? `?${query.join('&')}` : '';
    return api.get<HolisticInsightsEnvelope>(`/insights/holistic${qs}`);
  },
};
