/**
 * R11-C2B (owner 2026-10-07 10:18, "MEMORY IS ON BY DEFAULT UNLESS THEY SWITCH IT OFF"): box 2 of P0,
 * the one Roman tick every client already gives, grants client-ai-v5 while the server says Roman memory
 * is on and sends its well-formed v5 copy as `memory_copy`. Same box, same label, still unticked by
 * default. Otherwise (the current production server sends no `memory_copy`) box 2 is today's pinned v4
 * text and grant exactly.
 */
import React from 'react';
import { createHash } from 'crypto';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import ConsultationFlow, { ConsultationApi } from '../ConsultationFlow';
import type { AiConsentStatusResponse, AiConsentUpgradeCopy } from '../../../api/aiConsentApi';
import { parseStatus } from '../../../api/aiConsentApi';
import { NOW } from '../../../lib/consultation/__fixtures__/consultFixtures';
import { AI_ALLOWED, aiStatus, makeApi, resetStores } from '../../../lib/consultation/__fixtures__/flowHarness';
import { isLiveRomanGrant, romanBox2MemoryCopyOf, romanGrantBody } from '../../../lib/consultation/aiConsent';
import { isConsentAnswerCurrent } from '../../../lib/consultation/engine';
import {
  AI_CONSENT_CHECKBOX_LABEL,
  AI_CONSENT_COPY_SHA256,
  AI_CONSENT_MEMORY_COPY_SHA256,
  AI_CONSENT_PARAGRAPH,
  CONSENT_COPY_SHA256,
  CONSENT_MEMORY_COPY_SHA256,
  consentCopyText,
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

// Owner-approved client-ai-v5 paragraph (D1, 2026-10-06 12:01), as the server sends it. Verbatim.
const V5_PARAGRAPH =
  "Roman, the assistant in this app, is powered by Anthropic, a third-party AI provider. If you allow it, your information is sent to Anthropic so Roman can answer your questions and your coach can use AI drafts about your training. Roman may keep notes and summaries about your training, preferences and circumstances to personalise his replies. Deleting a chat removes its messages but not these notes; deleting your account removes them. Roman may also learn your coach's methods, including from your coach's private session notes, and information about your training may help with that without identifying you. Roman never quotes those notes or shows you another client's information. Your coach never sees your conversations with Roman or his notes about you. Your conversations with Roman are kept until you delete them or delete your account.";
const sha = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');

const V5_COPY: AiConsentUpgradeCopy = {
  version: 'client-ai-v5',
  paragraph: { text: V5_PARAGRAPH, sha256: sha(V5_PARAGRAPH) },
  box_label: { text: AI_CONSENT_CHECKBOX_LABEL, sha256: sha(AI_CONSENT_CHECKBOX_LABEL) },
  sha256: AI_CONSENT_MEMORY_COPY_SHA256,
};
const memoryOn = (over: Partial<AiConsentStatusResponse> = {}) =>
  aiStatus({ memory_on: true, memory_copy: V5_COPY, ...over });
const V5_HOLDER = aiStatus({
  granted: true,
  state: 'granted',
  version: 'client-ai-v5',
  current_version: 'client-ai-v5',
  copy: { ...V5_COPY, processor: 'anthropic' },
  scope: 'memory',
  memory_on: true,
  memory_copy: null,
});

function renderFlow(api: ConsultationApi) {
  return render(
    <ConsultationFlow
      userId="u1"
      firstName="Maya"
      coachName="Bradley"
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
  await waitFor(() => expect(api.getRomanConsent).toHaveBeenCalled());
  return r;
}

const paragraph = (r: Awaited<ReturnType<typeof renderFlow>>) => r.getByTestId('consent-ai-paragraph').props.children;
const aiBox = (r: Awaited<ReturnType<typeof renderFlow>>) =>
  r.getByTestId('consent-ai-checkbox').props.accessibilityState?.checked;

async function tickBothAndContinue(r: Awaited<ReturnType<typeof renderFlow>>) {
  await fireEvent.press(r.getByTestId('consent-checkbox'));
  await fireEvent.press(r.getByTestId('consent-ai-checkbox'));
  await fireEvent.press(r.getByTestId('consult-continue'));
  await waitFor(() => r.getByTestId('consult-screen-G1'));
}

beforeEach(async () => {
  await resetStores();
});

describe('pins', () => {
  it('the v5 copy and the P0 screen with the v5 paragraph hash to the pinned backend digests', () => {
    expect(sha(`${V5_PARAGRAPH}\n\n${AI_CONSENT_CHECKBOX_LABEL}`)).toBe(AI_CONSENT_MEMORY_COPY_SHA256);
    expect(sha(consentCopyText(V5_PARAGRAPH))).toBe(CONSENT_MEMORY_COPY_SHA256);
    expect(sha(consentCopyText())).toBe(CONSENT_COPY_SHA256);
  });
});

describe('box 2 shows and grants client-ai-v5 while the server says Roman memory is on', () => {
  it('the v5 paragraph, unticked; one tick grants v5 with the server sha256 and P0 names consult-consent-v4', async () => {
    const api = makeApi({ getRomanConsent: jest.fn(async () => ({ kind: 'ok' as const, status: memoryOn() })) });
    const r = await toP0(api);
    await waitFor(() => expect(paragraph(r)).toBe(V5_PARAGRAPH));
    expect(aiBox(r)).toBe(false);
    expect(r.getByText(AI_CONSENT_CHECKBOX_LABEL)).toBeTruthy();
    await tickBothAndContinue(r);
    await waitFor(() => expect(api.grantRomanConsent).toHaveBeenCalledTimes(1));
    expect(api.grantRomanConsent).toHaveBeenCalledWith({
      version: 'client-ai-v5',
      copy_sha256: AI_CONSENT_MEMORY_COPY_SHA256,
      platform: 'ios',
    });
    const first = api.save.mock.calls[0][0];
    expect(first.answers.P0).toMatchObject({
      agreed: true,
      copy_version: 'consult-consent-v4',
      text_sha256: CONSENT_MEMORY_COPY_SHA256,
    });
    expect(isConsentAnswerCurrent(first.answers.P0)).toBe(true);
  });

  it('untouched box 2 sends nothing (no memory without the tick)', async () => {
    const api = makeApi({ getRomanConsent: jest.fn(async () => ({ kind: 'ok' as const, status: memoryOn() })) });
    const r = await toP0(api);
    await waitFor(() => expect(paragraph(r)).toBe(V5_PARAGRAPH));
    await fireEvent.press(r.getByTestId('consent-checkbox'));
    await fireEvent.press(r.getByTestId('consult-continue'));
    await waitFor(() => r.getByTestId('consult-screen-G1'));
    expect(api.grantRomanConsent).not.toHaveBeenCalled();
  });
});

describe("otherwise today's pinned v4 exactly", () => {
  it.each([
    ['the current production server (no memory_copy, no memory_on)', aiStatus()],
    ['memory off', aiStatus({ memory_on: false, memory_copy: V5_COPY })],
    ['memory_copy missing', aiStatus({ memory_on: true })],
    ['memory_copy with another sha256', memoryOn({ memory_copy: { ...V5_COPY, sha256: AI_CONSENT_COPY_SHA256 } })],
    ['memory_copy of another version', memoryOn({ memory_copy: { ...V5_COPY, version: 'client-ai-v6' } })],
    ['memory_copy with another box label', memoryOn({ memory_copy: { ...V5_COPY, box_label: { text: 'Allow', sha256: sha('Allow') } } })],
  ])('%s: v4 paragraph, v4 grant, P0 consult-consent-v3', async (_l, status) => {
    const api = makeApi({ getRomanConsent: jest.fn(async () => ({ kind: 'ok' as const, status })) });
    const r = await toP0(api);
    await waitFor(() => expect(r.getByTestId('consent-ai-checkbox').props.accessibilityState?.disabled).toBeFalsy());
    expect(paragraph(r)).toBe(AI_CONSENT_PARAGRAPH);
    await tickBothAndContinue(r);
    await waitFor(() => expect(api.grantRomanConsent).toHaveBeenCalledTimes(1));
    expect(api.grantRomanConsent).toHaveBeenCalledWith({ version: 'client-ai-v4', copy_sha256: AI_CONSENT_COPY_SHA256, platform: 'ios' });
    expect(api.save.mock.calls[0][0].answers.P0).toMatchObject({ copy_version: 'consult-consent-v3', text_sha256: CONSENT_COPY_SHA256 });
  });

  it('a malformed memory_copy body parses to null', () => {
    const s = parseStatus({ ...memoryOn(), memory_copy: { version: 'client-ai-v5', sha256: AI_CONSENT_MEMORY_COPY_SHA256 } });
    expect(s?.memory_copy).toBeNull();
    expect(romanBox2MemoryCopyOf(s)).toBeNull();
    expect(parseStatus({ ...memoryOn() })?.memory_copy).toEqual(V5_COPY);
  });
});

describe('existing holders', () => {
  it('a live v4 holder sees the v4 text they allowed, ticked; nothing is re-sent', async () => {
    const api = makeApi({ getRomanConsent: jest.fn(async () => ({ kind: 'ok' as const, status: { ...AI_ALLOWED, memory_on: true, memory_copy: V5_COPY } })) });
    const r = await toP0(api);
    await waitFor(() => expect(aiBox(r)).toBe(true));
    expect(paragraph(r)).toBe(AI_CONSENT_PARAGRAPH);
    await fireEvent.press(r.getByTestId('consent-checkbox'));
    await fireEvent.press(r.getByTestId('consult-continue'));
    await waitFor(() => r.getByTestId('consult-screen-G1'));
    expect(api.grantRomanConsent).not.toHaveBeenCalled();
  });

  it('a live v5 holder sees the v5 text, ticked (a live grant, not "not allowed")', async () => {
    const api = makeApi({ getRomanConsent: jest.fn(async () => ({ kind: 'ok' as const, status: V5_HOLDER })) });
    const r = await toP0(api);
    await waitFor(() => expect(aiBox(r)).toBe(true));
    expect(paragraph(r)).toBe(V5_PARAGRAPH);
    expect(isLiveRomanGrant(V5_HOLDER)).toBe(true);
    expect(romanGrantBody(romanBox2MemoryCopyOf(V5_HOLDER))).toMatchObject({ version: 'client-ai-v5', copy_sha256: AI_CONSENT_MEMORY_COPY_SHA256 });
  });
});
