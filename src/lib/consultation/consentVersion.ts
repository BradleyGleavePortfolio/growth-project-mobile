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
 * v5 (owner C-6a, 2026-10-12): v3 without paragraph 3's referral-partner sentence.
 * v7 (owner 57c, 2026-10-12): v5 with the safety-reply exception in paragraph 4 (client-ai-v6).
 */
export const CONSULT_CONSENT_COPY_VERSION = 'consult-consent-v7' as const;

// Title of the consent screen (P0). Lives here, a module with no imports, so
// the screen definition (definitions.ts) and the hashed copy (copy.ts) share
// one literal without an import cycle (Opus C-310-13).
export const CONSENT_TITLE = 'Before we start';

/**
 * Server copy version of the box 2 AI processing paragraph and label (R2a).
 * v4 (backend #635): paragraph 4's retention sentence now says Roman chats
 * are kept until the client deletes them or their account (owner 2026-10-01
 * 20:32, OR-110-1); v3 named a fixed retention period, which was never true. The P0 version
 * moved to consult-consent-v3 with it, because the whole screen's text
 * changed (backend #607 must accept consult-consent-v3).
 * v6 (owner 57c, 2026-10-12): v4 plus the safety-reply exception sentence; the app asks the server for
 * it with GET ?variant=safety_exception.
 */
export const AI_CONSENT_VERSION = 'client-ai-v6' as const;

/**
 * Optional Roman memory permission (backend R11-C1, owner D1 10-06). The app holds no text for it: the
 * server sends it as `upgrade` only while Roman memory is on, and Settings > Privacy > Roman and AI shows
 * that text and grants this version with the server's sha256. First consent stays AI_CONSENT_VERSION.
 */
export const AI_CONSENT_MEMORY_VERSION = 'client-ai-v7' as const;

/**
 * The coached versions before owner 57c (client-ai-v4 / v5). A grant of them stays live; the server
 * keeps answering such a client with these copies, and this build still shows them.
 */
export const AI_CONSENT_PRE57C_VERSION = 'client-ai-v4' as const;
export const AI_CONSENT_PRE57C_MEMORY_VERSION = 'client-ai-v5' as const;

/**
 * R11-C2B (owner 10-07 10:18, Roman memory on by default): the P0 screen version when box 2 shows the
 * server's client-ai-v5 paragraph (backend consult-consent-v6: the v5 screen with that paragraph 4;
 * consult-consent-v4 before owner C-6a, v6 before owner 57c).
 * Otherwise P0 stays CONSULT_CONSENT_COPY_VERSION with this build's base paragraph.
 */
export const CONSULT_CONSENT_MEMORY_COPY_VERSION = 'consult-consent-v8' as const;

/**
 * CRISIS-APP-COPY (owner op 1, backend b#1041): client-ai-v6 / v7 and P0 v7 / v8 with the approved crisis
 * sentence right after the exception. The app asks GET ?variant=crisis_alert exactly while the server's
 * `roman_crisis_alert` flag is on, and shows (and records) these only when the server answers with them.
 */
export const AI_CONSENT_CRISIS_VERSION = 'client-ai-v8' as const;
export const AI_CONSENT_CRISIS_MEMORY_VERSION = 'client-ai-v9' as const;
export const CONSULT_CONSENT_CRISIS_COPY_VERSION = 'consult-consent-v9' as const;
export const CONSULT_CONSENT_CRISIS_MEMORY_COPY_VERSION = 'consult-consent-v10' as const;

/**
 * Owner 62 (Option 1, 2026-10-12): a client with no coach sees the coach-free P0 (the coached text
 * with every coach sentence or clause removed). Owner 62y2 (Option 1): without paragraph 4 and box 2
 * (no Roman choice), footer "Nothing is sent until you continue." (consult-consent-v7-coach-free).
 * W-CONSENT: that record stays; the screen asks the coached box 2 again, recorded by its grant.
 * The coach-free box 2 versions stay known so a grant recorded before is still read correctly.
 */
export const CONSULT_CONSENT_COACH_FREE_COPY_VERSION = 'consult-consent-v7-coach-free' as const;
export const AI_CONSENT_COACH_FREE_VERSION = 'client-ai-v4-coach-free' as const;
export const AI_CONSENT_COACH_FREE_MEMORY_VERSION = 'client-ai-v5-coach-free' as const;

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
