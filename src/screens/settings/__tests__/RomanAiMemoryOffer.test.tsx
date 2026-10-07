/**
 * Settings > Privacy > Roman and AI: Roman memory on by default (R11-C2B, owner 2026-10-07 10:18).
 * A "Roman's memory" switch at the very bottom: ON for a client-ai-v5 grant; off grants client-ai-v4
 * (Roman stays allowed, the server deletes the notes); on re-grants the server's v5 copy and sha256.
 * Allow grants v5 while the server offers it, otherwise v4 exactly.
 */
import React from 'react';
import { Alert, AlertButton, Platform } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { NavigationProp, ParamListBase } from '@react-navigation/native';
import RomanAiConsentScreen, {
  allowCopyOf,
  choiceOf,
  isMemoryAllowed,
  memorySwitchOf,
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
const V4_WITH_OFFER = body({ ...LIVE_V4, upgrade: V5_COPY, memory_on: true });
/** A b#835 server for a v4 holder while memory is on: the v5 copy as `memory_copy`. */
const V4_MEMORY_COPY = body({ ...LIVE_V4, memory_on: true, memory_copy: V5_COPY });
/** The 10-06 production server: `upgrade` for every v4 holder, no `memory_on`. */
const V4_OLD_SERVER = body({ ...LIVE_V4, upgrade: V5_COPY });
const V5_HOLDER = body({
  granted: true,
  state: 'granted',
  version: 'client-ai-v5',
  granted_at: '2026-10-08T10:00:00Z',
  current_version: 'client-ai-v5',
  copy: V5_COPY,
  scope: 'memory',
  memory_on: true,
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
    expect(old).toMatchObject({ scope: null, upgrade: null, memory_on: false, granted: true });
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
    ['no box label', { ...V5_COPY, box_label: undefined }],
    ['a blank paragraph', { ...V5_COPY, paragraph: { text: '  ', sha256: V5_PARAGRAPH_SHA } }],
    ['a short sha256', { ...V5_COPY, sha256: 'abc' }],
  ])('a malformed upgrade (%s) reads as null, and the rest of the status still parses', (_l, upgrade) => {
    const s = body({ ...LIVE_V4, upgrade });
    expect(s.upgrade).toBeNull();
    expect(s).toMatchObject({ granted: true, state: 'granted', version: 'client-ai-v4' });
  });
});

const platform = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';
const memorySwitch = (r: Awaited<ReturnType<typeof renderScreen>>) => r.getByTestId('roman-ai-memory-switch');

