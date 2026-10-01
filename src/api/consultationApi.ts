/**
 * consultationApi: typed client for the consultation onboarding contract
 * (clinic_ops/specs/onboarding_contract.md, consult-v1).
 *
 *   PUT  /me/onboarding/consultation  idempotent save of partial or full answers
 *   GET  /me/onboarding               saved answers, completion state, result
 *   POST /me/onboarding/complete      idempotent; 409 with a machine code
 *   POST /me/ai-consent/onboarding    the single P0 "I agree" box: AI processing
 *                                     grant + training waiver (backend #601)
 *   GET  /me/ai-consent               the consent record (granted, versions,
 *                                     revoked_at), used to verify a stored P0
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
  | { kind: 'conflict'; code: CompleteConflictCode | 'unknown' }
  | { kind: 'error'; status: number | null };

/** POST /me/ai-consent/onboarding body (backend #601 GrantOnboardingConsentDto). */
export interface GrantOnboardingConsentRequest {
  ai_consent_version: string;
  waiver_version: string;
  copy_sha256?: string;
  platform?: 'ios' | 'android' | 'web';
  app_version?: string;
  locale?: string;
}

/** GET /me/ai-consent (and the grant response), the fields mobile reads. */
export interface ConsentStatusResponse {
  roman: {
    granted: boolean;
    version: string | null;
    granted_at: string | null;
    revoked_at: string | null;
    current_version: string;
    needs_reconsent?: boolean;
    waiver_version?: string | null;
    waiver_accepted_at?: string | null;
    waiver_current_version?: string;
  };
}

export type GrantConsentOutcome =
  | { kind: 'ok'; status: ConsentStatusResponse | null }
  /** 409 CONSENT_VERSION_MISMATCH: the server requires different copy. Fail closed. */
  | { kind: 'version_mismatch'; current_version: string | null; waiver_current_version: string | null }
  | { kind: 'error'; status: number | null };

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
      if (status === 409) return { kind: 'conflict', code: conflictCodeOf(err) };
      return { kind: 'error', status };
    }
  },

  /**
   * Record the single P0 agreement. Resolves (never throws) so the caller can
   * fail closed on every non-2xx outcome.
   */
  grantOnboardingConsent: async (body: GrantOnboardingConsentRequest): Promise<GrantConsentOutcome> => {
    try {
      const res = await api.post<ConsentStatusResponse>('/me/ai-consent/onboarding', body);
      return { kind: 'ok', status: res?.data ?? null };
    } catch (err) {
      const status = httpStatusOf(err);
      if (status === 409 && rawCodeOf(err) === 'CONSENT_VERSION_MISMATCH') {
        const data = (err as AxiosLikeError).response?.data as Record<string, unknown> | undefined;
        return {
          kind: 'version_mismatch',
          current_version: typeof data?.current_version === 'string' ? data.current_version : null,
          waiver_current_version: typeof data?.waiver_current_version === 'string' ? data.waiver_current_version : null,
        };
      }
      return { kind: 'error', status };
    }
  },

  /** The server consent record. Throws on network failure; 404 also throws (unverifiable). */
  getConsentStatus: async (): Promise<ConsentStatusResponse> => {
    const res = await api.get<ConsentStatusResponse>('/me/ai-consent');
    return res.data;
  },
};

export default consultationApi;
