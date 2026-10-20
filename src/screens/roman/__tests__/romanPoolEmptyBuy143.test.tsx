/**
 * CREDITBUILD-143: with the AI credits flag on, coach Roman's used-up line
 * gets the approved buy links under it (CREDITSTYLE group 10, S3); the client
 * surface, other errors and flag-off builds stay exactly as today.
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import RomanChatScreen from '../RomanChatScreen';
import { romanPoolEmpty } from '../../../components/roman/romanVoice';

jest.mock('@expo/vector-icons', () => {
  function Icon() {
    return null;
  }
  return { Ionicons: Icon, MaterialIcons: Icon, Feather: Icon };
});

jest.mock('react-native-reanimated', () => {
  const View = jest.requireActual('react-native').View;
  return {
    __esModule: true,
    default: { View },
    useSharedValue: (v: number) => ({ value: v }),
    useAnimatedStyle: () => ({}),
    withTiming: (v: number) => v,
    withRepeat: (v: number) => v,
    withDelay: (_d: number, v: number) => v,
    withSequence: (...v: number[]) => v[0],
  };
});

jest.mock('../../../theme/ThemeProvider', () => {
  const colors = new Proxy({}, { get: (_t, prop) => (typeof prop === 'string' ? `#${prop}` : '#000') });
  const Pass = ({ children }: { children: React.ReactNode }) => children;
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return { __esModule: true, ThemeProvider: Pass, default: Pass, useTheme: () => ({ colors, semanticColors: lightTokens }) };
});

jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return { useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }) };
});

jest.mock('../../../services/sentry', () => ({ captureError: jest.fn() }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));
jest.mock('../../../services/secureStorage', () => ({
  secureStorage: { getItem: jest.fn(async () => 'test-token') },
}));
jest.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'client-1', role: 'client', firstName: 'Jane' }),
}));

const mockUseRomanChat = jest.fn();
jest.mock('../useRomanChat', () => ({
  useRomanChat: (surface: unknown) => mockUseRomanChat(surface),
}));

const mockFlags = { credits: true };
jest.mock('../../../config/featureFlags', () => {
  const actual = jest.requireActual('../../../config/featureFlags');
  const featureFlags = { ...actual.featureFlags };
  Object.defineProperty(featureFlags, 'coachAiCredits', { get: () => mockFlags.credits });
  return { ...actual, featureFlags };
});
jest.mock('../../../components/coach/credits/CreditPoolEmptyLinks', () => {
  const { createElement } = jest.requireActual('react');
  const { Text } = jest.requireActual('react-native');
  return () => createElement(Text, null, 'BUY LINKS');
});

function romanState(sendError: unknown) {
  return {
    phase: 'ready',
    session: { id: 's1', surface: 'coach' },
    isFirstOpen: false,
    messages: [],
    sending: false,
    sendError,
    nextCursor: null,
    loadingOlder: false,
    reload: jest.fn(),
    loadOlder: jest.fn(),
    send: jest.fn(async () => 'send-failed'),
    clearSendError: jest.fn(),
  };
}

afterEach(() => {
  mockUseRomanChat.mockReset();
  mockFlags.credits = true;
});

describe('RomanChatScreen: buy links under the used-up line', () => {
  it('adds them for the coach, under the unchanged message', async () => {
    mockUseRomanChat.mockReturnValue(romanState({ kind: 'poolEmpty', message: 'x' }));
    const r = await render(<RomanChatScreen surface="coach" />);
    expect(r.getByText(romanPoolEmpty('coach'))).toBeTruthy();
    expect(r.getByText('BUY LINKS')).toBeTruthy();
  });

  it('never adds them for a client, for another error, or with the flag off', async () => {
    mockUseRomanChat.mockReturnValue(romanState({ kind: 'poolEmpty', message: 'x' }));
    const client = await render(<RomanChatScreen surface="client" />);
    expect(client.queryByText('BUY LINKS')).toBeNull();
    await client.unmount();

    mockUseRomanChat.mockReturnValue(romanState({ kind: 'generic', message: 'x' }));
    const other = await render(<RomanChatScreen surface="coach" />);
    expect(other.queryByText('BUY LINKS')).toBeNull();
    await other.unmount();

    mockFlags.credits = false;
    mockUseRomanChat.mockReturnValue(romanState({ kind: 'poolEmpty', message: 'x' }));
    const off = await render(<RomanChatScreen surface="coach" />);
    expect(off.getByText(romanPoolEmpty('coach'))).toBeTruthy();
    expect(off.queryByText('BUY LINKS')).toBeNull();
  });
});
