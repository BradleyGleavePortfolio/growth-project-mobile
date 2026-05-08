// PTM (Predictive Tracking Model) — typed mobile client.
//
// Wraps GET /admin/ptm/risk-board, GET /admin/ptm/clients/:id,
// GET /admin/ptm/outcomes, POST /admin/ptm/clients/:id/outcomes,
// and (Phase 1E coach scope) GET /coach/clients/risk-board.
//
// Phase 1E doctrine:
//   - The OWNER endpoints under /admin/ptm/* are reachable by an OWNER
//     token only (CoachGuard's OWNER bypass does not extend to /admin).
//   - The coach endpoint /coach/clients/risk-board returns the same
//     envelope shape as /admin/ptm/risk-board EXCEPT `risk_score` and
//     `success_score` are returned as `null` — a coach is authorised to
//     act on the bucket, never the raw model output. The screen renders
//     the bucket via RiskDot regardless of source; only the OWNER branch
//     surfaces the numeric percentage.
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
  /**
   * Numeric risk score in [0, 1]. Returned by the OWNER endpoint;
   * the coach-scoped endpoint sets this to `null` so the raw model
   * output never leaves the server for non-owners. Render via the
   * `bucket` field instead when this is null.
   */
  risk_score: number | null;
  /** Mirror of risk_score: nulled on the coach-scoped endpoint. */
  success_score: number | null;
  bucket: PtmRiskBucket;
  last_signal_at?: string | null;
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

// Backend envelope. The fitness backend returns `{ data, next_cursor,
// generated_at }`. This client adapts it to the mobile-facing `{ items,
// next_cursor }` shape so screens never have to know which endpoint
// they came from.
interface BackendRiskBoardRow {
  user_id: string;
  email: string;
  role: string;
  name: string;
  risk_score: number | null;
  success_score: number | null;
  bucket: PtmRiskBucket;
  computed_at?: string;
  factors_count?: number;
  last_signal_at?: string | null;
  outcome_label?: string | null;
}
interface BackendRiskBoardEnvelope {
  data: BackendRiskBoardRow[];
  next_cursor: string | null;
  generated_at?: string;
}

function normalizeRiskBoard(env: BackendRiskBoardEnvelope): RiskBoardResponse {
  return {
    items: (env.data ?? []).map((r) => ({
      user_id: r.user_id,
      name: r.name,
      email: r.email,
      risk_score: r.risk_score,
      success_score: r.success_score,
      bucket: r.bucket,
      last_signal_at: r.last_signal_at ?? null,
      outcome_label: r.outcome_label ?? null,
    })),
    next_cursor: env.next_cursor ?? null,
  };
}

export const ptmApi = {
  getRiskBoard: async (query: RiskBoardQuery = {}): Promise<{ data: RiskBoardResponse }> => {
    const res = await api.get<BackendRiskBoardEnvelope>(
      `${BASE}/risk-board${qs({
        bucket: query.bucket,
        cursor: query.cursor,
        limit: query.limit,
      })}`,
    );
    return { data: normalizeRiskBoard(res.data) };
  },
  /**
   * Coach-scoped risk board (Phase 1E). Mirrors the OWNER endpoint
   * but reads only the calling coach's roster and redacts the raw
   * `risk_score` / `success_score`. Use this in any role !== 'owner'
   * branch.
   */
  getMyRiskBoard: async (query: RiskBoardQuery = {}): Promise<{ data: RiskBoardResponse }> => {
    const res = await api.get<BackendRiskBoardEnvelope>(
      `/coach/clients/risk-board${qs({
        bucket: query.bucket,
        cursor: query.cursor,
        limit: query.limit,
      })}`,
    );
    return { data: normalizeRiskBoard(res.data) };
  },
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
