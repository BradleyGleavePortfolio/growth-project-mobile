/**
 * STORE-E4 (agent 185; owner #184-E5 / #184-E6 op 1): the one-box "Before we start" (PERM-W1) includes the
 * community guidelines, so a client who agreed to it is not asked again at the first Community visit.
 * The server's record decides (GET /me/onboarding, a read the consultation already makes): a current
 * agreement on file (`consent_recorded`) whose P0 is one of the one-box versions. Coaches, and clients
 * who agreed to an older screen, keep the Community gate.
 */
import type { OnboardingStateResponse } from '../../api/consultationApi';
import { CONSULT_CONSENT_ONE_BOX_COPY_VERSIONS } from './consentVersion';

export function agreedToCommunityInConsultation(state: OnboardingStateResponse | null | undefined): boolean {
  if (!state || state.consent_recorded !== true) return false;
  const p0 = state.answers?.P0 as { agreed?: unknown; copy_version?: unknown } | null | undefined;
  return (
    !!p0 &&
    typeof p0 === 'object' &&
    p0.agreed === true &&
    typeof p0.copy_version === 'string' &&
    CONSULT_CONSENT_ONE_BOX_COPY_VERSIONS.includes(p0.copy_version)
  );
}
