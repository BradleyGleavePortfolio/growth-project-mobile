/**
 * consultationApi: typed client for the consultation onboarding contract
 * (clinic_ops/specs/onboarding_contract.md, consult-v1).
 *
 *   PUT  /me/onboarding/consultation  idempotent save of partial or full answers
 *   GET  /me/onboarding               saved answers, completion state, result
 *   POST /me/onboarding/complete      idempotent; 409 with a machine code
 *   POST /me/ai-consent/roman         combined P0 consent (backend R2 consent record)
 *
 * The base URL already ends in `/api` (see `config/env.ts`), so paths here
 * start at `/me`. Every call goes through the shared axios instance, so auth
 * and refresh behave like the rest of the app.
 */
import api from '../services/api';
import type { Answers } from '../lib/consultation/types';

export type ConsultationVersion = 'consult-v1';

// ─── DTOs ────────────────────────────────────────────────────────────────────

export interface SaveConsultationRequest {
  version: ConsultationVersion;
  answers: Answers;
}

export interface SaveConsultationResponse {
  saved_at: string;
  completed_chapters: number[];
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
  name: string;
  days_per_week: number;
  weeks: number;
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
}

export interface OnboardingStateResponse {
  version?: ConsultationVersion;
  answers: Answers | null;
  completed: boolean;
  completed_chapters?: number[];
  /** Present after completion: the same payload as POST /complete. */
  result?: CompleteOnboardingResponse | null;
}

export const COMPLETE_CONFLICT_CODES = ['not_attached', 'consultation_incomplete', 'consent_missing'] as const;
export type CompleteConflictCode = (typeof COMPLETE_CONFLICT_CODES)[number];

export type CompleteOutcome =
  | { kind: 'ok'; data: CompleteOnboardingResponse }
  | { kind: 'conflict'; code: CompleteConflictCode | 'unknown' }
  | { kind: 'error'; status: number | null };

export interface GrantConsentRequest {
  version: string;
  copy_sha256?: string;
  platform?: 'ios' | 'android' | 'web';
  app_version?: string;
  locale?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface AxiosLikeError {
  response?: { status?: number; data?: unknown };
}

export function httpStatusOf(err: unknown): number | null {
  const s = (err as AxiosLikeError)?.response?.status;
  return typeof s === 'number' ? s : null;
}

/** Read the machine code from a 409 body: `{code}`, `{error}` or `{message}`. */
export function conflictCodeOf(err: unknown): CompleteConflictCode | 'unknown' {
  const data = (err as AxiosLikeError)?.response?.data as Record<string, unknown> | undefined;
  const raw = [data?.code, data?.error, data?.message].find((x) => typeof x === 'string') as string | undefined;
  const hit = COMPLETE_CONFLICT_CODES.find((c) => c === raw);
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
      if (status === 409) return { kind: 'conflict', code: conflictCodeOf(err) };
      return { kind: 'error', status };
    }
  },

  grantConsent: async (body: GrantConsentRequest): Promise<void> => {
    await api.post('/me/ai-consent/roman', body);
  },
};

export default consultationApi;
