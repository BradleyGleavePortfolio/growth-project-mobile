/**
 * STORE-E4 (agent 185; owner #184-E5 / #184-E6 op 1): one box at "Before we start", Roman's AI asked
 * the first time Roman opens.
 *
 *  - The box and footer are PERM-W1 / PERM-W2 word for word; with no coach, PERM-W1 minus " and my coach".
 *  - The record's sha256 is the hash of the exact screen text and equals the backend pins (b#1188:
 *    CONSULT_CONSENT_V19 / CONSULT_CONSENT_V18_COACH_FREE).
 *  - Both versions count as current; the older screens stay pinned and still count.
 *  - "Before we start" no longer grants Roman: no grant call from the consultation.
 *  - "Before Roman answers" opens with PERM-W3; the coach's Create account box is PERM-W4.
 */
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import {
  CONSENT_COPY_SHA256_V18_COACH_FREE,
  CONSENT_COPY_SHA256_V19,
  ONE_BOX_CHECKBOX_LABEL,
  ONE_BOX_CHECKBOX_LABEL_COACH_FREE,
  ONE_BOX_FOOTER,
  consentScreenCopy,
  oneBoxConsentCopyText,
  oneBoxConsentScreenCopy,
} from '../copy';
import {
  CONSULT_CONSENT_COPY_VERSION,
  CONSULT_CONSENT_ONE_BOX_COACH_FREE_COPY_VERSION,
  CONSULT_CONSENT_ONE_BOX_COPY_VERSION,
  CONSULT_CONSENT_ONE_BOX_COPY_VERSIONS,
} from '../consentVersion';
import { isConsentAnswerCurrent } from '../engine';

const ROOT = path.join(__dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

const PERM_W1 =
  'I agree to the Terms of Service, Privacy Policy, Consumer Health Data Privacy Policy, community guidelines and training waiver. TGP Fitness and my coach may collect and use what I share, including health data I connect, to coach me. Photos I post in Community are checked for safety by OpenAI. TGP Fitness may send me plan renewal offers, which I can turn off in Settings.';
const PERM_W2 = "Nothing is sent until you continue. Roman's AI is a separate choice the first time you open Roman.";
const PERM_W3 =
  "Roman's AI runs on Anthropic, an outside AI company. Allow it to use your information to answer you? You can turn it off at any time in Settings > Privacy.";
const PERM_W4 =
  'I agree to the Terms of Service and Privacy Policy, and TGP Fitness may send me service and plan notices.';

/** Backend b#1188 pins (src/onboarding/consult-consent-copy.ts). */
const BACKEND_V19_SHA = '0959f38db47448d99d943c995b0a857454d181f3ec803e96967882b3d575ccea';
const BACKEND_V18_COACH_FREE_SHA = '9350dfbed5f332e0e99ea4e554731d0e8876ea5581873d6c984be3d23a149e99';

describe('one-box Before we start (STORE-E4)', () => {
  it('the box and footer are the approved rows word for word', () => {
    expect(ONE_BOX_CHECKBOX_LABEL).toBe(PERM_W1);
    expect(ONE_BOX_CHECKBOX_LABEL_COACH_FREE).toBe(PERM_W1.replace(' and my coach', ''));
    expect(ONE_BOX_FOOTER).toBe(PERM_W2);
  });

  it('the record hash is the hash of the screen text and equals the backend pins', () => {
    expect(sha(oneBoxConsentCopyText(false))).toBe(CONSENT_COPY_SHA256_V19);
    expect(sha(oneBoxConsentCopyText(true))).toBe(CONSENT_COPY_SHA256_V18_COACH_FREE);
    expect(CONSENT_COPY_SHA256_V19).toBe(BACKEND_V19_SHA);
    expect(CONSENT_COPY_SHA256_V18_COACH_FREE).toBe(BACKEND_V18_COACH_FREE_SHA);
  });

  it('coached and coach-free screens record their own version', () => {
    const coached = oneBoxConsentScreenCopy(false);
    const coachFree = oneBoxConsentScreenCopy(true);
    expect(coached).toMatchObject({ version: 'consult-consent-v19', boxLabel: PERM_W1, footer: PERM_W2 });
    expect(coachFree).toMatchObject({ version: 'consult-consent-v18-coach-free', footer: PERM_W2 });
    expect(CONSULT_CONSENT_ONE_BOX_COPY_VERSION).toBe('consult-consent-v19');
    expect(CONSULT_CONSENT_ONE_BOX_COACH_FREE_COPY_VERSION).toBe('consult-consent-v18-coach-free');
  });

  it('both one-box versions are current, and the older screens still count', () => {
    const p0 = (copy_version: string) => ({ agreed: true, agreed_at: '2026-10-30T03:00:00.000Z', copy_version }) as never;
    for (const v of CONSULT_CONSENT_ONE_BOX_COPY_VERSIONS) expect(isConsentAnswerCurrent(p0(v))).toBe(true);
    expect(isConsentAnswerCurrent(p0(CONSULT_CONSENT_COPY_VERSION))).toBe(true);
    expect(isConsentAnswerCurrent(p0('consult-consent-v20'))).toBe(false);
    expect(consentScreenCopy(false).version).toBe(CONSULT_CONSENT_COPY_VERSION);
  });

  it('Before we start shows one box and makes no Roman grant', () => {
    const question = read('screens/consultation/QuestionScreen.tsx');
    const flow = read('screens/consultation/ConsultationFlow.tsx');
    expect(question).toContain('oneBoxConsentScreenCopy');
    expect(question).not.toMatch(/consent-checkbox-roman|AI_GRANT_NOTICE/);
    expect(flow).not.toMatch(/grantRomanConsent|grantRomanWithRetry|AI_GRANT_NOTICE/);
  });

  it('Before Roman answers opens with PERM-W3; the coach Create account box is PERM-W4', () => {
    const sheet = read('components/ai/AiConsentSheet.tsx');
    expect(sheet).toContain(JSON.stringify(PERM_W3));
    expect(sheet).toContain('{AI_CONSENT_SHEET_COPY.beforeAnswerLead}');
    expect(read('screens/auth/CreateAccountScreen.tsx')).toContain(`'${PERM_W4}'`);
  });
});
