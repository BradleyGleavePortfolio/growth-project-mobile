/**
 * Settings > Privacy > Roman and AI: the optional Roman memory permission (backend R11-C1 client-ai-v5,
 * B-R11C-126). `upgrade` shown only when sent, with the server text and sha256; v4 Allow unchanged.
 */
import React from 'react';
import { Alert, AlertButton, Platform } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { NavigationProp, ParamListBase } from '@react-navigation/native';
import RomanAiConsentScreen, {
  choiceOf,
  isMemoryAllowed,
  memoryGrantBody,
  memoryOfferOf,
  RomanAiConsentApi,
  ROMAN_AI_COPY,
} from '../RomanAiConsentScreen';
import { parseStatus, type AiConsentOutcome, type AiConsentStatusResponse } from '../../../api/aiConsentApi';
import { AI_CONSENT_CHECKBOX_LABEL, AI_CONSENT_COPY_SHA256, AI_CONSENT_PARAGRAPH } from '../../../lib/consultation/copy';
import { resetAiLedgerWritesForTests } from '../../../lib/consultation/aiConsent';

jest.mock('../../../services/api', () => ({ __esModule: true, default: {} }));
jest.mock('../../../utils/haptics', () => ({ lightTap: jest.fn(), warningTap: jest.fn(), selectionTap: jest.fn() }));
jest.mock('../../../utils/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({
    colors: new Proxy({}, { get: () => '#123456' }),
  }),
}));
jest.mock('expo-font', () => ({ isLoaded: () => true, loadAsync: jest.fn() }));
jest.mock('../../../services/sentry', () => ({ captureError: jest.fn(), setSentryUser: jest.fn() }));

// Backend src/ai-consent/ai-consent.constants.ts CLIENT_AI_CONSENT_V5_PARAGRAPH (owner D1), verbatim.
const V5_PARAGRAPH =
  "Roman, the assistant in this app, is powered by Anthropic, a third-party AI provider. If you allow it, your information is sent to Anthropic so Roman can answer your questions and your coach can use AI drafts about your training. Roman may keep notes and summaries about your training, preferences and circumstances to personalise his replies. Deleting a chat removes its messages but not these notes; deleting your account removes them. Roman may also learn your coach's methods, including from your coach's private session notes, and information about your training may help with that without identifying you. Roman never quotes those notes or shows you another client's information. Your coach never sees your conversations with Roman or his notes about you. Your conversations with Roman are kept until you delete them or delete your account.";
const V5_PARAGRAPH_SHA = '768ae3451fd1fbd22c65fd7758b51604a9ee0696c6ae7fab694c8238a6584782';
const V5_COPY_SHA = '8c19fca94c2455094c47b1802bb6693aff47d24c7b6df3b256d0a0e8e90fe8ee';
const LABEL_SHA = 'a'.repeat(64);

/** The backend's v5 copy object, as GET /me/ai-consent sends it. */
const V5_COPY = {
  version: 'client-ai-v5',
  processor: 'anthropic',
  paragraph: { text: V5_PARAGRAPH, sha256: V5_PARAGRAPH_SHA },
  box_label: { text: AI_CONSENT_CHECKBOX_LABEL, sha256: LABEL_SHA },
  sha256: V5_COPY_SHA,
};
const V4_COPY = {
  version: 'client-ai-v4',
  processor: 'anthropic',
  paragraph: { text: AI_CONSENT_PARAGRAPH, sha256: 'b'.repeat(64) },
  box_label: { text: AI_CONSENT_CHECKBOX_LABEL, sha256: LABEL_SHA },
  sha256: AI_CONSENT_COPY_SHA256,
};

/** A GET body exactly as the backend builds it (toStatus), parsed by the app. */
function body(over: Record<string, unknown>): AiConsentStatusResponse {
  const s = parseStatus({
    purpose: 'client_ai_processing',
    processor: 'anthropic',
    granted: false,
    state: 'not_granted',
    version: null,
    granted_at: null,
    withdrawn_at: null,
    current_version: 'client-ai-v4',
    needs_reconsent: false,
    copy: V4_COPY,
    scope: null,
    upgrade: null,
    ...over,
  });
  if (!s) throw new Error('unparseable status');
  return s;
}
const LIVE_V4 = { granted: true, state: 'granted', version: 'client-ai-v4', granted_at: '2026-10-07T10:00:00Z', scope: 'base' };
const V4_NO_OFFER = body(LIVE_V4);
const V4_WITH_OFFER = body({ ...LIVE_V4, upgrade: V5_COPY });
const V5_HOLDER = body({
  granted: true,
  state: 'granted',
  version: 'client-ai-v5',
  granted_at: '2026-10-08T10:00:00Z',
  current_version: 'client-ai-v5',
  copy: V5_COPY,
  scope: 'memory',
});

