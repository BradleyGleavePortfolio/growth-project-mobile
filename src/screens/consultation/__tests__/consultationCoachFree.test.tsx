/**
 * Owner 62 (Option 1), C-6a, 62y2 (Option 1) and W-CONSENT: P0 for a client with no coach shows the
 * coach-free text (the coached text with every coach sentence or clause removed, no new words), then
 * "Before you join a coach" (C3-S-84), led by C3-S-83, with the coached paragraph 4 and box 2
 * (client-ai-v6, so the grant covers Roman once a coach is linked), and the footer "Nothing is sent
 * until you continue.". P0 records that whole screen (FIX684: consult-consent-v8-coach-free, v9-coach-free
 * with the server's memory paragraph; the table at the end). A grant the server refuses (403
 * ROMAN_REQUIRES_COACH) is quiet: unsaved, no notice. The coach-free box 2 copies stay known so a grant
 * recorded before 62y2 is still read with its own text.
 */
import React from 'react';
import { createHash } from 'crypto';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import ConsultationFlow, { ConsultationApi } from '../ConsultationFlow';
import type { AiConsentOutcome, AiConsentUpgradeCopy } from '../../../api/aiConsentApi';
import { NOW } from '../../../lib/consultation/__fixtures__/consultFixtures';
import { aiStatus, makeApi, resetStores } from '../../../lib/consultation/__fixtures__/flowHarness';
import {
  isLiveRomanGrant,
  pinnedMemoryCopy,
  romanBox2MemoryCopyOf,
  romanFamily,
  romanFamilyOf,
  romanGrantBody,
} from '../../../lib/consultation/aiConsent';
import {
  AI_CONSENT_CHECKBOX_LABEL,
  AI_CONSENT_CHECKBOX_LABEL_COACH_FREE,
  AI_CONSENT_COACH_FREE_COPY_SHA256,
  AI_CONSENT_COACH_FREE_MEMORY_COPY_SHA256,
  AI_CONSENT_COPY_SHA256,
  AI_CONSENT_PARAGRAPH,
  AI_CONSENT_MEMORY_COPY_SHA256,
  AI_CONSENT_PARAGRAPH_COACH_FREE,
  AI_CONSENT_SAFETY_EXCEPTION,
  aiConsentCopyText,
  CONSENT_CHECKBOX_LABEL,
  CONSENT_CHECKBOX_LABEL_COACH_FREE,
  CONSENT_COACH_FREE_COPY_SHA256,
  CONSENT_FOOTER_COACH_FREE,
  CONSENT_PARAGRAPHS,
  CONSENT_TITLE,
  CONSENT_PARAGRAPHS_COACH_FREE,
  consentCopyText,
  consentScreenCopy,
} from '../../../lib/consultation/copy';

jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: {},
  usersApi: { updatePushToken: jest.fn(async () => ({ data: {} })) },
  profileApi: { get: jest.fn(async () => ({ data: {} })) },
}));
jest.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('../../../services/sentry', () => ({ setSentryUser: jest.fn(), captureError: jest.fn() }));
jest.mock('../../../lib/analytics', () => ({ reset: jest.fn() }));
jest.mock('../../../lib/userCache', () => ({
  readUserCacheSync: jest.fn(() => ({ id: 'u1' })),
  readUserCache: jest.fn(async () => null),
  clearUserCache: jest.fn(async () => undefined),
}));
jest.mock('../../../offline/sync/sync-engine', () => ({ deleteWorkoutLogsForUser: jest.fn(async () => 0) }));
jest.mock('../../../services/queryClient', () => ({
  retireAndDrainIdentityPersistences: jest.fn(async () => undefined),
  settleAndClearQueryCache: jest.fn(async () => undefined),
  purgePersistedQueryCacheForAllUsers: jest.fn(async () => undefined),
}));

const sha = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');
const tokens = (t: string): string[] => t.match(/[^\s.,;:]+|[.,;:]/g) ?? [];
/** Every word and mark of `to` appears in `from`, in order; the one join is "collects and uses". */
function removalsOnly(from: string, to: string): boolean {
  const joins: Record<string, string> = { collects: 'collect', uses: 'use' };
  const src = tokens(from);
  let i = 0;
  for (const w of tokens(to)) {
    while (i < src.length && src[i] !== (joins[w] ?? w) && src[i] !== w) i += 1;
    if (i === src.length) return false;
    i += 1;
  }
  return true;
}

