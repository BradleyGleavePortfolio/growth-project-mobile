/**
 * coachTeamApi — typed client for the coach team / gym / organization surface.
 *
 * The backend has not landed a first-class gym/org table yet. Until it does,
 * we model the team as a single optional record attached to the head coach
 * (`/coach/team`). This is enough to ship the SaaS surfaces the audit calls
 * out — business name, public team code, member roster — without inventing
 * data the backend can't honor.
 *
 * Endpoints consumed:
 *   GET    /coach/team           — current team profile (or 404 → "not set up")
 *   PUT    /coach/team           — upsert business name, public team code
 *   GET    /coach/team/members   — every sub-coach + head coach in the org
 *
 * 404 on `GET /coach/team` is the explicit "no team profile yet" signal
 * (vs. a 5xx which is "something went wrong, retry"). The screen renders a
 * setup CTA for the former and a retry banner for the latter.
 */

import api from '../services/api';
import type { AxiosResponse } from 'axios';

export interface TeamProfile {
  id: string;
  business_name: string;
  /**
   * Shareable team / gym code. Clients who sign up with this code are
   * attached to the head coach's organization rather than a single coach,
   * letting the head coach reassign them within the org.
   */
  team_code: string;
  /**
   * Total client capacity across the team (sum of seat limits across head
   * coach + sub-coaches). Surfaced so the head coach can see headroom at a
   * glance.
   */
  client_capacity: number;
  /**
   * Currently assigned across the team (active, non-archived).
   */
  clients_assigned: number;
  /**
   * Set by the backend when the head coach has connected Stripe Connect.
   * We surface it on the team screen so payouts and revenue stay one tap
   * away.
   */
  payouts_enabled: boolean;
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: 'head_coach' | 'sub_coach';
  assigned_clients: number;
  max_clients: number;
  created_at: string;
}

export type TeamResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: 'not_configured' }
  | { ok: false; reason: 'error'; message: string };

function wrap<T>(p: Promise<AxiosResponse<T>>): Promise<TeamResult<T>> {
  return p
    .then((r) => ({ ok: true as const, data: r.data }))
    .catch((err) => {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 404 || status === 501) {
        return { ok: false as const, reason: 'not_configured' as const };
      }
      const message =
        (err as { message?: string })?.message ?? 'Failed to load — try again.';
      return { ok: false as const, reason: 'error' as const, message };
    });
}

export const coachTeamApi = {
  getProfile: (): Promise<TeamResult<TeamProfile>> =>
    wrap(api.get<TeamProfile>('/coach/team')),

  upsertProfile: (payload: { business_name: string; team_code?: string }) =>
    api.put<TeamProfile>('/coach/team', payload),

  getMembers: (): Promise<TeamResult<TeamMember[]>> =>
    wrap(api.get<TeamMember[]>('/coach/team/members')),
};
