/**
 * subCoachApi
 *
 * Typed client for the sub-coach management endpoints introduced in
 * Phase 11 / Track 7. All calls route through the shared Axios instance
 * so auth tokens and the token-refresh mutex are handled automatically.
 *
 * Endpoints consumed:
 *   GET  /sub-coaches
 *   GET  /sub-coaches/:id
 *   POST /sub-coaches/:id/reassign-client
 *   GET  /sub-coaches/:id/analytics
 */

import api from '../services/api';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SubCoachCapacity {
  subCoachId: string;
  assignedClients: number;
  maxClients: number;
  planTier: string;
  hasCapacity: boolean;
}

export interface EngagementBreakdown {
  logged_in_within_7d: number;
  messaged_within_48h_of_checkin: number;
  updated_workout_plan_this_week: number;
  avg_workout_completion_gte_70: number;
}

export interface EngagementScore {
  subCoachId: string;
  score: number;
  breakdown: EngagementBreakdown;
}

export interface SubCoachSummary {
  id: string;
  name: string;
  email: string;
  created_at: string;
  coach_profile: {
    plan_tier: string;
    business_name: string | null;
  } | null;
  capacity: SubCoachCapacity;
  engagement: EngagementScore;
}

export interface SubCoachClient {
  id: string;
  name: string;
  email: string;
  created_at: string;
  archived_at: string | null;
}

export interface SubCoachDetail extends SubCoachSummary {
  clients: SubCoachClient[];
  coach_profile: {
    plan_tier: string;
    business_name: string | null;
    bio: string | null;
  } | null;
}

export interface ReassignResult {
  clientId: string;
  previousCoachId: string | null;
  newCoachId: string;
  auditLogId: string;
}

// ─── API ──────────────────────────────────────────────────────────────────────

export interface SubCoachInviteResult {
  inviteId: string;
  email: string;
  inviteUrl: string;
  expires_at: string;
}

export interface SubCoachInvitePayload {
  email: string;
  /** Optional name to pre-fill the sub-coach's profile on accept. */
  name?: string;
  /** Optional ceiling on how many clients the sub-coach may take. */
  maxClients?: number;
}

export const subCoachApi = {
  /** List all sub-coaches under the calling head coach. */
  listSubCoaches: () =>
    api.get<SubCoachSummary[]>('/sub-coaches'),

  /** Get a single sub-coach with their client list and engagement score. */
  getSubCoach: (subCoachId: string) =>
    api.get<SubCoachDetail>(`/sub-coaches/${subCoachId}`),

  /** Get the engagement score breakdown for a sub-coach. */
  getAnalytics: (subCoachId: string) =>
    api.get<EngagementScore>(`/sub-coaches/${subCoachId}/analytics`),

  /**
   * Atomically reassign a client to a different sub-coach.
   * Pass the HEAD COACH's id as subCoachId to move the client back to the
   * head coach directly.
   */
  reassignClient: (
    toSubCoachId: string,
    payload: { clientId: string; reason?: string },
  ) =>
    api.post<ReassignResult>(
      `/sub-coaches/${toSubCoachId}/reassign-client`,
      payload,
    ),

  /**
   * Invite a sub-coach by email. Backend creates a sub-coach invite and
   * emails an accept link. Returns the invite metadata plus a shareable URL
   * so the head coach can fall back to copy/paste if email fails.
   */
  invite: (payload: SubCoachInvitePayload) =>
    api.post<SubCoachInviteResult>('/sub-coaches/invites', {
      email: payload.email,
      name: payload.name ?? null,
      max_clients: payload.maxClients ?? null,
    }),

  /**
   * Revoke a sub-coach. The backend reassigns any active clients back to the
   * head coach as part of the transaction; we surface the count returned in
   * `reassignedClientCount` to the caller for the confirmation toast.
   */
  revoke: (subCoachId: string, payload: { reason?: string } = {}) =>
    api.post<{ ok: true; reassignedClientCount: number }>(
      `/sub-coaches/${subCoachId}/revoke`,
      payload,
    ),
};