// The server's client-ai-v5-coach-free paragraph (backend #945), and the coached v5 paragraph it comes from.
const V5_PARAGRAPH =
  "Roman, the assistant in this app, is powered by Anthropic, a third-party AI provider. If you allow it, your information is sent to Anthropic so Roman can answer your questions and your coach can use AI drafts about your training. Roman may keep notes and summaries about your training, preferences and circumstances to personalise his replies. Deleting a chat removes its messages but not these notes; deleting your account removes them. Roman may also learn your coach's methods, including from your coach's private session notes, and information about your training may help with that without identifying you. Roman never quotes those notes or shows you another client's information. Your coach never sees your conversations with Roman or his notes about you. Your conversations with Roman are kept until you delete them or delete your account.";
const V5_COACH_FREE_PARAGRAPH =
  "Roman, the assistant in this app, is powered by Anthropic, a third-party AI provider. If you allow it, your information is sent to Anthropic so Roman can answer your questions. Roman may keep notes and summaries about your training, preferences and circumstances to personalise his replies. Deleting a chat removes its messages but not these notes; deleting your account removes them. Roman never shows you another client's information. Your conversations with Roman are kept until you delete them or delete your account.";
const V5CF_COPY: AiConsentUpgradeCopy = {
  version: 'client-ai-v5-coach-free',
  paragraph: { text: V5_COACH_FREE_PARAGRAPH, sha256: sha(V5_COACH_FREE_PARAGRAPH) },
  box_label: { text: AI_CONSENT_CHECKBOX_LABEL_COACH_FREE, sha256: sha(AI_CONSENT_CHECKBOX_LABEL_COACH_FREE) },
  sha256: AI_CONSENT_COACH_FREE_MEMORY_COPY_SHA256,
};
const CF_STATUS = aiStatus({ current_version: 'client-ai-v4-coach-free' });

describe('coach-free copy (owner 62)', () => {
  it('only removes words from the coached text, names no coach and never mentions a clinic', () => {
    const pairs: Array<[string, string]> = [
      ...CONSENT_PARAGRAPHS.map((p, i): [string, string] => [p, CONSENT_PARAGRAPHS_COACH_FREE[i]]),
      [CONSENT_CHECKBOX_LABEL, CONSENT_CHECKBOX_LABEL_COACH_FREE],
      [AI_CONSENT_PARAGRAPH, AI_CONSENT_PARAGRAPH_COACH_FREE],
      [V5_PARAGRAPH, V5_COACH_FREE_PARAGRAPH],
      [AI_CONSENT_CHECKBOX_LABEL, AI_CONSENT_CHECKBOX_LABEL_COACH_FREE],
    ];
    for (const [coached, free] of pairs) {
      expect(removalsOnly(coached, free)).toBe(true);
      expect(free.replace(/To coach you|to coach me/g, '')).not.toMatch(/coach/i);
      expect(free).not.toMatch(/clinic/i);
    }
    expect(CONSENT_PARAGRAPHS_COACH_FREE.slice(0, 2)).toEqual(CONSENT_PARAGRAPHS.slice(0, 2));
  });

  it('W-CONSENT: the coached Roman choice under C3-S-84 and C3-S-83; the P0 record names that whole screen', () => {
    const roman = ['Before you join a coach', consentScreenCopy(true).romanLead, AI_CONSENT_PARAGRAPH, AI_CONSENT_CHECKBOX_LABEL];
    expect(consentCopyText(undefined, true)).toBe(
      [CONSENT_TITLE, ...CONSENT_PARAGRAPHS_COACH_FREE, CONSENT_CHECKBOX_LABEL_COACH_FREE, ...roman, 'Nothing is sent until you continue.'].join('\n\n'),
    );
    expect(CONSENT_FOOTER_COACH_FREE).toBe('Nothing is sent until you continue.');
    expect(sha(consentCopyText(undefined, true))).toBe(CONSENT_COACH_FREE_COPY_SHA256);
    expect(consentScreenCopy(true)).toMatchObject({
      romanTitle: 'Before you join a coach',
      romanLead:
        'Roman works with a coach, so he is not available until you join one. If you allow this now, Roman is ready on the day you join and you will not be asked again.',
      aiParagraph: AI_CONSENT_PARAGRAPH,
      box2Label: AI_CONSENT_CHECKBOX_LABEL,
      footer: 'Nothing is sent until you continue.',
    }); // the versions and pins: the FIX684 table
    expect(consentScreenCopy(false)).toMatchObject({ romanTitle: null, romanLead: null });
  });

  it('the coach-free box 2 copies (for a grant recorded before 62y2) still hash to the backend pins', () => {
    expect(sha(aiConsentCopyText(true))).toBe(AI_CONSENT_COACH_FREE_COPY_SHA256);
    expect(sha(`${V5_COACH_FREE_PARAGRAPH}\n\n${AI_CONSENT_CHECKBOX_LABEL_COACH_FREE}`)).toBe(AI_CONSENT_COACH_FREE_MEMORY_COPY_SHA256);
    expect(AI_CONSENT_COACH_FREE_COPY_SHA256).toBe('2a8c7973ba6047b58a0fdccb2604a796403d5b4773a6f6a73c98da3d84e68447');
    expect(AI_CONSENT_COACH_FREE_MEMORY_COPY_SHA256).toBe('c7cd7ebd3b47e3eb0e890a8efa932610c35716aa79ad4f139b6f0c0aad7128fe');
  });

  it('box 2 helpers keep each family to its own versions and pins', () => {
    const cf = romanFamily(true);
    expect(romanFamilyOf(CF_STATUS)).toBe(cf);
    expect(romanFamilyOf(aiStatus())).toBe(romanFamily(false));
    expect(romanGrantBody(null, cf)).toEqual({
      version: 'client-ai-v4-coach-free',
      copy_sha256: AI_CONSENT_COACH_FREE_COPY_SHA256,
      platform: 'ios',
    });
    expect(pinnedMemoryCopy(V5CF_COPY, cf)).toEqual(V5CF_COPY);
    expect(pinnedMemoryCopy(V5CF_COPY)).toBeNull();
    const live = aiStatus({ granted: true, state: 'granted', version: 'client-ai-v4-coach-free', current_version: 'client-ai-v4-coach-free' });
    expect(isLiveRomanGrant(live)).toBe(true);
    expect(isLiveRomanGrant(live, cf)).toBe(true);
    expect(isLiveRomanGrant(live, romanFamily(false))).toBe(false);
    expect(romanBox2MemoryCopyOf({ ...CF_STATUS, memory_on: true, memory_copy: V5CF_COPY }, cf)).toEqual(V5CF_COPY);
  });
});

