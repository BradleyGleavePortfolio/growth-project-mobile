/**
 * Owner 62x: Settings > Privacy > Roman and AI for a client with no coach shows only "You have no access
 * to Roman, but may delete prior data here." and one way to the existing list of prior Roman chats (its
 * delete actions and empty state are covered by RomanConversationsScreen's tests). No Allow, Withdraw or
 * memory control, and no ledger read or write.
 */
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import RomanAiConsentScreen, { choiceOf, memorySwitchOf, ROMAN_AI_COPY } from '../RomanAiConsentScreen';
import { ROMAN_CHATS_COPY } from '../romanChatsCopy';
import type { AiConsentOutcome, AiConsentStatusResponse } from '../../../api/aiConsentApi';
import {
  AI_CONSENT_CHECKBOX_LABEL_COACH_FREE,
  AI_CONSENT_COACH_FREE_COPY_SHA256,
  AI_CONSENT_COACH_FREE_MEMORY_COPY_SHA256,
  AI_CONSENT_PARAGRAPH_COACH_FREE,
} from '../../../lib/consultation/copy';
import { resetAiLedgerWritesForTests } from '../../../lib/consultation/aiConsent';
import { HapticService } from '../../../ui/haptics/haptics.service';

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
const LIVE_CF: AiConsentStatusResponse = {
  granted: true,
  state: 'granted',
  version: CF,
  granted_at: '2026-10-12T10:00:00Z',
  withdrawn_at: null,
  current_version: CF,
  needs_reconsent: false,
  copy: { version: CF, paragraph: part(AI_CONSENT_PARAGRAPH_COACH_FREE), box_label: part(AI_CONSENT_CHECKBOX_LABEL_COACH_FREE), sha256: AI_CONSENT_COACH_FREE_COPY_SHA256 },
};

function makeApi() {
  return {
    getStatus: jest.fn(async (): Promise<AiConsentOutcome> => ({ kind: 'ok', status: LIVE_CF })),
    grantRoman: jest.fn(async (): Promise<AiConsentOutcome> => ({ kind: 'ok', status: LIVE_CF })),
    withdrawRoman: jest.fn(async (): Promise<AiConsentOutcome> => ({ kind: 'ok', status: LIVE_CF })),
  };
}
const navigation = { goBack: jest.fn(), navigate: jest.fn() };
const renderScreen = (api: ReturnType<typeof makeApi>) =>
  render(<RomanAiConsentScreen navigation={navigation as never} api={api} sessionUserId={() => 'user-a'} />);

beforeEach(() => {
  resetAiLedgerWritesForTests();
  navigation.navigate.mockClear();
});

describe('Roman and AI, client with no coach (owner 62x)', () => {
  it('shows only the owner sentence and the way to prior chats; no choice, no ledger call', async () => {
    const api = makeApi();
    const r = await renderScreen(api);
    expect(ROMAN_AI_COPY.noAccess).toBe('You have no access to Roman, but may delete prior data here.');
    expect(r.getByTestId('roman-ai-no-access').props.children).toBe(ROMAN_AI_COPY.noAccess);
    expect(r.getByText(ROMAN_AI_COPY.title)).toBeTruthy();
    for (const id of [
      'roman-ai-allow',
      'roman-ai-withdraw',
      'roman-ai-memory-switch',
      'roman-ai-memory-row',
      'roman-ai-paragraph',
      'roman-ai-state-row',
      'roman-ai-loading',
      'roman-ai-account-line',
      'roman-ai-delete-account',
    ]) {
      expect(r.queryByTestId(id)).toBeNull();
    }
    expect(r.queryByText(ROMAN_AI_COPY.allow)).toBeNull();
    expect(r.queryByText(ROMAN_AI_COPY.withdraw)).toBeNull();
    await waitFor(() => expect(r.getByTestId('roman-ai-conversations')).toBeTruthy());
    expect(api.getStatus).not.toHaveBeenCalled();
    expect(api.grantRoman).not.toHaveBeenCalled();
    expect(api.withdrawRoman).not.toHaveBeenCalled();
  });

  it('"Your conversations with Roman" is a labelled button that opens the existing chats list with a light tap', async () => {
    const tap = jest.spyOn(HapticService, 'softImpact');
    const r = await renderScreen(makeApi());
    const open = r.getByTestId('roman-ai-conversations');
    expect(open.props.accessibilityRole).toBe('button');
    expect(open.props.accessibilityLabel).toBe(ROMAN_CHATS_COPY.entryLabel);
    expect(open.props.accessibilityHint).toBe(ROMAN_CHATS_COPY.entryHint);
    expect(r.getByText(ROMAN_CHATS_COPY.entryLabel)).toBeTruthy();
    await fireEvent.press(open);
    expect(navigation.navigate).toHaveBeenCalledWith('RomanConversations');
    expect(tap).toHaveBeenCalled();
    tap.mockRestore();
  });

  it('a coach-free grant recorded before 62x still reads with its own copies (pure helpers)', () => {
    const live = { ...LIVE_CF, memory_on: true, memory_copy: CF5_COPY };
    expect(choiceOf(live).choice).toBe('allowed');
    expect(memorySwitchOf(live)).toEqual({ on: false, onCopy: CF5_COPY });
  });
});
