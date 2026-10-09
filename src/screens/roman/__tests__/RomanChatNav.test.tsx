import React from 'react';
import { AccessibilityInfo, StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import RomanChatScreen from '../RomanChatScreen';
import type { UseRomanChatResult } from '../useRomanChat';

const mockGoBack = jest.fn();
const mockNavigate = jest.fn();
const mockUseRomanChat = jest.fn();
jest.mock('@react-navigation/native', () => ({
  NavigationContext: jest.requireActual('react').createContext({
    goBack: (...args: unknown[]) => mockGoBack(...args),
    navigate: (...args: unknown[]) => mockNavigate(...args),
  }),
}));
jest.mock('../useRomanChat', () => ({
  useRomanChat: (surface: unknown) => mockUseRomanChat(surface),
}));
jest.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ firstName: 'Sam' }),
}));
jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name, color }: { name: string; color: string }) =>
    require('react').createElement(require('react-native').Text, {
      testID: `icon-${name}`, style: { color },
    }),
}));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({
    colors: { textPrimary: 'theme-foreground' },
    semanticColors: { ...jest.requireActual('../../../theme/tokens').lightTokens, textPrimary: 'theme-foreground' },
  }),
}));
jest.mock('../../../screens/client/wearables/components/useReduceMotion', () => ({
  useReduceMotion: () => true,
}));
jest.mock('../../../ui/skeletons/Skeleton', () => ({ Skeleton: () => null }));
jest.mock('../../../components/ai/useOpenSupport', () => ({ useOpenSupport: () => jest.fn() }));

let state: UseRomanChatResult;
beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  state = {
    phase: 'ready', session: null, isFirstOpen: false, messages: [],
    sending: false, sendError: null, nextCursor: null, loadingOlder: false,
    reload: jest.fn(), loadOlder: jest.fn(), clearSendError: jest.fn(),
    send: jest.fn(async () => 'send-failed'),
  };
  mockUseRomanChat.mockImplementation(() => state);
});
afterEach(() => jest.restoreAllMocks());

it.each(['loading', 'ready', 'offline', 'error', 'unavailable'] as const)(
  '%s: Back is a labelled 44 pt header action and history stays reachable',
  async (phase) => {
    state.phase = phase;
    const view = await render(<RomanChatScreen />);
    const back = view.getByRole('button', { name: 'Back' });
    expect(StyleSheet.flatten(back.props.style)).toMatchObject({ width: 44, height: 44 });
    expect(view.getByTestId('icon-arrow-back').props.style.color).toBe('theme-foreground');
    await fireEvent.press(back);
    expect(mockGoBack).toHaveBeenCalledTimes(1);
    await fireEvent.press(view.getByTestId('roman-conversations-button'));
    expect(mockNavigate).toHaveBeenCalledWith('RomanConversations');
    if (phase === 'offline' || phase === 'error') {
      await fireEvent.press(view.getByTestId('roman-state-retry'));
      expect(state.reload).toHaveBeenCalledTimes(1);
    }
  },
);

it.each(['client', 'coach'] as const)(
  '%s: Back preserves the conversation controls and failed-send draft',
  async (surface) => {
    state.messages = [{
      id: 'older-message', role: 'user', content: 'Earlier question.',
      interrupted: false, createdAt: '2026-10-07T12:00:00.000Z',
    }];
    state.nextCursor = 'older';
    state.sendError = { kind: 'generic', message: 'failed' };
    const view = await render(<RomanChatScreen surface={surface} />);
    await fireEvent.changeText(view.getByTestId('roman-composer-input'), 'Training question');
    expect(state.clearSendError).toHaveBeenCalledTimes(1);
    await fireEvent.press(view.getByTestId('roman-composer-send'));
    expect(state.send).toHaveBeenCalledWith('Training question');
    expect(view.getByTestId('roman-composer-input').props.value).toBe('Training question');
    await fireEvent.press(view.getByTestId('roman-send-retry'));
    expect(state.send).toHaveBeenCalledTimes(2);
    await fireEvent(view.getByTestId('roman-message-list'), 'onEndReached');
    expect(state.loadOlder).toHaveBeenCalledTimes(1);
    expect(view.getByText('Earlier question.')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('Back'));
    expect(mockGoBack).toHaveBeenCalledTimes(1);
    expect(mockUseRomanChat).toHaveBeenCalledWith(surface);
  },
);
