// Coach Command Center API — typed wrappers for the 5 backend endpoints.
//
// Status: MOCKED until the Phase 8 backend PR is merged and deployed.
// When live backend ships, set __USING_MOCK_DATA = false and replace the
// mock implementations with real api.get / api.post calls.
//
// Endpoint surface consumed:
//   GET  /coach/command-center/overview        — KPI tiles + roster summary
//   GET  /coach/command-center/at-risk         — clients with PTM risk_score >= 0.3
//   GET  /coach/command-center/win-streaks     — clients with active streaks
//   GET  /coach/command-center/inbox           — coach-specific message threads
//   GET  /coach/command-center/action-queue    — alerts requiring coach action
//   POST /coach/command-center/action-queue/:alertId/dismiss — dismiss an alert

import api from './api';

// ─── Flag ─────────────────────────────────────────────────────────────────────
// Driven by EXPO_PUBLIC_USE_MOCK_COMMAND_CENTER. Defaults OFF (false) — only
// dev/preview builds that opt in via env get the bundled mock fixtures.
// Production builds set this to "false" in eas.json so a release binary can
// never accidentally ship with the demo roster.
const RAW = (process.env.EXPO_PUBLIC_USE_MOCK_COMMAND_CENTER || '').trim().toLowerCase();
export const __USING_MOCK_DATA: boolean = RAW === '1' || RAW === 'true';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CommandCenterOverview {
  roster_size: number;
  active_today: number;
  check_in_rate_7day: number;   // 0–1 fraction e.g. 0.72 means 72%
  open_alerts: number;
  at_risk_count: number;        // bucket red + amber combined
  win_streak_count: number;     // clients with streak >= 3
  unread_messages: number;
  pending_actions: number;
}

export type RiskBucket = 'red' | 'amber' | 'green';

export interface AtRiskEntry {
  user_id: string;
  display_name: string;
  bucket: RiskBucket;
  // raw score is null for coach-scoped endpoint; use bucket for display
  risk_score: number | null;
  last_active_at: string | null;
  top_factor: string;   // plain-English signal label
  days_since_checkin: number;
}

export interface AtRiskResponse {
  items: AtRiskEntry[];
  total_at_risk: number;
}

export interface WinStreakEntry {
  user_id: string;
  display_name: string;
  streak_days: number;
  streak_type: string;  // 'check_in' | 'workout' | 'weight_log'
  streak_started_at: string;
}

export interface WinStreaksResponse {
  items: WinStreakEntry[];
  total_active_streaks: number;
}

export interface InboxThread {
  thread_id: string;
  client_id: string;
  client_name: string;
  last_message_preview: string;   // max 120 chars, no raw PII
  last_message_at: string;
  unread_count: number;
  is_coach_turn: boolean;         // true = coach has not yet replied
}

export interface InboxResponse {
  threads: InboxThread[];
  total_unread: number;
}

export interface ActionQueueItem {
  alert_id: string;
  client_id: string;
  client_name: string;
  alert_type:
    | 'missed_checkins'
    | 'weight_not_logged'
    | 'no_message_exchange'
    | 'high_churn_risk'
    | 'build_week_gate'
    | 'bloodwork_review';
  message: string;          // plain English, generated server-side
  created_at: string;
  dismissed_at: string | null;
}

export interface ActionQueueResponse {
  items: ActionQueueItem[];
  total_pending: number;
}
// ─── LTV Metrics types ─────────────────────────────────────────────────────────

export interface LtvNextMilestone {
  clients_needed: number;
  mrr_target_cents: number;
  mrr_target_label: string;
}

export interface LtvMetrics {
  mrr_cents: number;
  mrr_label: string;
  active_client_count: number;
  revenue_per_client_month_cents: number;
  revenue_per_client_month_label: string;
  avg_client_lifespan_months: number;
  estimated_ltv_cents: number;
  estimated_ltv_label: string;
  churn_rate_pct: number;
  net_revenue_retention_pct: number;
  projected_annual_revenue_cents: number;
  projected_annual_revenue_label: string;
  /** "up" | "flat" | "down" — drives colour coding in the UI */
  mrr_trend: 'up' | 'flat' | 'down';
  mrr_30d_ago_cents: number;
  /** Consecutive months of zero churn — Duolingo-style streak */
  zero_churn_streak_months: number;
  all_time_peak_rpcm_cents: number;
  all_time_peak_rpcm_label: string;
  is_new_rpcm_record: boolean;
  /** null until CAC manual input is wired in Settings */
  ltv_cac_ratio: number | null;
  next_milestone: LtvNextMilestone;
  currency: string;
  computed_at: string;
}



// ─── Mock data ────────────────────────────────────────────────────────────────
// Replaced by live API calls once backend ships.

