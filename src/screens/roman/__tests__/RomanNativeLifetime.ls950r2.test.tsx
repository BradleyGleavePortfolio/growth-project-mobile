/**
 * LS-950R2 B-TEST: the native iOS menu belongs to the chat/sign-in that opened it.
 * The actual menu captures a callback in ActionSheetIOS. Changing its visible prop
 * must dismiss the native UI and invalidate that callback, not just hide React state.
 */
import React from 'react';
import { AccessibilityInfo, ActionSheetIOS, Alert, Platform } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import type { UseRomanChatResult } from '../useRomanChat';

jest.mock('../../../storage/mmkv', () => ({
  ...jest.requireActual('../../../storage/mmkv'),
  cacheStorage: {
    getString: () => undefined, getStringAsync: async () => undefined,
    set: async () => undefined, delete: async () => undefined, getAllKeys: async () => [],
  },
}));
jest.mock('../../../services/api', () => ({
  __esModule: true, default: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));
const mockUseRomanChat = jest.fn();
jest.mock('../useRomanChat', () => ({ useRomanChat: (s: unknown) => mockUseRomanChat(s) }));
jest.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'client-1', firstName: 'Maya' }),
}));
jest.mock('../../../hooks/useCoachlessClient', () => ({ useCoachlessClient: () => false }));
jest.mock('@react-navigation/native', () => ({
  NavigationContext: jest.requireActual('react').createContext({ goBack: jest.fn(), navigate: jest.fn() }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../../components/roman/RomanAvatar', () => () => null);
jest.mock('../../../components/ai/useOpenSupport', () => ({ useOpenSupport: () => jest.fn() }));
jest.mock('../../../components/roman/RomanConsentGate', () => ({
  children,
}: { children: React.ReactNode }) => children);

const RomanChatScreen = require('../RomanChatScreen').default;
const Clipboard = require('expo-clipboard') as { setStringAsync: jest.Mock };
const { authEvents } = require('../../../utils/authEvents');
const originalOS = Platform.OS;
let state: UseRomanChatResult;
let nativeChoose: (index: number) => void;
let dismiss: jest.SpyInstance;

beforeAll(() => Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'ios' }));
afterAll(() => Object.defineProperty(Platform, 'OS', { configurable: true, get: () => originalOS }));
beforeEach(() => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation((_options, callback) => {
    nativeChoose = callback;
  });
  dismiss = jest.spyOn(ActionSheetIOS, 'dismissActionSheet').mockImplementation(() => undefined);
  Clipboard.setStringAsync.mockClear();
  state = {
    phase: 'ready',
    session: {
      id: 'source-session', surface: 'client', messageCount: 1,
      startedAt: '2026-11-06T10:00:00Z', lastActivityAt: '2026-11-06T10:00:05Z',
    },
    isFirstOpen: false,
    messages: [{
      id: 'r-old', role: 'assistant', content: 'Keep Thursday easy.',
      interrupted: false, createdAt: '2026-11-06T10:00:05Z',
    }],
    sending: false, sendError: null, nextCursor: null, loadingOlder: false,
    reload: jest.fn(), loadOlder: jest.fn(), clearSendError: jest.fn(),
    send: jest.fn(async () => 'sent' as const),
  };
  mockUseRomanChat.mockImplementation(() => state);
});
afterEach(() => jest.restoreAllMocks());

async function openNativeMenu() {
  const r = await render(<RomanChatScreen surface="client" />);
  await act(async () => { fireEvent(r.getByTestId('roman-message-r-old-reply'), 'longPress'); });
  expect(ActionSheetIOS.showActionSheetWithOptions).toHaveBeenCalledTimes(1);
  return r;
}

it.each([
  ['Reply', 0], ['Copy', 1], ['Report', 2],
] as const)('LS-950R2 B1: an old native %s callback cannot revive an erased chat', async (_name, index) => {
  const r = await openNativeMenu();
  state = {
    ...state, messages: [],
    session: { ...state.session!, id: 'fresh-session', messageCount: 0 },
  };
  await r.rerender(<RomanChatScreen surface="client" />);
  // A queued native callback is still unsafe even after programmatic dismissal.
  await act(async () => { nativeChoose(index); });
  expect({
    quoteVisible: r.queryByText('Replying to Roman') !== null,
    reportVisible: r.queryByLabelText('Submit report') !== null,
    copies: Clipboard.setStringAsync.mock.calls,
  }).toEqual({ quoteVisible: false, reportVisible: false, copies: [] });
});

it('LS-950R2 B1: sign-out dismisses the native menu containing the old reply', async () => {
  const r = await openNativeMenu();
  dismiss.mockClear();
  await act(async () => { authEvents.emit('logout'); });
  await r.rerender(<RomanChatScreen surface="client" />);
  expect(dismiss).toHaveBeenCalledTimes(1);
});

it('LS-950R2 B1: unmount dismisses the native menu containing the old reply', async () => {
  const r = await openNativeMenu();
  dismiss.mockClear();
  await r.unmount();
  expect(dismiss).toHaveBeenCalledTimes(1);
});
