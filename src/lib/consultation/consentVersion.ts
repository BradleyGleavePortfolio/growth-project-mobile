/**
 * P0 consent versions, kept in their own module so the pure engine can check
 * a stored agreement without importing the copy (which imports the engine).
 *
 * D2 (operator ruling 2026-10-01, Washington RCW 19.373): P0 shows TWO boxes
 * on the same screen.
 *   Box 1 (required): the personal-training waiver plus collection and use of
 *   the client's information by The Growth Project and their coach for
 *   coaching. Recorded by the onboarding intake (backend #607): the P0 answer
 *   carries `copy_version` and the agreement time; #607 stores
 *   disclaimer_version / disclaimer_accepted_at before any other answer.
 *   Box 2 (optional, unticked by default): Roman and the coach's AI drafts,
 *   processed by Anthropic. Recorded by the AI consent ledger (backend R2a):
 *   POST /me/ai-consent/roman { version: AI_CONSENT_VERSION }, withdrawn with
 *   DELETE /me/ai-consent/roman (Settings > Privacy > Roman and AI).
 */

/**
 * Version of the P0 screen copy (both boxes). Backend #607 accepts only the
 * versions in CONSULT_CONSENT_COPY_VERSIONS (default 'consult-consent-v2'
 * with D2; it must become 'consult-consent-v3' with this copy) and rejects any other P0 with 409
 * consent_missing, so the two sides move together. Any change to the P0
 * text needs a new version here AND on the backend.
 */
export const CONSULT_CONSENT_COPY_VERSION = 'consult-consent-v3' as const;

/**
 * Server copy version of the box 2 AI processing paragraph and label (R2a).
 * v4 (backend #635): paragraph 4's retention sentence now says Roman chats
 * are kept until the client deletes them or their account (owner 2026-10-01
 * 20:32, OR-110-1); v3 said 180 days, which was never true. The P0 version
 * moved to consult-consent-v3 with it, because the whole screen's text
 * changed (backend #607 must accept consult-consent-v3).
 */
export const AI_CONSENT_VERSION = 'client-ai-v4' as const;

/** Personal-training waiver version that box 1 records (via the intake). */
export const WAIVER_VERSION = 'pt-waiver-v1' as const;

/**
 * What the displayed P0 copy is bound to. Box 1 is the intake's P0 record
 * (`copy_version`, plus `text_sha256` of the box 1 text); box 2 is the R2a
 * grant (`version`, plus `copy_sha256` of the box 2 text). The server
 * rejects any other AI version with 409 CONSENT_VERSION_MISMATCH; the app
 * then records nothing for box 2 and asks for an update in Settings. A
 * change to any version needs new copy here, never a silent remap.
 */
export const CONSENT_BINDING = {
  copy_version: CONSULT_CONSENT_COPY_VERSION,
  ai_consent_version: AI_CONSENT_VERSION,
  waiver_version: WAIVER_VERSION,
} as const;