function renderFlow(api: ConsultationApi, coachless = true) {
  return render(
    <ConsultationFlow
      userId="u1"
      firstName="Maya"
      coachName={coachless ? null : 'Bradley'}
      coachless={coachless}
      api={api}
      onFinished={jest.fn()}
      now={() => NOW}
      autoAdvanceMs={0}
      prepMinMs={0}
    />,
  );
}

async function toP0(api: ConsultationApi, coachless = true) {
  const r = await renderFlow(api, coachless);
  await waitFor(() => r.getByTestId('consult-screen-W1'));
  await fireEvent.press(r.getByTestId('consult-continue'));
  await waitFor(() => r.getByTestId('consult-screen-P0'));
  return r;
}

beforeEach(async () => {
  await resetStores();
});

async function agree(r: Awaited<ReturnType<typeof toP0>>, allow: boolean) {
  await fireEvent.press(r.getByTestId('consent-checkbox'));
  if (allow) await fireEvent.press(r.getByTestId('consent-ai-checkbox'));
  await fireEvent.press(r.getByTestId('consult-continue'));
  await waitFor(() => r.getByTestId('consult-screen-G1'));
}

describe('P0 for a client with no coach (W-CONSENT)', () => {
  it('asks with the coached paragraph and box under "Before you join a coach" (the FIX684 table saves each choice)', async () => {
    const api = makeApi({ getRomanConsent: jest.fn(async () => ({ kind: 'ok' as const, status: aiStatus() })) });
    const r = await toP0(api);
    for (const p of CONSENT_PARAGRAPHS_COACH_FREE) expect(r.getByText(p)).toBeTruthy();
    expect(r.getByText(CONSENT_CHECKBOX_LABEL_COACH_FREE)).toBeTruthy();
    expect(r.getByTestId('consent-roman-title').props.accessibilityRole).toBe('header');
    expect(r.getByText('Before you join a coach')).toBeTruthy();
    expect(r.getByTestId('consent-roman-lead').props.children).toBe(consentScreenCopy(true).romanLead);
    expect(r.getByTestId('consent-ai-paragraph').props.children).toBe(AI_CONSENT_PARAGRAPH);
    expect(r.getByText(AI_CONSENT_CHECKBOX_LABEL)).toBeTruthy();
    expect(r.getByTestId('consent-footer').props.children).toBe('Nothing is sent until you continue.');
    expect(api.getRomanConsent).toHaveBeenCalledWith(); // the coached copies, never ?variant=coach_free
  });

  it('a 403 ROMAN_REQUIRES_COACH is quiet: no notice, onboarding carries on, the choice stays unsaved', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const api = makeApi({
      grantRomanConsent: jest.fn(async (): Promise<AiConsentOutcome> => ({ kind: 'error', status: 403, code: 'ROMAN_REQUIRES_COACH' })),
    });
    const r = await toP0(api);
    await agree(r, true);
    await waitFor(() => expect(api.grantRomanConsent).toHaveBeenCalledTimes(1));
    expect(r.getByTestId('consult-screen-G1')).toBeTruthy();
    await fireEvent.press(r.getByTestId('consult-back'));
    await waitFor(() => r.getByTestId('consult-screen-P0'));
    await waitFor(() => expect(r.getByTestId('consent-ai-checkbox').props.accessibilityState?.checked).toBe(false));
    expect(r.queryByTestId('consent-error')).toBeNull();
    expect(alert).not.toHaveBeenCalled();
    alert.mockRestore();
  });
});

