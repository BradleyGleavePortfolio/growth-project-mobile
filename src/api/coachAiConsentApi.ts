/**
 * COACH-AI-CONSENT: the signed-in coach's own choice whether Roman may send what they type, and their
 * coaching notes, to Anthropic (Apple 5.1.2(i)), over the existing consent ledger (backend
 * op152/coach-ai-consent-be, ai-consent.controller.ts; coach and owner roles, all idempotent):
 *   GET    /me/ai-consent/coach          -> CoachAiConsentStatus (`asked` is kept per account)
 *   POST   /me/ai-consent/coach          { version, copy_sha256, platform } -> grant
 *   POST   /me/ai-consent/coach/decline  same body -> "Not now" (kept only while never asked)
 *   DELETE /me/ai-consent/coach          -> withdraw (the Settings switch off)
 * Failures map as on the client routes (aiConsentFailure). A refused coach AI request is
 * 403 { code: 'coach_ai_consent_required' } (lib/ai/aiRefusal).
 */
import api from '../services/api';
import { aiConsentFailure, type AiConsentOutcome } from './aiConsentApi';
import { platformTag } from '../lib/consultation/aiConsent';
import { COACH_AI_CONSENT_COPY_SHA256, COACH_AI_CONSENT_VERSION } from '../lib/ai/coachAiConsentCopy';

export type CoachAiConsentState = 'not_asked' | 'declined' | 'granted' | 'withdrawn';

export interface CoachAiConsentStatus {
  /** True only for a live coach-ai-v1 grant (state "granted"). */
  granted: boolean;
  state: CoachAiConsentState;
  /** The one-time request was answered on this account (every state but not_asked). */
  asked: boolean;
}

export type CoachAiConsentOutcome =
  | { kind: 'ok'; status: CoachAiConsentStatus }
  | Exclude<AiConsentOutcome, { kind: 'ok' }>;

const STATES: readonly CoachAiConsentState[] = ['not_asked', 'declined', 'granted', 'withdrawn'];

/** Accept only a readable status body; anything else is "no status". */
export function parseCoachAiConsentStatus(body: unknown): CoachAiConsentStatus | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  const state = STATES.find((s) => s === b.state);
  if (!state || typeof b.granted !== 'boolean') return null;
  return { state, granted: b.granted && state === 'granted', asked: state !== 'not_asked' };
}

const decisionBody = () => ({
  version: COACH_AI_CONSENT_VERSION,
  copy_sha256: COACH_AI_CONSENT_COPY_SHA256,
  platform: platformTag(),
});

async function call(request: () => Promise<{ data?: unknown; status?: number }>): Promise<CoachAiConsentOutcome> {
  try {
    const res = await request();
    const status = parseCoachAiConsentStatus(res?.data);
    return status ? { kind: 'ok', status } : { kind: 'error', status: res?.status ?? null };
  } catch (err) {
    return aiConsentFailure(err);
  }
}

const URL = '/me/ai-consent/coach';

export const coachAiConsentApi = {
  getStatus: () => call(() => api.get<unknown>(URL)),
  grant: () => call(() => api.post<unknown>(URL, decisionBody())),
  decline: () => call(() => api.post<unknown>(`${URL}/decline`, decisionBody())),
  withdraw: () => call(() => api.delete<unknown>(URL)),
};

export type CoachAiConsentApi = typeof coachAiConsentApi;

/**
 * Sign-up (owner op 2 item 1): this account was just shown the box, ticked or not, so the one-time
 * sheet waits for the next app open (the server's `asked` still decides then).
 */
let askedAtSignUp: string | null = null;
export function markCoachAskedAtSignUp(userId: string | null): void {
  askedAtSignUp = userId;
}
export function coachAskedAtSignUp(userId: string | null | undefined): boolean {
  return !!userId && askedAtSignUp === userId;
}