describe("the Roman's memory switch (R11-C2B)", () => {
  it('a v5 holder: the row is at the very bottom, after Delete account, with the switch ON', async () => {
    const r = await renderScreen(makeApi(V5_HOLDER));
    await waitFor(() => r.getByTestId('roman-ai-memory-row'));
    expect(memorySwitch(r).props.value).toBe(true);
    expect(r.getByText(ROMAN_AI_COPY.memoryLabel)).toBeTruthy();
    expect(r.getByText(ROMAN_AI_COPY.memoryHelper)).toBeTruthy();
    expect(r.getAllByTestId(/roman-ai-(delete-account|memory-row)/).map((node) => node.props.testID)).toEqual([
      'roman-ai-delete-account',
      'roman-ai-memory-row',
    ]);
    expect(r.getByTestId('roman-ai-paragraph').props.children).toBe(V5_PARAGRAPH);
    expect(r.getByTestId('roman-ai-withdraw')).toBeTruthy();
    expect(choiceOf(V5_HOLDER)).toEqual({ choice: 'allowed', withdrawable: true });
  });

  it('switch off asks first, then grants client-ai-v4 (Roman stays allowed) and says the notes are deleted', async () => {
    const api = makeApi(V5_HOLDER, { kind: 'ok', status: V4_MEMORY_COPY });
    const r = await renderScreen(api);
    await waitFor(() => r.getByTestId('roman-ai-memory-row'));
    await fireEvent(memorySwitch(r), 'valueChange', false);
    expect(lastAlert().title).toBe(ROMAN_AI_COPY.confirmMemoryOffTitle);
    expect(lastAlert().message).toBe(ROMAN_AI_COPY.confirmMemoryOffBody);
    // Cancel (or dismissing the alert) sends nothing.
    expect(lastAlert().buttons.map((b) => b.text)).toEqual([ROMAN_AI_COPY.cancel, ROMAN_AI_COPY.memoryOff]);
    expect(lastAlert().buttons[0].onPress).toBeUndefined();
    expect(api.grantRoman).not.toHaveBeenCalled();
    expect(api.withdrawRoman).not.toHaveBeenCalled();

    await fireEvent(memorySwitch(r), 'valueChange', false);
    confirmLastAlert(ROMAN_AI_COPY.memoryOff);
    await waitFor(() => expect(api.grantRoman).toHaveBeenCalledTimes(1));
    expect(api.grantRoman).toHaveBeenCalledWith({ version: 'client-ai-v4', copy_sha256: AI_CONSENT_COPY_SHA256, platform });
    expect(api.withdrawRoman).not.toHaveBeenCalled();
    await waitFor(() => expect(r.getByTestId('roman-ai-notice').props.children).toBe(ROMAN_AI_COPY.memoryOffDone));
    expect(memorySwitch(r).props.value).toBe(false);
    expect(r.getByTestId('roman-ai-state').props.children).toBe('Allowed');
    expect(r.getByTestId('roman-ai-paragraph').props.children).toBe(AI_CONSENT_PARAGRAPH);
  });

  it.each([
    ['memory_copy (b#835)', V4_MEMORY_COPY],
    ['upgrade (R11-C1 server)', V4_WITH_OFFER],
  ])('switch on from %s asks with the v5 text, then re-grants client-ai-v5 with the server sha256', async (_l, first) => {
    const api = makeApi(first);
    const r = await renderScreen(api);
    await waitFor(() => r.getByTestId('roman-ai-memory-row'));
    expect(memorySwitch(r).props.value).toBe(false);
    // The first choice stays as it was: still Allowed under the v4 text.
    expect(r.getByTestId('roman-ai-state').props.children).toBe('Allowed');
    expect(r.getByTestId('roman-ai-paragraph').props.children).toBe(AI_CONSENT_PARAGRAPH);
    await fireEvent(memorySwitch(r), 'valueChange', true);
    expect(lastAlert().title).toBe(ROMAN_AI_COPY.confirmMemoryOnTitle);
    expect(lastAlert().message).toBe(V5_PARAGRAPH);
    expect(api.grantRoman).not.toHaveBeenCalled();
    confirmLastAlert(ROMAN_AI_COPY.memoryOn);
    await waitFor(() => expect(api.grantRoman).toHaveBeenCalledTimes(1));
    expect(api.grantRoman).toHaveBeenCalledWith({ version: 'client-ai-v5', copy_sha256: V5_COPY_SHA, platform });
    await waitFor(() => expect(memorySwitch(r).props.value).toBe(true));
    expect(r.getByTestId('roman-ai-paragraph').props.children).toBe(V5_PARAGRAPH);
    expect(r.getByText(ROMAN_AI_COPY.allowedMemoryBody)).toBeTruthy();
  });

  it('409 CONSENT_VERSION_MISMATCH on switch on re-reads and says the wording changed', async () => {
    const api = makeApi(V4_MEMORY_COPY, { kind: 'version_mismatch' });
    const r = await renderScreen(api);
    await waitFor(() => r.getByTestId('roman-ai-memory-row'));
    await fireEvent(memorySwitch(r), 'valueChange', true);
    confirmLastAlert(ROMAN_AI_COPY.memoryOn);
    await waitFor(() => expect(r.getByTestId('roman-ai-notice').props.children).toBe(ROMAN_AI_COPY.memoryChanged));
    expect(api.getStatus).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['memory off on the server', body({ ...LIVE_V4, memory_copy: V5_COPY })],
    ['the 10-06 server (upgrade for everyone, no memory_on)', V4_OLD_SERVER],
    ['no v5 copy sent', V4_NO_OFFER],
    ['a v5 copy with another sha256', body({ ...LIVE_V4, memory_on: true, memory_copy: { ...V5_COPY, sha256: 'c'.repeat(64) } })],
    ['a v5 copy of another version', body({ ...LIVE_V4, memory_on: true, memory_copy: { ...V5_COPY, version: 'client-ai-v6' } })],
    ['no live grant', body({ state: 'withdrawn', memory_on: true, memory_copy: V5_COPY })],
  ])('%s: no switch, the v4 screen exactly', async (_l, status) => {
    const r = await renderScreen(makeApi(status));
    await waitFor(() => r.getByTestId(/^roman-ai-(allowed|not_allowed)$/));
    expect(r.queryByTestId('roman-ai-memory-row')).toBeNull();
    expect(memorySwitchOf(status)).toBeNull();
  });

  it('a v5 status without its text is not Allowed here and has no switch', () => {
    const noText = body({ ...LIVE_V4, version: 'client-ai-v5', current_version: 'client-ai-v5', copy: null });
    expect(isMemoryAllowed(noText)).toBe(false);
    expect(choiceOf(noText).choice).toBe('update_app');
    expect(memorySwitchOf(noText)).toBeNull();
    expect(memorySwitchOf(V5_HOLDER)).toEqual({ on: true, onCopy: null });
    expect(memorySwitchOf(V4_MEMORY_COPY)?.onCopy?.sha256).toBe(V5_COPY_SHA);
  });
});

