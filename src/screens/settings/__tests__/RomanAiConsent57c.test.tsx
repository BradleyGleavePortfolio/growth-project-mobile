/**
 * Owner 57c: the coached Roman consent carries the safety-reply exception (client-ai-v6 / v7). The app
 * asks for it (GET ?variant=safety_exception), shows and grants it with its pins; a live grant of the
 * client-ai-v4 / v5 generation is still read and changed with its own copies.
 */
import React from 'react';
import { Alert, AlertButton } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import RomanAiConsentScreen, { ROMAN_AI_COPY } from '../RomanAiConsentScreen';
import type { AiConsentOutcome, AiConsentStatusResponse } from '../../../api/aiConsentApi';
import {
  AI_CONSENT_CHECKBOX_LABEL,
  AI_CONSENT_COPY_SHA256,
  AI_CONSENT_MEMORY_COPY_SHA256,
  AI_CONSENT_PARAGRAPH,
  AI_CONSENT_PARAGRAPH_PRE57C,
  AI_CONSENT_PRE57C_COPY_SHA256,
  AI_CONSENT_PRE57C_MEMORY_COPY_SHA256,
  AI_CONSENT_SAFETY_EXCEPTION,
} from '../../../lib/consultation/copy';
import {
  isLiveRomanGrant,
  pinnedMemoryCopy,
  resetAiLedgerWritesForTests,
  romanFamily,
  romanFamilyOf,
  romanGrantBody,
} from '../../../lib/consultation/aiConsent';

jest.mock('../../../services/api', () => ({ __esModule: true, default: {} }));
jest.mock('../../../utils/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({
    colors: new Proxy({}, { get: () => '#123456' }),
    semanticColors: new Proxy({}, { get: () => '#123456' }),
  }),
}));
jest.mock('expo-font', () => ({ isLoaded: () => true, loadAsync: jest.fn() }));
jest.mock('../../../services/sentry', () => ({ captureError: jest.fn(), setSentryUser: jest.fn() }));
// A signed-in client with a coach.
jest.mock('../../../lib/userCache', () => ({
  readUserCacheSync: jest.fn(() => ({ id: 'user-a', coach_id: 'coach-1' })),
  readUserCache: jest.fn(async () => null),
}));

const part = (text: string) => ({ text, sha256: 'a'.repeat(64) });
function status(over: Partial<AiConsentStatusResponse> = {}): AiConsentStatusResponse {
  return {
    granted: false,
    state: 'not_granted',
    version: null,
    granted_at: null,
    withdrawn_at: null,
    current_version: 'client-ai-v6',
    needs_reconsent: false,
    copy: { version: 'client-ai-v6', paragraph: part(AI_CONSENT_PARAGRAPH), box_label: part(AI_CONSENT_CHECKBOX_LABEL), sha256: AI_CONSENT_COPY_SHA256 },
    ...over,
  };
}
const V7_COPY = {
  version: 'client-ai-v7',
  paragraph: part(`Roman may keep notes. ${AI_CONSENT_SAFETY_EXCEPTION}`),
  box_label: part(AI_CONSENT_CHECKBOX_LABEL),
  sha256: AI_CONSENT_MEMORY_COPY_SHA256,
};
const LIVE_V6 = status({ granted: true, state: 'granted', version: 'client-ai-v6', granted_at: '2026-10-12T10:00:00Z' });

function makeApi(first: AiConsentStatusResponse) {
  return {
    getStatus: jest.fn(async (): Promise<AiConsentOutcome> => ({ kind: 'ok', status: first })),
    grantRoman: jest.fn(async (): Promise<AiConsentOutcome> => ({ kind: 'ok', status: LIVE_V6 })),
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

describe('copy families (owner 57c)', () => {
  it('coached is client-ai-v6 / v7; a status of the v4 / v5 generation reads with its own copies', () => {
    const coached = romanFamily(false);
    expect(coached).toMatchObject({ baseVersion: 'client-ai-v6', memoryVersion: 'client-ai-v7', paragraph: AI_CONSENT_PARAGRAPH });
    expect(romanFamilyOf(status())).toBe(coached);
    const pre = romanFamilyOf(status({ current_version: 'client-ai-v4' }));
    expect(pre).toMatchObject({ baseVersion: 'client-ai-v4', memoryVersion: 'client-ai-v5', paragraph: AI_CONSENT_PARAGRAPH_PRE57C });
    expect(romanFamilyOf(status({ current_version: 'client-ai-v5' }))).toBe(pre);
    expect(romanGrantBody(null, coached)).toMatchObject({ version: 'client-ai-v6', copy_sha256: AI_CONSENT_COPY_SHA256 });
    expect(romanGrantBody(null, pre)).toMatchObject({ version: 'client-ai-v4', copy_sha256: AI_CONSENT_PRE57C_COPY_SHA256 });
    expect(pinnedMemoryCopy(V7_COPY)).toEqual(V7_COPY);
    expect(pinnedMemoryCopy({ ...V7_COPY, version: 'client-ai-v5', sha256: AI_CONSENT_PRE57C_MEMORY_COPY_SHA256 }, pre)).not.toBeNull();
    const liveV4 = status({ granted: true, state: 'granted', version: 'client-ai-v4', current_version: 'client-ai-v4' });
    expect(isLiveRomanGrant(liveV4)).toBe(true);
    expect(isLiveRomanGrant(LIVE_V6)).toBe(true);
  });
});

describe('Settings > Roman and AI, client with a coach (owner 57c)', () => {
  it('shows the client-ai-v6 paragraph with the exception, and Allow grants client-ai-v6 with its pin', async () => {
    const api = makeApi(status());
    const r = await renderScreen(api);
    await waitFor(() => r.getByTestId('roman-ai-not_allowed'));
    expect(api.getStatus).toHaveBeenCalledWith();
    expect(r.getByTestId('roman-ai-paragraph').props.children).toBe(AI_CONSENT_PARAGRAPH);
    expect(AI_CONSENT_PARAGRAPH.endsWith(AI_CONSENT_SAFETY_EXCEPTION)).toBe(true);
    await fireEvent.press(r.getByTestId('roman-ai-allow'));
    confirmLastAlert(ROMAN_AI_COPY.allow);
    await waitFor(() => expect(api.grantRoman).toHaveBeenCalledTimes(1));
    expect(api.grantRoman).toHaveBeenCalledWith(expect.objectContaining({ version: 'client-ai-v6', copy_sha256: AI_CONSENT_COPY_SHA256 }), {});
    await waitFor(() => r.getByTestId('roman-ai-allowed'));
  });

  it('with Roman memory on, Allow grants the server client-ai-v7 copy with its sha256', async () => {
    const api = makeApi(status({ memory_on: true, memory_copy: V7_COPY }));
    const r = await renderScreen(api);
    await waitFor(() => r.getByTestId('roman-ai-not_allowed'));
    expect(r.getByTestId('roman-ai-paragraph').props.children).toBe(V7_COPY.paragraph.text);
    await fireEvent.press(r.getByTestId('roman-ai-allow'));
    confirmLastAlert(ROMAN_AI_COPY.allow);
    await waitFor(() => expect(api.grantRoman).toHaveBeenCalledTimes(1));
    expect(api.grantRoman).toHaveBeenCalledWith(expect.objectContaining({ version: 'client-ai-v7', copy_sha256: AI_CONSENT_MEMORY_COPY_SHA256 }), {});
  });
});