// FIX684 (Sol B1): every P0 screen this build shows, and the record it names: [no coach, memory on, P0 version, digest].
const SCREENS: Array<[boolean, boolean, string, string]> = [
  [false, false, 'consult-consent-v7', '7711079209acecedfb50c31787787124af843f076154e9bfbd1e33550e861e09'],
  [false, true, 'consult-consent-v8', 'b98e160e884aecdca059b90f7a88803ba84eeac79b692e83eba9f734f93274b2'],
  [true, false, 'consult-consent-v8-coach-free', '5369ee9c57412dd2233850a7cae2043a32645431ee3b3484a14c19b8c503c633'],
  [true, true, 'consult-consent-v9-coach-free', '4a1e19730f3fab3b8a6a8119f5425cd3c0f6ed2f502d229d25dbb7fe5df35771'],
];
// The server's client-ai-v7 memory paragraph (v5's with the 57c exception after the promise), its copy sha256 rebuilt from text.
const V7_PARAGRAPH = V5_PARAGRAPH.replace('his notes about you.', `his notes about you. ${AI_CONSENT_SAFETY_EXCEPTION}`);
const part = (text: string) => ({ text, sha256: sha(text) });
const V7_COPY: AiConsentUpgradeCopy = {
  version: 'client-ai-v7',
  paragraph: part(V7_PARAGRAPH),
  box_label: part(AI_CONSENT_CHECKBOX_LABEL),
  sha256: sha(`${V7_PARAGRAPH}\n\n${AI_CONSENT_CHECKBOX_LABEL}`),
};
const strings = (n: unknown): string[] =>
  typeof n === 'string' ? [n] : Array.isArray(n) ? n.flatMap(strings) : n && typeof n === 'object' ? strings((n as { children?: unknown }).children ?? null) : [];

describe('FIX684: each P0 record rebuilds the screen shown (coached / no coach x memory off / on x box 2 off / on)', () => {
  const rows = SCREENS.flatMap((row) => [false, true].map((box2) => [...row, box2] as [boolean, boolean, string, string, boolean]));
  it.each(rows)('no coach %s, memory %s: %s (box 2 %s)', async (noCoach, memory, version, pin, box2) => {
    expect(V7_COPY.sha256).toBe(AI_CONSENT_MEMORY_COPY_SHA256);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const status = memory ? aiStatus({ memory_on: true, memory_copy: V7_COPY }) : aiStatus();
    const api = makeApi({ getRomanConsent: jest.fn(async () => ({ kind: 'ok' as const, status })) });
    const r = await toP0(api, noCoach);
    await waitFor(() => expect(r.getByTestId('consent-ai-paragraph').props.children).toBe(memory ? V7_PARAGRAPH : AI_CONSENT_PARAGRAPH));
    const out = strings(r.toJSON()); // every string from the P0 title to the Privacy Policy link, in display order
    const shown = out.slice(out.lastIndexOf(CONSENT_TITLE, out.indexOf('Privacy Policy')), out.indexOf('Privacy Policy')).join('\n\n');
    await agree(r, box2);
    expect(sha(shown)).toBe(pin);
    expect(api.save.mock.calls[0][0].answers.P0).toMatchObject({ agreed: true, copy_version: version, text_sha256: pin });
    const grant = memory ? { version: 'client-ai-v7', copy_sha256: V7_COPY.sha256 } : { version: 'client-ai-v6', copy_sha256: AI_CONSENT_COPY_SHA256 };
    if (box2) await waitFor(() => expect(api.grantRomanConsent).toHaveBeenCalledWith(expect.objectContaining(grant)));
    else expect(api.grantRomanConsent).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalled(); // no notice, for a client with or without a coach
    alert.mockRestore();
  });

  it('the rows are every record a P0 screen can name', () => {
    const named = [false, true].map((cf) => consentScreenCopy(cf)).flatMap((c, i) => [[!!i, false, c.version, c.sha256], [!!i, true, c.memoryVersion, c.memorySha256]]);
    expect(named).toEqual(SCREENS);
  });
});