function makeApi(first: AiConsentStatusResponse, grant: AiConsentOutcome = { kind: 'ok', status: V5_HOLDER }) {
  return {
    getStatus: jest.fn(async (): Promise<AiConsentOutcome> => ({ kind: 'ok', status: first })),
    grantRoman: jest.fn(async (): Promise<AiConsentOutcome> => grant),
    withdrawRoman: jest.fn(async (): Promise<AiConsentOutcome> => ({ kind: 'ok', status: body({ state: 'withdrawn' }) })),
  };
}

const navigation: Pick<NavigationProp<ParamListBase>, 'goBack' | 'navigate'> = { goBack: jest.fn(), navigate: jest.fn() };
const renderScreen = (api: RomanAiConsentApi) =>
  render(
    <RomanAiConsentScreen
      navigation={navigation as NavigationProp<ParamListBase>}
      api={api}
      sessionUserId={() => 'user-a'}
    />,
  );

function lastAlert(): { title: string; message: string; buttons: AlertButton[] } {
  const calls = (Alert.alert as jest.Mock).mock.calls;
  const [title, message, buttons] = calls[calls.length - 1];
  return { title, message, buttons };
}
function confirmLastAlert(label: string) {
  const b = lastAlert().buttons.find((x) => x.text === label);
  if (!b?.onPress) throw new Error(`no ${label} button`);
  b.onPress();
}