const MOCK_OVERVIEW: CommandCenterOverview = {
  roster_size: 14,
  active_today: 9,
  check_in_rate_7day: 0.71,
  open_alerts: 3,
  at_risk_count: 4,
  win_streak_count: 6,
  unread_messages: 2,
  pending_actions: 3,
};

const MOCK_AT_RISK: AtRiskResponse = {
  items: [
    {
      user_id: 'mock-user-1',
      display_name: 'James R.',
      bucket: 'red',
      risk_score: null,
      last_active_at: new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString(),
      top_factor: 'No app activity in 8 days',
      days_since_checkin: 8,
    },
    {
      user_id: 'mock-user-2',
      display_name: 'Sarah K.',
      bucket: 'red',
      risk_score: null,
      last_active_at: new Date(Date.now() - 6 * 24 * 3600 * 1000).toISOString(),
      top_factor: '6 consecutive missed check-ins',
      days_since_checkin: 6,
    },
    {
      user_id: 'mock-user-3',
      display_name: 'Marcus D.',
      bucket: 'amber',
      risk_score: null,
      last_active_at: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(),
      top_factor: 'Check-in consistency dropped 55%',
      days_since_checkin: 3,
    },
    {
      user_id: 'mock-user-4',
      display_name: 'Lucy M.',
      bucket: 'amber',
      risk_score: null,
      last_active_at: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString(),
      top_factor: 'Weight not logged in 15 days',
      days_since_checkin: 2,
    },
  ],
  total_at_risk: 4,
};

const MOCK_WIN_STREAKS: WinStreaksResponse = {
  items: [
    {
      user_id: 'mock-user-5',
      display_name: 'Hannah T.',
      streak_days: 21,
      streak_type: 'check_in',
      streak_started_at: new Date(Date.now() - 21 * 24 * 3600 * 1000).toISOString(),
    },
    {
      user_id: 'mock-user-6',
      display_name: 'Dan W.',
      streak_days: 14,
      streak_type: 'check_in',
      streak_started_at: new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString(),
    },
    {
      user_id: 'mock-user-7',
      display_name: 'Priya N.',
      streak_days: 12,
      streak_type: 'workout',
      streak_started_at: new Date(Date.now() - 12 * 24 * 3600 * 1000).toISOString(),
    },
    {
      user_id: 'mock-user-8',
      display_name: 'Ben A.',
      streak_days: 9,
      streak_type: 'weight_log',
      streak_started_at: new Date(Date.now() - 9 * 24 * 3600 * 1000).toISOString(),
    },
    {
      user_id: 'mock-user-9',
      display_name: 'Claire F.',
      streak_days: 7,
      streak_type: 'check_in',
      streak_started_at: new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString(),
    },
    {
      user_id: 'mock-user-10',
      display_name: 'Tom B.',
      streak_days: 5,
      streak_type: 'check_in',
      streak_started_at: new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString(),
    },
  ],
  total_active_streaks: 6,
};

const MOCK_INBOX: InboxResponse = {
  threads: [
    {
      thread_id: 'thread-1',
      client_id: 'mock-user-5',
      client_name: 'Hannah T.',
      last_message_preview: 'Just finished my third week — feeling much stronger on the squats.',
      last_message_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
      unread_count: 1,
      is_coach_turn: true,
    },
    {
      thread_id: 'thread-2',
      client_id: 'mock-user-6',
      client_name: 'Dan W.',
      last_message_preview: 'Quick question about the macros for rest days.',
      last_message_at: new Date(Date.now() - 5 * 3600 * 1000).toISOString(),
      unread_count: 1,
      is_coach_turn: true,
    },
    {
      thread_id: 'thread-3',
      client_id: 'mock-user-7',
      client_name: 'Priya N.',
      last_message_preview: 'Thanks for the feedback on the workout plan.',
      last_message_at: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
      unread_count: 0,
      is_coach_turn: false,
    },
  ],
  total_unread: 2,
};

const MOCK_ACTION_QUEUE: ActionQueueResponse = {
  items: [
    {
      alert_id: 'alert-1',
      client_id: 'mock-user-1',
      client_name: 'James R.',
      alert_type: 'missed_checkins',
      message: 'James R. has missed 8 consecutive check-ins. Last active 8 days ago.',
      created_at: new Date(Date.now() - 1 * 24 * 3600 * 1000).toISOString(),
      dismissed_at: null,
    },
    {
      alert_id: 'alert-2',
      client_id: 'mock-user-2',
      client_name: 'Sarah K.',
      alert_type: 'high_churn_risk',
      message: 'Sarah K. is showing high disengagement signals. 6 missed check-ins and no weight log in 18 days.',
      created_at: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString(),
      dismissed_at: null,
    },
    {
      alert_id: 'alert-3',
      client_id: 'mock-user-3',
      client_name: 'Marcus D.',
      alert_type: 'no_message_exchange',
      message: 'Marcus D. has had no message exchange with you in 11 days.',
      created_at: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(),
      dismissed_at: null,
    },
  ],
  total_pending: 3,
};


