/**
 * Owner 62: Settings > Privacy > Roman and AI for a client with no coach reads the coach-free copies
 * (GET /me/ai-consent?variant=coach_free), shows the coach-free paragraph and box 2 wording, and grants
 * client-ai-v4-coach-free / v5-coach-free with their pinned sha256.
 */
import React from 'react';
import { Alert, AlertButton } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import RomanAiConsentScreen, { choiceOf, memorySwitchOf, ROMAN_AI_COPY } from '../RomanAiConsentScreen';
import type { AiConsentOutcome, AiConsentStatusResponse } from '../../../api/aiConsentApi';
import {
  AI_CONSENT_CHECKBOX_LABEL_COACH_FREE,
  AI_CONSENT_COACH_FREE_COPY_SHA256,
  AI_CONSENT_COACH_FREE_MEMORY_COPY_SHA256,
  AI_CONSENT_PARAGRAPH_COACH_FREE,
} from '../../../lib/consultation/copy';
import { resetAiLedgerWritesForTests } from '../../../lib/consultation/aiConsent';

jest.mock('../../../services/api', () => ({ __esModule: true, default: {} }));
jest.mock('../../../utils/haptics', () => ({ lightTap: jest.fn(), warningTap: jest.fn(), selectionTap: jest.fn() }));
jest.mock('../../../utils/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({
    colors: new Proxy({}, { get: () => '#123456' }),
    semanticColors: new Proxy({}, { get: () => '#123456' }),
  }),
}));
jest.mock('expo-font', () => ({ isLoaded: () => true, loadAsync: jest.fn() }));
jest.mock('../../../services/sentry', () => ({ captureError: jest.fn(), setSentryUser: jest.fn() }));
// A signed-in client with no coach.
jest.mock('../../../lib/userCache', () => ({
  readUserCacheSync: jest.fn(() => ({ id: 'user-a', coach_id: null })),
  readUserCache: jest.fn(async () => null),
}));

const CF = 'client-ai-v4-coach-free';
const CF5 = 'client-ai-v5-coach-free';
const part = (text: string) => ({ text, sha256: 'a'.repeat(64) });
const CF5_COPY = {
  version: CF5,
  paragraph: part('Roman, the assistant in this app, is powered by Anthropic.'),
  box_label: part(AI_CONSENT_CHECKBOX_LABEL_COACH_FREE),
  sha256: AI_CONSENT_COACH_FREE_MEMORY_COPY_SHA256,
};
function status(over: Partial<AiConsentStatusResponse> = {}): AiConsentStatusResponse {
  return {
    granted: false,
    state: 'not_granted',
    version: null,
    granted_at: null,
    withdrawn_at: null,
    current_version: CF,
    needs_reconsent: false,
    copy: { version: CF, paragraph: part(AI_CONSENT_PARAGRAPH_COACH_FREE), box_label: part(AI_CONSENT_CHECKBOX_LABEL_COACH_FREE), sha256: AI_CONSENT_COACH_FREE_COPY_SHA256 },
    ...over,
  };
}
const LIVE_CF = status({ granted: true, state: 'granted', version: CF, granted_at: '2026-10-12T10:00:00Z' });

function makeApi(first: AiConsentStatusResponse) {
  return {
    getStatus: jest.fn(async (): Promise<AiConsentOutcome> => ({ kind: 'ok', status: first })),
    grantRoman: jest.fn(async (): Promise<AiConsentOutcome> => ({ kind: 'ok', status: LIVE_CF })),
    withdrawRoman: jest.fn(async (): Promise<AiConsentOutcome> => ({ kind: 'ok', status: status() })),
  };
}
const navigation = { goBack: jest.fn(), navigate: jest.fn() };
const renderScreen = (api: ReturnType<typeof makeApi>) =>
  render(<RomanAiConsentScreen navigation={navigation as never} api={api} sessionUserId={() => 'user-a'} />);
function confirmLastAlert(label: string) {
  const calls = (Alert.alert as jest.Mock).mock.calls;
  const b = (calls[calls.length - 1][2] as AlertButton[]).find((x) => x.text === label);
  b?.onPress?.();
}

beforeEach(() => {
  resetAiLedgerWritesForTests();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(() => (Alert.alert as jest.Mock).mockRestore());

describe('Roman and AI, client with no coach (owner 62)', () => {
  it('asks for the coach-free copies, shows them, and Allow grants client-ai-v4-coach-free', async () => {
    const api = makeApi(status());
    const r = await renderScreen(api);
    await waitFor(() => r.getByTestId('roman-ai-not_allowed'));
    expect(api.getStatus).toHaveBeenCalledWith({ coachFree: true });
    expect(r.getByTestId('roman-ai-paragraph').props.children).toBe(AI_CONSENT_PARAGRAPH_COACH_FREE);
    await fireEvent.press(r.getByTestId('roman-ai-allow'));
    const calls = (Alert.alert as jest.Mock).mock.calls;
    expect(calls[calls.length - 1][1]).toBe('I allow Roman to use my information, processed by Anthropic.');
    confirmLastAlert(ROMAN_AI_COPY.allow);
    await waitFor(() => expect(api.grantRoman).toHaveBeenCalledTimes(1));
    expect(api.grantRoman).toHaveBeenCalledWith(expect.objectContaining({ version: CF, copy_sha256: AI_CONSENT_COACH_FREE_COPY_SHA256 }));
    await waitFor(() => r.getByTestId('roman-ai-allowed'));
  });

  it('a live coach-free grant reads as allowed; the memory switch offers and grants client-ai-v5-coach-free', async () => {
    const live = { ...LIVE_CF, memory_on: true, memory_copy: CF5_COPY };
    expect(choiceOf(live).choice).toBe('allowed');
    expect(memorySwitchOf(live)).toEqual({ on: false, onCopy: CF5_COPY });
    const api = makeApi(live);
    const r = await renderScreen(api);
    await waitFor(() => r.getByTestId('roman-ai-memory-switch'));
    fireEvent(r.getByTestId('roman-ai-memory-switch'), 'valueChange', true);
    confirmLastAlert(ROMAN_AI_COPY.memoryOn);
    await waitFor(() => expect(api.grantRoman).toHaveBeenCalledTimes(1));
    expect(api.grantRoman).toHaveBeenCalledWith(
      expect.objectContaining({ version: CF5, copy_sha256: AI_CONSENT_COACH_FREE_MEMORY_COPY_SHA256 }),
    );
  });
});