beforeEach(() => {
  resetAiLedgerWritesForTests();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(() => {
  (Alert.alert as jest.Mock).mockRestore();
});

describe('parseStatus: scope and upgrade (R11-C1)', () => {
  it('a server without the fields, or with null, reads as null', () => {
    const old = parseStatus({ granted: true, state: 'granted', version: 'client-ai-v4', current_version: 'client-ai-v4', copy: V4_COPY });
    expect(old).toMatchObject({ scope: null, upgrade: null, granted: true });
    expect(V4_NO_OFFER).toMatchObject({ scope: 'base', upgrade: null });
    expect(body({ ...LIVE_V4, scope: 'everything' }).scope).toBeNull();
  });

  it('a well-formed upgrade is kept with its exact text and a lowercase sha256', () => {
    const s = body({ ...LIVE_V4, upgrade: { ...V5_COPY, sha256: V5_COPY_SHA.toUpperCase() } });
    expect(s.upgrade).toEqual({
      version: 'client-ai-v5',
      paragraph: { text: V5_PARAGRAPH, sha256: V5_PARAGRAPH_SHA },
      box_label: { text: AI_CONSENT_CHECKBOX_LABEL, sha256: LABEL_SHA },
      sha256: V5_COPY_SHA,
    });
  });

  it.each([
    ['a string', 'client-ai-v5'],
    ['no box label', { ...V5_COPY, box_label: undefined }],
    ['a blank paragraph', { ...V5_COPY, paragraph: { text: '  ', sha256: V5_PARAGRAPH_SHA } }],
    ['a short sha256', { ...V5_COPY, sha256: 'abc' }],
  ])('a malformed upgrade (%s) reads as null, and the rest of the status still parses', (_l, upgrade) => {
    const s = body({ ...LIVE_V4, upgrade });
    expect(s.upgrade).toBeNull();
    expect(s).toMatchObject({ granted: true, state: 'granted', version: 'client-ai-v4' });
  });
});

describe('the memory offer (B-R11C-126)', () => {
  it('upgrade null: a v4 holder sees exactly the v4 screen and nothing new', async () => {
    const api = makeApi(V4_NO_OFFER);
    const r = await renderScreen(api);
    await waitFor(() => r.getByTestId('roman-ai-allowed'));
    expect(r.queryByTestId('roman-ai-memory-offer')).toBeNull();
    expect(r.queryByText(ROMAN_AI_COPY.memoryAllow)).toBeNull();
    expect(r.getByTestId('roman-ai-paragraph').props.children).toBe(AI_CONSENT_PARAGRAPH);
    expect(memoryOfferOf(V4_NO_OFFER)).toBeNull();
  });

  it('upgrade sent: shows the server text; Allow asks first, then grants client-ai-v5 with the server sha256', async () => {
    const api = makeApi(V4_WITH_OFFER);
    const r = await renderScreen(api);
    await waitFor(() => r.getByTestId('roman-ai-memory-offer'));
    expect(r.getByTestId('roman-ai-memory-paragraph').props.children).toBe(V5_PARAGRAPH);
    expect(r.getByText(ROMAN_AI_COPY.memoryIntro)).toBeTruthy();
    // The first choice stays as it was: still Allowed under the v4 text.
    expect(r.getByTestId('roman-ai-state').props.children).toBe('Allowed');
    expect(r.getByTestId('roman-ai-paragraph').props.children).toBe(AI_CONSENT_PARAGRAPH);

    await fireEvent.press(r.getByTestId('roman-ai-memory-allow'));
    expect(lastAlert().title).toBe(ROMAN_AI_COPY.confirmMemoryTitle);
    expect(lastAlert().message).toBe(AI_CONSENT_CHECKBOX_LABEL.replace(/^Optional: /, ''));
    expect(api.grantRoman).not.toHaveBeenCalled();

    confirmLastAlert('Allow');
    await waitFor(() => expect(api.grantRoman).toHaveBeenCalledTimes(1));
    expect(api.grantRoman).toHaveBeenCalledWith({
      version: 'client-ai-v5',
      copy_sha256: V5_COPY_SHA,
      platform: Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web',
    });
    // The server answers with the v5 status: Allowed, the v5 text, no offer.
    await waitFor(() => expect(r.queryByTestId('roman-ai-memory-offer')).toBeNull());
    expect(r.getByTestId('roman-ai-allowed')).toBeTruthy();
    expect(r.getByTestId('roman-ai-paragraph').props.children).toBe(V5_PARAGRAPH);
    expect(r.getByText(ROMAN_AI_COPY.allowedMemoryBody)).toBeTruthy();
  });

  it('the v4 Allow button still grants client-ai-v4 with this build\u2019s copy hash', async () => {
    const api = makeApi(body({ upgrade: V5_COPY }), { kind: 'ok', status: V4_NO_OFFER });
    const r = await renderScreen(api);
    await waitFor(() => r.getByTestId('roman-ai-not_allowed'));
    // Not a live v4 grant: no memory offer, even if a server sent one.
    expect(r.queryByTestId('roman-ai-memory-offer')).toBeNull();
    await fireEvent.press(r.getByTestId('roman-ai-allow'));
    confirmLastAlert('Allow');
    await waitFor(() => expect(api.grantRoman).toHaveBeenCalledTimes(1));
    expect(api.grantRoman.mock.calls[0]).toEqual([
      expect.objectContaining({ version: 'client-ai-v4', copy_sha256: AI_CONSENT_COPY_SHA256 }),
    ]);
  });

  it('409 CONSENT_VERSION_MISMATCH on the memory grant re-reads and says the wording changed', async () => {
    const api = makeApi(V4_WITH_OFFER, { kind: 'version_mismatch' });
    const r = await renderScreen(api);
    await waitFor(() => r.getByTestId('roman-ai-memory-offer'));
    await fireEvent.press(r.getByTestId('roman-ai-memory-allow'));
    confirmLastAlert('Allow');
    await waitFor(() => expect(r.getByTestId('roman-ai-notice').props.children).toBe(ROMAN_AI_COPY.memoryChanged));
    expect(api.getStatus).toHaveBeenCalledTimes(2);
  });

  it('a live v5 holder reads Allowed with the v5 text and can withdraw', async () => {
    const r = await renderScreen(makeApi(V5_HOLDER));
    await waitFor(() => r.getByTestId('roman-ai-allowed'));
    expect(r.getByTestId('roman-ai-paragraph').props.children).toBe(V5_PARAGRAPH);
    expect(r.getByTestId('roman-ai-withdraw')).toBeTruthy();
    expect(r.queryByTestId('roman-ai-memory-offer')).toBeNull();
    expect(choiceOf(V5_HOLDER)).toEqual({ choice: 'allowed', withdrawable: true });
    expect(isMemoryAllowed(V5_HOLDER)).toBe(true);
  });

  it('only a client-ai-v5 offer on a live v4 grant is shown; a v5 status without its text is not Allowed here', () => {
    expect(memoryOfferOf(V4_WITH_OFFER)?.version).toBe('client-ai-v5');
    expect(memoryOfferOf(body({ ...LIVE_V4, upgrade: { ...V5_COPY, version: 'client-ai-v6' } }))).toBeNull();
    expect(memoryOfferOf(body({ state: 'withdrawn', upgrade: V5_COPY }))).toBeNull();
    expect(memoryOfferOf(V5_HOLDER)).toBeNull();
    const noText = body({ ...LIVE_V4, version: 'client-ai-v5', current_version: 'client-ai-v5', copy: null });
    expect(isMemoryAllowed(noText)).toBe(false);
    expect(choiceOf(noText).choice).toBe('update_app');
    const offer = memoryOfferOf(V4_WITH_OFFER);
    if (!offer) throw new Error('no offer');
    expect(memoryGrantBody(offer)).toMatchObject({ version: 'client-ai-v5', copy_sha256: V5_COPY_SHA });
  });

  it('new copy follows the rules: no first person, no exclamation marks', () => {
    for (const k of ['allowedMemoryBody', 'memoryHead', 'memoryIntro', 'memoryAllow', 'confirmMemoryTitle', 'memoryChanged'] as const) {
      const t = ROMAN_AI_COPY[k];
      expect(t).not.toMatch(/!/);
      expect(t).not.toMatch(/\b(I|we|our|us|me|my)\b/);
      expect(t).not.toMatch(/something went wrong/i);
    }
  });
});