const MOCK_LTV_METRICS: LtvMetrics = {
  mrr_cents: 250000,
  mrr_label: '$2,500',
  active_client_count: 12,
  revenue_per_client_month_cents: 20833,
  revenue_per_client_month_label: '$208',
  avg_client_lifespan_months: 7.2,
  estimated_ltv_cents: 150000,
  estimated_ltv_label: '$1,500',
  churn_rate_pct: 8.3,
  net_revenue_retention_pct: 91.7,
  projected_annual_revenue_cents: 3000000,
  projected_annual_revenue_label: '$30,000',
  mrr_trend: 'up',
  mrr_30d_ago_cents: 230000,
  zero_churn_streak_months: 3,
  all_time_peak_rpcm_cents: 22500,
  all_time_peak_rpcm_label: '$225',
  is_new_rpcm_record: false,
  ltv_cac_ratio: null,
  next_milestone: {
    clients_needed: 2,
    mrr_target_cents: 300000,
    mrr_target_label: '$3,000 / mo',
  },
  currency: 'usd',
  computed_at: new Date().toISOString(),
};

// ─── API wrappers ─────────────────────────────────────────────────────────────

const BASE = '/coach/command-center';

function mockDelay<T>(value: T): Promise<{ data: T }> {
  return new Promise((resolve) =>
    setTimeout(() => resolve({ data: value }), 400),
  );
}

export const commandCenterApi = {
  /**
   * GET /coach/command-center/overview
   * Returns KPI tiles for the coach's current roster.
   */
  getOverview: async (): Promise<{ data: CommandCenterOverview }> => {
    if (__USING_MOCK_DATA) return mockDelay(MOCK_OVERVIEW);
    return api.get<CommandCenterOverview>(`${BASE}/overview`);
  },

  /**
   * GET /coach/command-center/at-risk
   * Returns clients with PTM bucket amber or red, sorted by severity.
   */
  getAtRisk: async (): Promise<{ data: AtRiskResponse }> => {
    if (__USING_MOCK_DATA) return mockDelay(MOCK_AT_RISK);
    return api.get<AtRiskResponse>(`${BASE}/at-risk`);
  },

  /**
   * GET /coach/command-center/win-streaks
   * Returns clients with active streaks >= 3 days, sorted by streak_days desc.
   */
  getWinStreaks: async (): Promise<{ data: WinStreaksResponse }> => {
    if (__USING_MOCK_DATA) return mockDelay(MOCK_WIN_STREAKS);
    return api.get<WinStreaksResponse>(`${BASE}/win-streaks`);
  },

  /**
   * GET /coach/command-center/inbox
   * Returns coach-specific message threads, sorted by last_message_at desc.
   * This is the coach-scoped inbox (/coach/command-center/inbox).
   * Different from the global notification center (Phase 9 mobile).
   */
  getInbox: async (): Promise<{ data: InboxResponse }> => {
    if (__USING_MOCK_DATA) return mockDelay(MOCK_INBOX);
    return api.get<InboxResponse>(`${BASE}/inbox`);
  },

  /**
   * GET /coach/command-center/action-queue
   * Returns pending coach alerts requiring action, sorted by created_at desc.
   */
  getActionQueue: async (): Promise<{ data: ActionQueueResponse }> => {
    if (__USING_MOCK_DATA) return mockDelay(MOCK_ACTION_QUEUE);
    return api.get<ActionQueueResponse>(`${BASE}/action-queue`);
  },

  /**
   * POST /coach/command-center/action-queue/:alertId/dismiss
   * Marks an alert as dismissed. Dismissed alerts are hidden from the queue.
   */
  dismissAlert: async (alertId: string): Promise<{ data: { ok: true } }> => {
    if (__USING_MOCK_DATA) return mockDelay({ ok: true as const });
    return api.post<{ ok: true }>(
      `${BASE}/action-queue/${encodeURIComponent(alertId)}/dismiss`,
      {},
    );
  },

  /**
   * GET /coach/command-center/ltv-metrics
   * Returns the full LTV metrics suite — MRR, RPCM, LTV, churn rate, NRR,
   * projected annual revenue, MRR trend, zero-churn streak, all-time peak
   * RPCM, and the next MRR milestone nudge.
   * Monetary values: raw cents (integer) + formatted label string.
   */
  getLtvMetrics: async (): Promise<{ data: LtvMetrics }> => {
    if (__USING_MOCK_DATA) return mockDelay(MOCK_LTV_METRICS);
    return api.get<LtvMetrics>(`${BASE}/ltv-metrics`);
  },
};
