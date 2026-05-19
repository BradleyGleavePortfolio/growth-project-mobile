/**
 * talentMarketplaceApi — Phase 11 / Track 8
 *
 * Typed client for the Talent Marketplace backend endpoints.
 *
 * Scope for this PR: GET /applications/me (applicant reads own status).
 * Additional endpoints (pool search, offer operations, connect onboarding)
 * will be added in Track 8.5 when the head-coach browse UI ships.
 *
 * All backend communication goes through the shared `api` axios instance
 * (src/services/api.ts) which handles JWT auth, token refresh, and
 * base URL resolution. No API keys are held in mobile.
 */

import api from './api';

// ─── Types ─────────────────────────────────────────────────────────────────────

/** Mirrors CoachApplicationStatus enum from the backend schema. */
export type CoachApplicationStatus =
  | 'pending'
  | 'reviewed'
  | 'approved'
  | 'pool'
  | 'placed'
  | 'inactive';

/** Mirrors CoachClientType enum from the backend schema. */
export type CoachClientType = 'fitness' | 'wellness' | 'both';

/**
 * A coach application as returned by GET /applications/me.
 * Only non-PII fields are included in this response shape.
 */
export interface MyCoachApplication {
  id: string;
  status: CoachApplicationStatus;
  /** Admin reviewer notes, visible only once the application has been reviewed. */
  reviewer_notes: string | null;
  /** 1–5 score assigned by the reviewer. */
  reviewer_score: number | null;
  background_verified: boolean;
  certifications: string[];
  specializations: string[];
  years_experience: number;
  availability_hours_per_week: number;
  preferred_client_type: CoachClientType;
  created_at: string;
  updated_at: string;
}

// ─── API client ────────────────────────────────────────────────────────────────

export const talentMarketplaceApi = {
  /**
   * Returns all coach applications submitted by the authenticated user,
   * ordered newest-first. A user may have multiple applications (e.g. after
   * reapplying); the array is never empty if the user has applied at all.
   *
   * Maps to: GET /api/applications/me
   */
  getMyApplications: (): Promise<{ data: MyCoachApplication[] }> =>
    api.get<MyCoachApplication[]>('/applications/me'),
};
