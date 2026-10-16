/**
 * Owner 62 (Option 1) and C-6a: P0 and box 2 for a client with no coach show the coach-free text (the
 * coached text with every coach sentence or clause removed, no new words), record its own version and
 * sha256 (backend consult-consent-v5-coach-free / v6-coach-free, client-ai-v4-coach-free /
 * v5-coach-free), and read the coach-free copies with GET /me/ai-consent?variant=coach_free.
 */
import React from 'react';
import { createHash } from 'crypto';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import ConsultationFlow, { ConsultationApi } from '../ConsultationFlow';
import type { AiConsentUpgradeCopy } from '../../../api/aiConsentApi';
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
  AI_CONSENT_PARAGRAPH,
  AI_CONSENT_PARAGRAPH_COACH_FREE,
  aiConsentCopyText,
  CONSENT_CHECKBOX_LABEL,
  CONSENT_CHECKBOX_LABEL_COACH_FREE,
  CONSENT_COACH_FREE_COPY_SHA256,
  CONSENT_COACH_FREE_MEMORY_COPY_SHA256,
  CONSENT_PARAGRAPHS,
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

  it('hashes to the backend pins', () => {
    expect(sha(consentCopyText(undefined, true))).toBe(CONSENT_COACH_FREE_COPY_SHA256);
    expect(sha(aiConsentCopyText(true))).toBe(AI_CONSENT_COACH_FREE_COPY_SHA256);
    expect(sha(`${V5_COACH_FREE_PARAGRAPH}\n\n${AI_CONSENT_CHECKBOX_LABEL_COACH_FREE}`)).toBe(AI_CONSENT_COACH_FREE_MEMORY_COPY_SHA256);
    expect(sha(consentCopyText(V5_COACH_FREE_PARAGRAPH, true))).toBe(CONSENT_COACH_FREE_MEMORY_COPY_SHA256);
    expect(CONSENT_COACH_FREE_COPY_SHA256).toBe('c56fc409ca188fdcd8a7f52209d72299e3bf19ea68bff0e01b35b1f3295826b5');
    expect(CONSENT_COACH_FREE_MEMORY_COPY_SHA256).toBe('a1769134cf30a3208ef56a8906603d942fb2ca058db9c33c69f4ff14f223ee00');
    expect(AI_CONSENT_COACH_FREE_COPY_SHA256).toBe('2a8c7973ba6047b58a0fdccb2604a796403d5b4773a6f6a73c98da3d84e68447');
    expect(AI_CONSENT_COACH_FREE_MEMORY_COPY_SHA256).toBe('c7cd7ebd3b47e3eb0e890a8efa932610c35716aa79ad4f139b6f0c0aad7128fe');
    expect(consentScreenCopy(true)).toMatchObject({
      version: 'consult-consent-v5-coach-free',
      memoryVersion: 'consult-consent-v6-coach-free',
    });
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

function renderFlow(api: ConsultationApi) {
  return render(
    <ConsultationFlow
      userId="u1"
      firstName="Maya"
      coachless
      api={api}
      onFinished={jest.fn()}
      now={() => NOW}
      autoAdvanceMs={0}
      prepMinMs={0}
    />,
  );
}

async function toP0(api: ConsultationApi) {
  const r = await renderFlow(api);
  await waitFor(() => r.getByTestId('consult-screen-W1'));
  await fireEvent.press(r.getByTestId('consult-continue'));
  await waitFor(() => r.getByTestId('consult-screen-P0'));
  await waitFor(() => expect(api.getRomanConsent).toHaveBeenCalledWith({ coachFree: true }));
  await waitFor(() => expect(r.getByTestId('consent-ai-checkbox').props.accessibilityState?.disabled).toBeFalsy());
  return r;
}

async function tickBothAndContinue(r: Awaited<ReturnType<typeof renderFlow>>) {
  await fireEvent.press(r.getByTestId('consent-checkbox'));
  await fireEvent.press(r.getByTestId('consent-ai-checkbox'));
  await fireEvent.press(r.getByTestId('consult-continue'));
  await waitFor(() => r.getByTestId('consult-screen-G1'));
}

beforeEach(async () => {
  await resetStores();
});

describe('P0 for a client with no coach', () => {
  it('shows the coach-free text and records consult-consent-v5-coach-free and client-ai-v4-coach-free', async () => {
    const api = makeApi({ getRomanConsent: jest.fn(async () => ({ kind: 'ok' as const, status: CF_STATUS })) });
    const r = await toP0(api);
    for (const p of CONSENT_PARAGRAPHS_COACH_FREE) expect(r.getByText(p)).toBeTruthy();
    expect(r.getByText(CONSENT_CHECKBOX_LABEL_COACH_FREE)).toBeTruthy();
    expect(r.getByTestId('consent-ai-paragraph').props.children).toBe(AI_CONSENT_PARAGRAPH_COACH_FREE);
    expect(r.getByText(AI_CONSENT_CHECKBOX_LABEL_COACH_FREE)).toBeTruthy();
    expect(r.queryByText(/your coach|my coach|clinic/i)).toBeNull();
    await tickBothAndContinue(r);
    await waitFor(() => expect(api.grantRomanConsent).toHaveBeenCalledTimes(1));
    expect(api.grantRomanConsent).toHaveBeenCalledWith({
      version: 'client-ai-v4-coach-free',
      copy_sha256: AI_CONSENT_COACH_FREE_COPY_SHA256,
      platform: 'ios',
    });
    expect(api.save.mock.calls[0][0].answers.P0).toMatchObject({
      agreed: true,
      copy_version: 'consult-consent-v5-coach-free',
      text_sha256: CONSENT_COACH_FREE_COPY_SHA256,
    });
  });

  it('with Roman memory on: the server coach-free memory text, granted as client-ai-v5-coach-free, P0 v6-coach-free', async () => {
    const status = { ...CF_STATUS, memory_on: true, memory_copy: V5CF_COPY };
    const api = makeApi({ getRomanConsent: jest.fn(async () => ({ kind: 'ok' as const, status })) });
    const r = await toP0(api);
    await waitFor(() => expect(r.getByTestId('consent-ai-paragraph').props.children).toBe(V5_COACH_FREE_PARAGRAPH));
    await tickBothAndContinue(r);
    await waitFor(() => expect(api.grantRomanConsent).toHaveBeenCalledTimes(1));
    expect(api.grantRomanConsent).toHaveBeenCalledWith({
      version: 'client-ai-v5-coach-free',
      copy_sha256: AI_CONSENT_COACH_FREE_MEMORY_COPY_SHA256,
      platform: 'ios',
    });
    expect(api.save.mock.calls[0][0].answers.P0).toMatchObject({
      copy_version: 'consult-consent-v6-coach-free',
      text_sha256: CONSENT_COACH_FREE_MEMORY_COPY_SHA256,
    });
  });
});
