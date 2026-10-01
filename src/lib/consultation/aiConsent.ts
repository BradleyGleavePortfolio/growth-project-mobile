/**
 * Box 2 of the P0 agreement (D2): the optional Roman and AI grant, recorded
 * by the AI consent ledger (R2a) and never by the intake.
 *
 * Non-blocking by contract: a failure never blocks onboarding, plan
 * assignment, coach messaging, community, wearables, the scripted Roman
 * tutorial, the welcome message or reminders. A failed call is retried once
 * and otherwise left for Settings > Privacy > Roman and AI. While the ledger
 * is not deployed (404 / 503) the call is skipped silently.
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

/** POST the box 2 grant; one retry on a transient failure, none on 404/503/409. */
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
    if (out.kind === 'unavailable') return 'unavailable';
    if (out.kind === 'version_mismatch') return 'version_mismatch';
  }
  return 'failed';
}
