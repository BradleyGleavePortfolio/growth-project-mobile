/**
 * Box 2 of the P0 agreement (D2): the optional Roman and AI grant, recorded
 * by the AI consent ledger (R2a) and never by the intake.
 *
 * Non-blocking by contract: a failure never blocks onboarding, plan
 * assignment, coach messaging, community, wearables, the scripted Roman
 * tutorial, the welcome message or reminders. A failed call is retried once
 * and otherwise left for Settings > Privacy > Roman and AI. While the ledger
 * is not deployed (404) or switched off (503) the call is skipped silently.
 */
import { Platform } from 'react-native';
import type { AiConsentOutcome, GrantRomanConsentRequest } from '../../api/aiConsentApi';
import { AI_CONSENT_COPY_SHA256 } from './copy';
import { AI_CONSENT_VERSION } from './consentVersion';

export type RomanGrantResult = 'granted' | 'unavailable' | 'version_mismatch' | 'failed';

export function platformTag(): 'ios' | 'android' | 'web' {
  return Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';
}

/** The exact grant body for the box 2 text this build displays. */
export function romanGrantBody(): GrantRomanConsentRequest {
  return { version: AI_CONSENT_VERSION, copy_sha256: AI_CONSENT_COPY_SHA256, platform: platformTag() };
}

/**
 * POST the box 2 grant (backend #622 error table, operator ruling
 * 2026-10-01): one retry on a transient failure (network, 5xx other than
 * 503, 409 AI_CONSENT_CONFLICT). 404 (ledger not deployed) and 503
 * AI_CONSENT_UNAVAILABLE (switch off) are skipped silently; 400 and 409
 * CONSENT_VERSION_MISMATCH are not retried. Whatever is left goes to Settings.
 */
export async function grantRomanWithRetry(
  grant: (body: GrantRomanConsentRequest) => Promise<AiConsentOutcome>,
): Promise<RomanGrantResult> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let out: AiConsentOutcome;
    try {
      out = await grant(romanGrantBody());
    } catch {
      out = { kind: 'error', status: null };
    }
    if (out.kind === 'ok') return 'granted';
    if (out.kind === 'version_mismatch') return 'version_mismatch';
    if (out.kind === 'unavailable') return 'unavailable';
    if (out.kind === 'error' && out.status === 400) return 'failed'; // a bug; do not retry as-is
  }
  return 'failed';
}

export type RomanWithdrawResult = 'withdrawn' | 'failed';

/**
 * DELETE the box 2 grant when the client unticks it on a return to P0
 * (Opus B-310-2): exactly one retry on anything but a confirmed result,
 * except 400 / 404 (nothing to retry against). Unconfirmed is reported so
 * the flow can keep box 2 truthful and point to Settings.
 */
export async function withdrawRomanWithRetry(withdraw: () => Promise<AiConsentOutcome>): Promise<RomanWithdrawResult> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let out: AiConsentOutcome;
    try {
      out = await withdraw();
    } catch {
      out = { kind: 'error', status: null };
    }
    if (out.kind === 'ok') return 'withdrawn';
    if (out.kind === 'unavailable' && out.status === 404) return 'failed';
    if (out.kind === 'error' && out.status === 400) return 'failed';
  }
  return 'failed';
}
