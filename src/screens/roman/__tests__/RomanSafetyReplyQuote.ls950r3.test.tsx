/**
 * LS-950R3 B-TEST: Reply on one of Roman's crisis replies must send the person's own words to Roman.
 * At the head the quote line carries the 988 template's words ("988 Suicide & Crisis Lifeline") as the
 * first line of the person's turn (romanReply.ts withRomanQuote). The server classifies the whole turn
 * (roman.controller.ts isSafetyShortCircuit(dto.content); safety-router.ts classifySafety; the self-harm
 * pattern /\bsuicid(e|al)\b/ from ai-crisis-router.ts), so every such Reply is answered with the template
 * again and alerts the coach again, and the person's answer never reaches Roman.
 * Android in-app sheet here, as RomanHold197.test.tsx; the quote path is platform-neutral.
 */
import React from 'react';
import { AccessibilityInfo, Alert, Platform } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import type { UseRomanChatResult } from '../useRomanChat';
import type { RomanMessage } from '../../../api/romanApi';

jest.mock('../../../storage/mmkv', () => ({
  ...jest.requireActual('../../../storage/mmkv'),
  cacheStorage: {
    getString: () => undefined,
    getStringAsync: async () => undefined,
    set: async () => undefined,
    delete: async () => undefined,
    getAllKeys: async () => [],
  },
}));
jest.mock('../../../services/api', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn(), delete: jest.fn() } }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));
const mockUseRomanChat = jest.fn();
jest.mock('../useRomanChat', () => ({ useRomanChat: (s: unknown) => mockUseRomanChat(s) }));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'client-1', firstName: 'Maya' }) }));
jest.mock('../../../hooks/useCoachlessClient', () => ({ useCoachlessClient: () => false }));
jest.mock('@react-navigation/native', () => ({
  NavigationContext: jest.requireActual('react').createContext({ goBack: jest.fn(), navigate: jest.fn() }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../../components/roman/RomanAvatar', () => () => null);
jest.mock('../../../components/ai/useOpenSupport', () => ({ useOpenSupport: () => jest.fn() }));
jest.mock('../../../components/roman/RomanConsentGate', () => ({ children }: { children: React.ReactNode }) => children);

const RomanChatScreen = require('../RomanChatScreen').default;

// backend main safety-router.ts ROMAN_SAFETY_TEMPLATES.self_harm, word for word (a stored Roman turn).
const SELF_HARM_TEMPLATE =
  'I am sorry you are carrying this, and I am glad you said it here rather than holding it alone. ' +
  'Please reach the 988 Suicide & Crisis Lifeline now: call or text 988 in the United States, any hour, and a trained person will answer. ' +
  'If you are in immediate danger, call 911. ' +
  'If you can, let someone you trust know where you are so they can sit with you. ' +
  'You matter, and talking to a person right now is the right next step.';
// backend main ai-crisis-router.ts SELF_HARM[0], the pattern that reads the quoted template as the person's words.
const SERVER_SELF_HARM_PATTERN = /\bsuicid(e|al)\b/i;

const msgs = (): RomanMessage[] => [
  { id: 'u-1', role: 'user', content: 'Earlier message from the person', interrupted: false, createdAt: '2026-11-06T10:00:00Z' },
  // The server marks its crisis reply (CRISIS-BTN safety_actions); the text is the stored turn.
  { id: 'r-988', role: 'assistant', content: SELF_HARM_TEMPLATE, interrupted: false, createdAt: '2026-11-06T10:00:05Z',
    safetyActions: ['call_988', 'text_988'] },
];

const realOS = Platform.OS;
beforeAll(() => Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'android' }));
afterAll(() => Object.defineProperty(Platform, 'OS', { configurable: true, get: () => realOS }));

let state: UseRomanChatResult;
beforeEach(() => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  state = {
    phase: 'ready', session: null, isFirstOpen: false, messages: msgs(),
    sending: false, sendError: null, nextCursor: null, loadingOlder: false,
    reload: jest.fn(), loadOlder: jest.fn(), clearSendError: jest.fn(),
    send: jest.fn(async () => 'sent' as const),
  };
  mockUseRomanChat.mockImplementation(() => state);
});
afterEach(() => jest.restoreAllMocks());

it("LS-950R3 B1: Reply on Roman's 988 reply sends the person's words, not the template's", async () => {
  const r = await render(<RomanChatScreen surface="client" />);
  await act(async () => { fireEvent(r.getByTestId('roman-message-r-988-reply'), 'longPress'); });
  const reply = r.queryByLabelText('Reply');
  if (reply) {
    await act(async () => { fireEvent.press(reply); });
  }
  await fireEvent.changeText(r.getByTestId('roman-composer-input'), 'I am safe now. I called my sister and she is with me.');
  await act(async () => { fireEvent.press(r.getByTestId('roman-composer-send')); });
  expect(state.send).toHaveBeenCalledTimes(1);
  const sent = (state.send as jest.Mock).mock.calls[0][0] as string;
  expect(sent).toContain('I am safe now. I called my sister and she is with me.');
  // The server reads the whole turn as the person's words: nothing in it may match the self-harm pattern.
  expect(sent).not.toMatch(SERVER_SELF_HARM_PATTERN);
});
