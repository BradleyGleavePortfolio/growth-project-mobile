// PTM (Predictive Tracking Model) — typed mobile client.
//
// Wraps GET /admin/ptm/risk-board, GET /admin/ptm/clients/:id,
// GET /admin/ptm/outcomes, POST /admin/ptm/clients/:id/outcomes.
//
// Phase 1E doctrine:
//   - These endpoints are OWNER-only on the backend. The coach risk-board
//     screen gates by user.role==='owner' (the OWNER bypass on CoachGuard
//     keeps the screen functional). A coach-scoped variant lands later.
//   - Students NEVER see PTM scores. The screens that consume this client
//     are role-gated, but the engine basis (`heuristic_v1` / `weighted_v2`)
//     is not surfaced anywhere — only the score and the per-factor labels.

import api from './api';
import type { PtmRiskBucket } from '../types/ptm';

export interface PtmFactorDto {
  key: string;
  label: string;
  /** Sign-significant. Positive → adds risk, negative → protective. */
  contribution: number;
  observed?: number;
}

export interface RiskBoardEntry {
  user_id: string;
  name: string;
  email: string;
  risk_score: number;
  success_score: number;
  bucket: PtmRiskBucket;
  last_signal_at: string | null;
  outcome_label?: string | null;
}

export interface RiskBoardResponse {
  items: RiskBoardEntry[];
  next_cursor: string | null;
}

export interface PtmPredictionDto {
  id: string;
  computed_at: string;
  risk_score: number;
  success_score: number;
  factors: PtmFactorDto[];
}

export interface ClientPtmResponse {
  user: {
    id: string;
    name: string;
    email: string;
  };
  current: PtmPredictionDto;
  history: PtmPredictionDto[];
  outcome_label?: string | null;
}

export interface OutcomeHistoryEntry {
  user_id: string;
  user_name: string;
  outcome_type: string;
  notes?: string | null;
  labelled_at: string;
}

export interface OutcomeHistoryResponse {
  items: OutcomeHistoryEntry[];
  next_cursor: string | null;
}

export interface RiskBoardQuery {
  bucket?: PtmRiskBucket;
  cursor?: string;
  limit?: number;
}

export interface OutcomeHistoryQuery {
  outcome_type?: string;
  before?: string;
  limit?: number;
}

export interface LabelOutcomeBody {
  outcome_type: string;
  notes?: string;
}

const BASE = '/admin/ptm';

function qs(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') {
      search.set(k, String(v));
    }
  }
  const out = search.toString();
  return out ? `?${out}` : '';
}

export const ptmApi = {
  getRiskBoard: (query: RiskBoardQuery = {}) =>
    api.get<RiskBoardResponse>(
      `${BASE}/risk-board${qs({
        bucket: query.bucket,
        cursor: query.cursor,
        limit: query.limit,
      })}`,
    ),
  getClientPtm: (userId: string) =>
    api.get<ClientPtmResponse>(`${BASE}/clients/${encodeURIComponent(userId)}`),
  getOutcomeHistory: (query: OutcomeHistoryQuery = {}) =>
    api.get<OutcomeHistoryResponse>(
      `${BASE}/outcomes${qs({
        outcome_type: query.outcome_type,
        before: query.before,
        limit: query.limit,
      })}`,
    ),
  labelOutcome: (userId: string, body: LabelOutcomeBody) =>
    api.post<{ ok: true }>(
      `${BASE}/clients/${encodeURIComponent(userId)}/outcomes`,
      body,
    ),
};