describe('Allow grants client-ai-v5 while the server offers it (same Roman consent, memory on by default)', () => {
  it('not allowed + memory on: the v5 text, and Allow grants client-ai-v5 with the server sha256', async () => {
    const api = makeApi(body({ memory_on: true, memory_copy: V5_COPY }));
    const r = await renderScreen(api);
    await waitFor(() => r.getByTestId('roman-ai-not_allowed'));
    expect(r.getByTestId('roman-ai-paragraph').props.children).toBe(V5_PARAGRAPH);
    expect(r.queryByTestId('roman-ai-memory-row')).toBeNull();
    await fireEvent.press(r.getByTestId('roman-ai-allow'));
    expect(lastAlert().message).toBe(AI_CONSENT_CHECKBOX_LABEL.replace(/^Optional: /, ''));
    confirmLastAlert('Allow');
    await waitFor(() => expect(api.grantRoman).toHaveBeenCalledTimes(1));
    expect(api.grantRoman).toHaveBeenCalledWith({ version: 'client-ai-v5', copy_sha256: V5_COPY_SHA, platform });
  });

  it('otherwise Allow still grants client-ai-v4 with this build\u2019s copy hash (the current production server)', async () => {
    const api = makeApi(body({ upgrade: V5_COPY, memory_on: true }), { kind: 'ok', status: V4_NO_OFFER });
    const r = await renderScreen(api);
    await waitFor(() => r.getByTestId('roman-ai-not_allowed'));
    expect(r.getByTestId('roman-ai-paragraph').props.children).toBe(AI_CONSENT_PARAGRAPH);
    expect(allowCopyOf(body({ upgrade: V5_COPY, memory_on: true }))).toBeNull();
    await fireEvent.press(r.getByTestId('roman-ai-allow'));
    confirmLastAlert('Allow');
    await waitFor(() => expect(api.grantRoman).toHaveBeenCalledTimes(1));
    expect(api.grantRoman.mock.calls[0]).toEqual([
      expect.objectContaining({ version: 'client-ai-v4', copy_sha256: AI_CONSENT_COPY_SHA256 }),
    ]);
  });
});

describe('copy', () => {
  it('the owner wording, no first person, no exclamation marks', () => {
    expect(ROMAN_AI_COPY.memoryLabel).toBe('Roman\u2019s memory');
    expect(ROMAN_AI_COPY.memoryHelper).toBe(
      'Roman keeps notes from chats and logs to give answers that fit. Turn off to stop and delete them.',
    );
    const keys = [
      'allowedMemoryBody',
      'memoryLabel',
      'memoryHelper',
      'confirmMemoryOnTitle',
      'memoryOn',
      'confirmMemoryOffTitle',
      'confirmMemoryOffBody',
      'memoryOff',
      'memoryOffDone',
      'memoryChanged',
    ] as const;
    for (const k of keys) expect(ROMAN_AI_COPY[k]).not.toMatch(/!|\b(I|we|our|us|me|my)\b|something went wrong/i);
  });
});
