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
 * v11 (W-BRAND-AGREEMENT, owner op 1, 2026-10-19): v7 with TGP Fitness as the name in paragraphs 1
 * and 3 and box 1 (W34-W36). Every screen below moved to its successor the same way.
 */
export const CONSULT_CONSENT_COPY_VERSION = 'consult-consent-v11' as const;

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
 * W-BRAND-AGREEMENT: v12 is v8 with TGP Fitness.
 */
export const CONSULT_CONSENT_MEMORY_COPY_VERSION = 'consult-consent-v12' as const;

/**
 * CRISIS-APP-COPY (owner op 1, backend b#1041): client-ai-v6 / v7 and P0 v7 / v8 with the approved crisis
 * sentence right after the exception. The app asks GET ?variant=crisis_alert exactly while the server's
 * `roman_crisis_alert` flag is on, and shows (and records) these only when the server answers with them.
 * W-BRAND-AGREEMENT: P0 v13 / v14 are v9 / v10 with TGP Fitness.
 */
export const AI_CONSENT_CRISIS_VERSION = 'client-ai-v8' as const;
export const AI_CONSENT_CRISIS_MEMORY_VERSION = 'client-ai-v9' as const;
export const CONSULT_CONSENT_CRISIS_COPY_VERSION = 'consult-consent-v13' as const;
export const CONSULT_CONSENT_CRISIS_MEMORY_COPY_VERSION = 'consult-consent-v14' as const;

/**
 * Owner 62 (Option 1, 2026-10-12): a client with no coach sees the coach-free P0 (the coached text
 * with every coach sentence or clause removed). Owner 62y2 (Option 1): without paragraph 4 and box 2
 * (no Roman choice), footer "Nothing is sent until you continue." (consult-consent-v7-coach-free).
 * W-CONSENT asks the coached box 2 again under "Before you join a coach", so the record names that whole
 * screen (FIX684): consult-consent-v8-coach-free, or v9-coach-free when box 2 shows the server's memory
 * paragraph. A stored v7-coach-free record stays as it is (#CRISIS-OLD-CONSENT op 1: nobody is asked again).
 * The coach-free box 2 versions stay known so a grant recorded before is still read correctly.
 * W-BRAND-AGREEMENT: v12 / v13-coach-free are v8 / v9-coach-free with TGP Fitness (W34, W37, W38).
 */
export const CONSULT_CONSENT_COACH_FREE_COPY_VERSION = 'consult-consent-v12-coach-free' as const;
export const CONSULT_CONSENT_COACH_FREE_MEMORY_COPY_VERSION = 'consult-consent-v13-coach-free' as const;
export const CONSULT_CONSENT_COACH_FREE_PRE_ROMAN_COPY_VERSION = 'consult-consent-v7-coach-free' as const;
/**
 * FIXCONSENT (b#1046): v8 / v9-coach-free with paragraph 4 of consult-consent-v9 / v10 (the crisis copies
 * answered). W-BRAND-AGREEMENT: v14 / v15-coach-free are v10 / v11-coach-free with TGP Fitness.
 */
export const CONSULT_CONSENT_COACH_FREE_CRISIS_COPY_VERSION = 'consult-consent-v14-coach-free' as const;
export const CONSULT_CONSENT_COACH_FREE_CRISIS_MEMORY_COPY_VERSION = 'consult-consent-v15-coach-free' as const;

/**
 * CONSENT-M (owner #162-6, WEAR-AI-05, backend b#1117): the Health-notes copies, each the copy above with
 * one sentence after the purpose sentence. P0 asks GET ?variant=health_notes and shows (and records) these
 * only when the server answers with them. Box 2: client-ai-v12 / v13 (this build's v6 / v8 paragraph with the
 * sentence), client-ai-v10 / v11 (the server's v7 / v9 memory paragraph with it). P0: v17 / v18 (v11 / v13),
 * v15 / v16 (v12 / v14), v16 / v17-coach-free (v13 / v15-coach-free). No coach-free twin of v12 / v14-coach-free
 * exists, so a client with no coach and memory off keeps those (and client-ai-v6 / v8).
 */
export const AI_CONSENT_HEALTH_VERSION = 'client-ai-v12' as const;
export const AI_CONSENT_HEALTH_CRISIS_VERSION = 'client-ai-v13' as const;
export const AI_CONSENT_HEALTH_MEMORY_VERSION = 'client-ai-v10' as const;
export const AI_CONSENT_HEALTH_CRISIS_MEMORY_VERSION = 'client-ai-v11' as const;
export const CONSULT_CONSENT_HEALTH_COPY_VERSION = 'consult-consent-v17' as const;
export const CONSULT_CONSENT_HEALTH_CRISIS_COPY_VERSION = 'consult-consent-v18' as const;
export const CONSULT_CONSENT_HEALTH_MEMORY_COPY_VERSION = 'consult-consent-v15' as const;
export const CONSULT_CONSENT_HEALTH_CRISIS_MEMORY_COPY_VERSION = 'consult-consent-v16' as const;
export const CONSULT_CONSENT_COACH_FREE_HEALTH_MEMORY_COPY_VERSION = 'consult-consent-v16-coach-free' as const;
export const CONSULT_CONSENT_COACH_FREE_HEALTH_CRISIS_MEMORY_COPY_VERSION = 'consult-consent-v17-coach-free' as const;
/** The six Health-notes P0 screens: a stored agreement of one counts in this build. */
export const CONSULT_CONSENT_HEALTH_COPY_VERSIONS = [
  CONSULT_CONSENT_HEALTH_COPY_VERSION,
  CONSULT_CONSENT_HEALTH_CRISIS_COPY_VERSION,
  CONSULT_CONSENT_HEALTH_MEMORY_COPY_VERSION,
  CONSULT_CONSENT_HEALTH_CRISIS_MEMORY_COPY_VERSION,
  CONSULT_CONSENT_COACH_FREE_HEALTH_MEMORY_COPY_VERSION,
  CONSULT_CONSENT_COACH_FREE_HEALTH_CRISIS_MEMORY_COPY_VERSION,
] as const;

/**
 * W-BRAND-AGREEMENT (owner op 1: people who already agreed keep their record): the eight screens before
 * TGP Fitness. A stored agreement of one still counts in this build (nobody is asked again, as
 * #CRISIS-OLD-CONSENT op 1), and the server keeps accepting them.
 */
export const CONSULT_CONSENT_PRE_BRAND_COPY_VERSIONS = [
  'consult-consent-v7',
  'consult-consent-v8',
  'consult-consent-v9',
  'consult-consent-v10',
  'consult-consent-v8-coach-free',
  'consult-consent-v9-coach-free',
  'consult-consent-v10-coach-free',
  'consult-consent-v11-coach-free',
] as const;
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
