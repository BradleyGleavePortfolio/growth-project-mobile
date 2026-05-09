/**
 * Stage-3 cross-pillar wire contract (fitness mobile).
 *
 * Mirrors the shapes returned by `gpb/src/coach/cross-pillar/*` and
 * the OWNER federation surface they reuse. Strict types — no
 * `Record<string, unknown>` on cross-app responses, since silently
 * tolerating unknown keys is exactly how Stage-1 shipped the
 * income-bucket bug.
 *
 * The single shared identity key is `email` today. When the backend
 * promotes a durable `account_id`, swap that field through here and
 * keep `email` as a fallback — UI never reads the join key directly.
 */

export type CoachPracticeType = 'fitness_only' | 'finance_only' | 'both';

export type CrossPillarFinanceRowStatus =
  | 'ok'
  | 'not_found'
  | 'not_configured'
  | 'auth_unconfigured'
  | 'timeout'
  | 'network_error'
  | 'http_error'
  | 'malformed_response';

export interface CrossPillarFinanceClientSummary {
  id: string;
  email: string;
  name: string | null;
  role: string;
  account_id?: string | null;
  net_worth: number | null;
  asset_total: number | null;
  debt_total: number | null;
  cash_total: number | null;
  streak_days: number | null;
  last_eod_date: string | null;
  wealth_velocity_score: number | null;
  activity_last_7d: {
    eod_submissions: number;
    what_if_scenarios: number;
    coach_notes: number;
  };
}

export interface CrossPillarRosterRow {
  email: string;
  name: string | null;
  fitness: {
    user_id: string;
    joined_at: string;
  };
  finance: {
    status: CrossPillarFinanceRowStatus;
    summary: CrossPillarFinanceClientSummary | null;
  };
  pillars: ('fitness' | 'finance')[];
}

export interface CrossPillarRosterResponse {
  generated_at: string;
  identity_mapping: 'email';
  finance: {
    status: 'ok' | 'partial' | 'unavailable';
    ok_count: number;
    not_found_count: number;
    error_count: number;
  };
  results: CrossPillarRosterRow[];
}

// Search hits — same shape the OWNER admin console renders.
export interface CrossPillarSearchHit {
  email: string;
  name: string | null;
  products: ('fitness' | 'finance')[];
  fitness: {
    user_id: string | null;
    role: string | null;
    coach_id: string | null;
  } | null;
  finance: {
    account_id: string | null;
    user_id: string | null;
    role: string | null;
    has_coach: boolean | null;
  } | null;
}

export interface CrossPillarSearchResponse {
  query: string;
  finance: {
    status: 'ok' | 'not_found' | CrossPillarFinanceRowStatus;
    detail?: string;
  };
  results: CrossPillarSearchHit[];
}

// Single-client unified profile — mirrors gpb FederationService.unifiedClient.
export interface CrossPillarFitnessClient {
  user_id: string;
  email: string;
  name: string | null;
  role: string;
  coach_id: string | null;
  archived_at: string | null;
  created_at: string;
  activity_last_7d: {
    food_logs: number;
    workouts: number;
    coach_messages: number;
  };
}

export interface CrossPillarClientResponse {
  email: string;
  fitness: CrossPillarFitnessClient | null;
  finance: {
    status: 'ok' | 'not_found' | CrossPillarFinanceRowStatus;
    detail?: string;
    data: CrossPillarFinanceClientSummary | null;
  };
  products: {
    fitness: { active: boolean; reason?: string };
    finance: { active: boolean; reason?: string };
  };
  // The backend also sends `entitlements`. We keep it loose here because
  // the cross-pillar screens render only `products` — entitlements is
  // an OWNER-admin concept that the coach UI does not display.
  entitlements?: unknown;
}

export interface CrossPillarAnalyticsResponse {
  generated_at: string;
  identity_mapping: 'email';
  fitness: {
    client_count: number;
    active_client_count_7d: number;
  };
  finance: {
    status: 'ok' | 'unavailable';
    reason?: string;
    data: {
      users?: { total: number; by_role: Record<string, number> };
      engagement?: { dau: number; wau: number; mau: number };
    } | null;
  };
}

export interface PracticeTypeResponse {
  practice_type: CoachPracticeType | null;
}
