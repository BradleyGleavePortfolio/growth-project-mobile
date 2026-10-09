import React from 'react';
import { AccessibilityInfo, StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import RomanChatScreen from '../../../screens/roman/RomanChatScreen';
import type { UseRomanChatResult } from '../../../screens/roman/useRomanChat';
import { colors, radius, typography } from '../../../theme/tokens';
import { ROMAN_INTERRUPTED_NOTE, romanPoolEmpty, romanRateLimited } from '../romanVoice';

const mockUseRomanChat = jest.fn();
const mockNavigate = jest.fn();
const mockSupport = jest.fn();
jest.mock('../../../screens/roman/useRomanChat', () => ({
  useRomanChat: (surface: unknown) => mockUseRomanChat(surface),
}));
jest.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ firstName: 'Jane' }),
}));
jest.mock('@react-navigation/native', () => ({
  NavigationContext: jest.requireActual('react').createContext({
    navigate: (...args: unknown[]) => mockNavigate(...args),
  }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../../screens/client/wearables/components/useReduceMotion', () => ({
  useReduceMotion: () => true,
}));
jest.mock('../../../ui/skeletons/Skeleton', () => ({
  Skeleton: () => null,
}));
jest.mock('../../../components/ai/useOpenSupport', () => ({
  useOpenSupport: () => mockSupport,
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => {
    const { colors: c, lightTokens: lt } = jest.requireActual('../../../theme/tokens');
    return { colors: { surface: c.bone, border: c.stone, textPrimary: c.ink,
      textSecondary: c.charcoal, primary: c.forest, textOnPrimary: c.bone, error: c.error },
    semanticColors: lt };
  },
}));
// Keep the real refusal notice; replace only the consent-network boundary.
jest.mock('../../../components/ai/AiConsentSheet', () => ({
  __esModule: true,
  default: ({ visible, onGranted, onClose, testID }: {
    visible: boolean; onGranted: () => void; onClose: () => void; testID: string;
  }) => {
    const { Text, View } = jest.requireActual('react-native');
    return visible ? <View testID={testID}>
      <Text testID={`${testID}-grant`} onPress={onGranted}>Grant</Text>
      <Text testID={`${testID}-close`} onPress={onClose}>Close</Text>
    </View> : null;
  },
}));

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

it('renders serif Roman replies without a bubble and the client in a quiet right-aligned bubble (B30)', async () => {
  state.messages = [
    { id: 'a', role: 'assistant', content: 'Recovery guidance.', interrupted: true, createdAt: '2026-10-07' },
    { id: 'u', role: 'user', content: 'Explain that.', interrupted: false, createdAt: '2026-10-07' },
  ];
  const r = await render(<RomanChatScreen />);
  expect(r.getByText('ROMAN')).toBeTruthy();
  expect(r.queryByText('YOU')).toBeNull();
  expect(r.getByTestId('roman-bubble-avatar')).toBeTruthy();
  expect(r.getByText(ROMAN_INTERRUPTED_NOTE)).toBeTruthy();
  expect(StyleSheet.flatten(r.getByLabelText(`Roman said: Recovery guidance. ${ROMAN_INTERRUPTED_NOTE}`).props.style)?.backgroundColor).toBeUndefined();
  const prose = StyleSheet.flatten(r.getByText('Recovery guidance.').props.style);
  expect(prose).toMatchObject({ fontFamily: typography.h2.fontFamily, fontSize: 19, lineHeight: 28 });
  expect(StyleSheet.flatten(r.getByText('Roman').props.style).fontFamily).toBe(typography.h1.fontFamily);
  expect(StyleSheet.flatten(r.getByTestId('roman-message-u-bubble').props.style)).toMatchObject({
    backgroundColor: jest.requireActual('../../../theme/tokens').lightTokens.bgSurface, borderRadius: radius.card,
  });
  for (const id of ['a', 'u']) {
    const row = r.getByTestId(`roman-message-${id}`);
    expect(row.props.role).toBe('listitem');
    expect(StyleSheet.flatten(row.props.style).borderBottomWidth).toBeUndefined();
  }
  expect(StyleSheet.flatten(r.getByTestId('roman-message-u').props.style).alignItems).toBe('flex-end');
});

it.each(['client', 'coach'] as const)('%s keeps history, editing, send, preserved draft, retry and older messages', async (surface) => {
  state.messages = [{ id: 'u', role: 'user', content: 'Earlier.', interrupted: false, createdAt: '2026-10-07' }];
  state.nextCursor = 'older';
  state.sendError = { kind: 'generic', message: 'failed' };
  const r = await render(<RomanChatScreen surface={surface} />);
  expect(mockUseRomanChat).toHaveBeenCalledWith(surface);
  await fireEvent.press(r.getByTestId('roman-conversations-button'));
  expect(mockNavigate).toHaveBeenCalledWith('RomanConversations');
  await fireEvent.changeText(r.getByTestId('roman-composer-input'), 'Explain recovery');
  expect(state.clearSendError).toHaveBeenCalled();
  await fireEvent.press(r.getByTestId('roman-composer-send'));
  expect(state.send).toHaveBeenCalledWith('Explain recovery');
  expect(r.getByTestId('roman-composer-input').props.value).toBe('Explain recovery');
  await fireEvent.press(r.getByTestId('roman-send-retry'));
  expect(state.send).toHaveBeenCalledTimes(2);
  await fireEvent(r.getByTestId('roman-message-list'), 'onEndReached');
  expect(state.loadOlder).toHaveBeenCalledTimes(1);
  state.send = jest.fn(async () => 'sent');
  await r.rerender(<RomanChatScreen surface={surface} />);
  await fireEvent.press(r.getByTestId('roman-composer-send'));
  expect(r.getByTestId('roman-composer-input').props.value).toBe('');
});

it('keeps a rounded Inter field, the forest send square and sending/length guards (B30)', async () => {
  const r = await render(<RomanChatScreen />);
  const input = r.getByTestId('roman-composer-input');
  expect(StyleSheet.flatten(input.props.style).backgroundColor).toBeUndefined();
  expect(StyleSheet.flatten(input.props.style).fontFamily).toBe(typography.body.fontFamily);
  expect(input.props.placeholder).toBe('Ask Roman anything.');
  expect(StyleSheet.flatten(r.getByTestId('roman-composer-field').props.style).borderRadius).toBe(radius.input);
  // Empty draft: the forest square stays (never a grey dead square, owner S8).
  expect(StyleSheet.flatten(r.getByTestId('roman-composer-send').props.style).backgroundColor).toBe(colors.forest);
  await fireEvent.changeText(input, 'A question');
  const buttonStyle = StyleSheet.flatten(r.getByTestId('roman-composer-send').props.style);
  expect(buttonStyle).toMatchObject({ backgroundColor: colors.forest, borderRadius: radius.button, width: 44, height: 44 });
  await fireEvent.changeText(input, 'x'.repeat(8001));
  expect(r.getByTestId('roman-composer-send').props.accessibilityState.disabled).toBe(true);
  state.sending = true;
  await r.rerender(<RomanChatScreen />);
  expect(r.getByTestId('roman-typing')).toBeTruthy();
  expect(r.getByTestId('roman-composer-spinner')).toBeTruthy();
  expect(r.getByTestId('roman-composer-input').props.editable).toBe(false);
});

it.each(['loading', 'unavailable', 'offline', 'error'] as const)('%s preserves history and existing retry eligibility', async (phase) => {
  state.phase = phase;
  const r = await render(<RomanChatScreen />);
  expect(r.getByTestId('roman-conversations-button')).toBeTruthy();
  if (phase === 'offline' || phase === 'error') {
    await fireEvent.press(r.getByTestId('roman-state-retry'));
    expect(state.reload).toHaveBeenCalledTimes(1);
  } else {
    expect(r.queryByTestId('roman-state-retry')).toBeNull();
  }
  expect(r.queryByTestId('roman-composer')).toBeNull();
});

it.each(['rateLimited', 'poolEmpty'] as const)('%s keeps the composer and no futile retry', async (kind) => {
  state.sendError = { kind, message: 'limited', retryAfterSeconds: 5 };
  const r = await render(<RomanChatScreen />);
  expect(r.getByTestId('roman-send-error')).toBeTruthy();
  expect(r.getByText(kind === 'poolEmpty' ? romanPoolEmpty('client') : romanRateLimited(5))).toBeTruthy();
  expect(r.queryByTestId('roman-send-retry')).toBeNull();
  expect(r.getByTestId('roman-composer')).toBeTruthy();
});

it('keeps daily-cap dismissal and the composer usable', async () => {
  state.sendError = { kind: 'dailyCap', message: 'cap', dailyCap: { resetsAt: new Date('2026-10-08') } };
  const r = await render(<RomanChatScreen />);
  await fireEvent.press(r.getByTestId('roman-daily-cap-ok'));
  expect(state.clearSendError).toHaveBeenCalledTimes(1);
  expect(r.getByTestId('roman-composer-input').props.editable).toBe(true);
});

it('keeps consent open/close/grant, coach retry, support and reference copy', async () => {
  state.sendError = { kind: 'aiRefused', message: 'off', refusal: { kind: 'consent_required' } };
  const r = await render(<RomanChatScreen />);
  await fireEvent.press(r.getByTestId('roman-ai-refusal-allow'));
  await fireEvent.press(r.getByTestId('roman-ai-refusal-consent-sheet-close'));
  expect(r.queryByTestId('roman-ai-refusal-consent-sheet')).toBeNull();
  await fireEvent.press(r.getByTestId('roman-ai-refusal-allow'));
  await fireEvent.press(r.getByTestId('roman-ai-refusal-consent-sheet-grant'));
  expect(state.send).toHaveBeenCalledTimes(1);
  await r.rerender(<RomanChatScreen surface="coach" />);
  await fireEvent.press(r.getByTestId('roman-ai-refusal-retry'));
  expect(state.send).toHaveBeenCalledTimes(2);
  state.sendError = { kind: 'aiRefused', message: 'paused',
    refusal: { kind: 'egress_blocked', reference: 'ref-123', serverMessage: null } };
  await r.rerender(<RomanChatScreen />);
  await fireEvent.press(r.getByTestId('roman-ai-refusal-support'));
  expect(mockSupport).toHaveBeenCalledTimes(1);
  await fireEvent.press(r.getByTestId('roman-ai-refusal-copy-reference'));
  expect(jest.requireMock('expo-clipboard').setStringAsync).toHaveBeenCalledWith('ref-123');
});

it('never automatically repeats an already-stored consent-refused turn', async () => {
  state.sendError = { kind: 'aiRefused', message: 'off', turnStored: true,
    refusal: { kind: 'consent_required' } };
  const r = await render(<RomanChatScreen surface="coach" />);
  await fireEvent.press(r.getByTestId('roman-ai-refusal-retry'));
  expect(state.clearSendError).toHaveBeenCalledTimes(1);
  expect(state.send).not.toHaveBeenCalled();
  state.sendError = null;
  await r.rerender(<RomanChatScreen surface="coach" />);
  expect(r.getByTestId('roman-ask-again')).toBeTruthy();
});
