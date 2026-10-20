/**
 * W-BRAND-AGREEMENT (owner op 1, 2026-10-19): the agreement names TGP Fitness in the five approved
 * sentences W34-W38, every P0 screen moved to a new consent version (backend b#1109 accepts them next
 * to the old ones), and an agreement given before stays as it is: nobody is asked again.
 */
import { createHash } from 'crypto';
import {
  AI_CONSENT_PARAGRAPH_CRISIS,
  CONSENT_CHECKBOX_LABEL,
  CONSENT_CHECKBOX_LABEL_COACH_FREE,
  CONSENT_COACH_FREE_COPY_SHA256,
  CONSENT_COACH_FREE_CRISIS_COPY_SHA256,
  CONSENT_COPY_SHA256,
  CONSENT_CRISIS_COPY_SHA256,
  CONSENT_PARAGRAPHS,
  CONSENT_PARAGRAPHS_COACH_FREE,
  consentCopyText,
  consentScreenCopy,
} from '../copy';
import { CONSULT_CONSENT_PRE_BRAND_COPY_VERSIONS } from '../consentVersion';
import { isConsentAnswerCurrent } from '../engine';

const sha = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');
const P1_REST = ' We do not diagnose, treat, or give medical advice. Nothing in this app replaces the advice of a physician or other qualified health provider.';
const P3_REST = ' We use it only to provide your training. We never sell it.';

describe('W-BRAND-AGREEMENT: the agreement says TGP Fitness', () => {
  it('W34-W38 are the approved New text, and the rest of each paragraph is unchanged', () => {
    expect(CONSENT_PARAGRAPHS[0]).toBe(`TGP Fitness provides personal training and nutrition guidance only.${P1_REST}`);
    expect(CONSENT_PARAGRAPHS[2]).toBe(
      'To coach you, TGP Fitness and your coach collect and use what you share here: your profile, this consultation including the screening questions, your targets, food and workout logs, check-ins, any health, sleep or wearable data you choose to connect, your messages with your coach, and posts you write in the community.' +
        P3_REST,
    );
    expect(CONSENT_CHECKBOX_LABEL).toBe('I agree to the training waiver, and to TGP Fitness and my coach collecting and using my information to coach me.');
    expect(CONSENT_PARAGRAPHS_COACH_FREE[0]).toBe(CONSENT_PARAGRAPHS[0]);
    expect(CONSENT_PARAGRAPHS_COACH_FREE[2]).toBe(
      'To coach you, TGP Fitness collects and uses what you share here: your profile, this consultation including the screening questions, your targets, food and workout logs, check-ins, any health, sleep or wearable data you choose to connect, and posts you write in the community.' +
        P3_REST,
    );
    expect(CONSENT_CHECKBOX_LABEL_COACH_FREE).toBe('I agree to the training waiver, and to TGP Fitness collecting and using my information to coach me.');
  });

  it('no P0 screen names the old brand, and each pin is the sha256 of the screen it names', () => {
    const screens: Array<[string, string]> = [
      [consentCopyText(), CONSENT_COPY_SHA256],
      [consentCopyText(undefined, true), CONSENT_COACH_FREE_COPY_SHA256],
      [consentCopyText(AI_CONSENT_PARAGRAPH_CRISIS), CONSENT_CRISIS_COPY_SHA256],
      [consentCopyText(AI_CONSENT_PARAGRAPH_CRISIS, true), CONSENT_COACH_FREE_CRISIS_COPY_SHA256],
    ];
    for (const [text, pin] of screens) {
      expect(text).not.toMatch(/The Growth Project/);
      expect(text).toMatch(/TGP Fitness provides/);
      expect(sha(text)).toBe(pin);
    }
  });

  it('every screen records a new version; an agreement to a screen before stays current', () => {
    const named = [false, true].flatMap((coachFree) =>
      [false, true].flatMap((crisis) => {
        const c = consentScreenCopy(coachFree, crisis);
        return [c.version, c.memoryVersion];
      }),
    );
    expect(named).toEqual([
      'consult-consent-v11',
      'consult-consent-v12',
      'consult-consent-v13',
      'consult-consent-v14',
      'consult-consent-v12-coach-free',
      'consult-consent-v13-coach-free',
      'consult-consent-v14-coach-free',
      'consult-consent-v15-coach-free',
    ]);
    expect(CONSULT_CONSENT_PRE_BRAND_COPY_VERSIONS).toHaveLength(8);
    const record = (copy_version: string) => ({ agreed: true, copy_version, agreed_at: '2026-10-19T14:00:00.000Z', text_sha256: 'a'.repeat(64) });
    for (const v of [...named, ...CONSULT_CONSENT_PRE_BRAND_COPY_VERSIONS]) {
      expect(isConsentAnswerCurrent(record(v) as never)).toBe(true);
    }
    for (const v of CONSULT_CONSENT_PRE_BRAND_COPY_VERSIONS) expect(named).not.toContain(v);
  });
});
