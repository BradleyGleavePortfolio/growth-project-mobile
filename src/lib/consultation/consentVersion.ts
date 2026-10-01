/**
 * P0 consent versions, kept in their own module so the pure engine can check
 * a stored agreement without importing the copy (which imports the engine).
 */

/**
 * Version of the combined waiver + data visibility text shown at P0. Backend
 * #607 accepts only the versions in its CONSULT_CONSENT_COPY_VERSIONS
 * (default 'consult-consent-v1') and rejects any other with 409
 * consent_missing, so the two sides move together.
 *
 * The text was revised in the PR #310 fix round (box moved to directly after
 * W1, the coach's AI drafts and how to withdraw added) before any release:
 * the consultation is behind a feature flag that is off, so no client has
 * agreed to an earlier text. v1 therefore names the first released copy. Any
 * later change to the P0 text needs a new version here AND on the backend.
 */
export const CONSULT_CONSENT_COPY_VERSION = 'consult-consent-v1' as const;

/**
 * The server-side versions the displayed P0 copy is bound to. Ticking the box
 * records POST /me/ai-consent/onboarding with exactly these versions (backend
 * #601: AI processing grant + personal-training waiver in one call). The
 * server rejects any other version with 409 CONSENT_VERSION_MISMATCH; the app
 * then fails closed (nothing is uploaded) and asks for an app update. A change
 * to either server version needs new P0 copy and a new
 * CONSULT_CONSENT_COPY_VERSION, never a silent remap.
 */
export const CONSENT_BINDING = {
  copy_version: CONSULT_CONSENT_COPY_VERSION,
  ai_consent_version: 'client-ai-v2',
  waiver_version: 'pt-waiver-v1',
} as const;
