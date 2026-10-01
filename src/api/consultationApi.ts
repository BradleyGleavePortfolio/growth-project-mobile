/**
 * consultationApi: typed client for the consultation onboarding contract
 * (clinic_ops/specs/onboarding_contract.md, consult-v1).
 *
 *   PUT  /me/onboarding/consultation  idempotent save of partial or full answers
 *   GET  /me/onboarding               saved answers, completion state, result
 *   POST /me/onboarding/complete      idempotent; 409 with a machine code
 *
 * Box 1 of the P0 agreement (waiver, collection and use for coaching) is the
 * P0 answer saved through PUT /me/onboarding/consultation (backend #607
 * stores disclaimer_version / disclaimer_accepted_at from it). Box 2 (Roman
 * and AI) lives in the AI consent ledger, see `aiConsentApi.ts` (D2 ruling;
 * the combined POST /me/ai-consent/onboarding is no longer used).
 *
 * The base URL already ends in `/api` (see `config/env.ts`), so paths here
 * start at `/me`. Every call goes through the shared axios instance, so auth
 * and refresh behave like the rest of the app.
 */
import api from '../services/api';
import type { Answers } from '../lib/consultation/types';
import { supportReferenceOf } from '../utils/correlation';

export type ConsultationVersion = 'consult-v1';

// ─── DTOs ────────────────────────────────────────────────────────────────────

export interface SaveConsultationRequest {
  version: ConsultationVersion;
  answers: Answers;
}

export interface SaveConsultationResponse {
  saved_at: string;
  completed_chapters: Array<number | string>;
  /** Server intake revision after this save (backend #607). */
  revision?: number;
}

export interface OnboardingMacros {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  method: string;
  floor_applied: boolean;
}

export interface OnboardingProgram {
  id: string;
  /** Backend #607 program rule key (one of the three clinic programs). */
  key?: string;
  name: string;
  days_per_week: number;
  weeks: number;
  /** First training day, YYYY-MM-DD (backend #607). */
  start_date?: string;
  /** Three short reasons tied to the client's answers. */
  why: string[];
}

export interface OnboardingSpace {
  id: string;
  name: string;
}

export interface OnboardingCoach {
  id: string;
  display_name: string;
}

export interface CompleteOnboardingResponse {
  macros: OnboardingMacros;
  program: OnboardingProgram;
  spaces: OnboardingSpace[];
  coach: OnboardingCoach;
  /**
   * Backend #607 (owner ruling 09-30 18:11): clients who have never tracked
   * see calories and protein only in week one ('simple'), until
   * `simple_until`; everyone else sees all four ('full').
   */
  macro_display_mode?: 'simple' | 'full';
  simple_until?: string | null;
}

export interface OnboardingStateResponse {
  version?: ConsultationVersion;
  answers: Answers | null;
  completed: boolean;
  completed_chapters?: Array<number | string>;
  /** When the server copy was last saved, and its revision (resume reconciliation). */
  saved_at?: string | null;
  revision?: number | null;
  /** Backend #607: whether a current-version agreement is on file. */
  consent_recorded?: boolean;
  /** Present after completion: the same payload as POST /complete. */
  result?: CompleteOnboardingResponse | null;
}

export const COMPLETE_CONFLICT_CODES = [
  'not_attached',
  'consultation_incomplete',
  'consent_missing',
  'consent_version_mismatch',
  'clinic_not_configured',
  'completion_in_progress',
] as const;
export type CompleteConflictCode = (typeof COMPLETE_CONFLICT_CODES)[number];

export type CompleteOutcome =
  | { kind: 'ok'; data: CompleteOnboardingResponse }
  /** `requestId`: the support reference of the failed request, when known (owner rule 13:34). */
  | { kind: 'conflict'; code: CompleteConflictCode | 'unknown'; requestId?: string | null }
  | { kind: 'error'; status: number | null; requestId?: string | null };

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface AxiosLikeError {
  response?: { status?: number; data?: unknown };
}

export function httpStatusOf(err: unknown): number | null {
  const s = (err as AxiosLikeError)?.response?.status;
  return typeof s === 'number' ? s : null;
}

function rawCodeOf(err: unknown): string | undefined {
  const data = (err as AxiosLikeError)?.response?.data as Record<string, unknown> | undefined;
  return [data?.code, data?.error, data?.message].find((x) => typeof x === 'string') as string | undefined;
}

/**
 * Read the machine code from a 409 body: `{code}`, `{error}` or `{message}`.
 * The consent service's upper-case `CONSENT_VERSION_MISMATCH` maps to
 * `consent_version_mismatch`.
 */
export function conflictCodeOf(err: unknown): CompleteConflictCode | 'unknown' {
  const raw = rawCodeOf(err);
  const norm = raw === 'CONSENT_VERSION_MISMATCH' ? 'consent_version_mismatch' : raw;
  const hit = COMPLETE_CONFLICT_CODES.find((c) => c === norm);
  return hit ?? 'unknown';
}

// ─── Calls ───────────────────────────────────────────────────────────────────

export const consultationApi = {
  save: async (body: SaveConsultationRequest): Promise<SaveConsultationResponse> => {
    const res = await api.put<SaveConsultationResponse>('/me/onboarding/consultation', body);
    return res.data;
  },

  /** Returns null when the endpoint is absent (404) so resume falls back to local state. */
  getState: async (): Promise<OnboardingStateResponse | null> => {
    try {
      const res = await api.get<OnboardingStateResponse>('/me/onboarding');
      return res.data;
    } catch (err) {
      if (httpStatusOf(err) === 404) return null;
      throw err;
    }
  },

  complete: async (): Promise<CompleteOutcome> => {
    try {
      const res = await api.post<CompleteOnboardingResponse>('/me/onboarding/complete', {});
      return { kind: 'ok', data: res.data };
    } catch (err) {
      const status = httpStatusOf(err);
      const requestId = status === null ? null : supportReferenceOf(err);
      const ref = requestId ? { requestId } : {};
      if (status === 409) return { kind: 'conflict', code: conflictCodeOf(err), ...ref };
      return { kind: 'error', status, ...ref };
    }
  },
};

export default consultationApi;
