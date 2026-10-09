/**
 * ROMAN-ROOM-133 (B30; prototype 69-73): the launch state, overlines, the
 * four quick-start chips, and the room at 360x800 and 390x844 for the QA
 * evidence. Composer styling: RomanChatGuidance.
 */
import React from 'react';
import { AccessibilityInfo, StyleSheet, type TextStyle } from 'react-native';
import type { TestInstance } from 'test-renderer';
import { fireEvent, render } from '@testing-library/react-native';
import RomanChatScreen from '../RomanChatScreen';
import type { UseRomanChatResult } from '../useRomanChat';
import RomanGreeting from '../../../components/roman/RomanGreeting';
import { ROMAN_QUICK_STARTS, ROMAN_ROOM_FOOTER } from '../../../components/roman/romanVoice';
import { typography } from '../../../theme/tokens';

const mockUseRomanChat = jest.fn();
let mockCoachless = false;
let mockWindow = { width: 390, height: 844 };
jest.mock('../useRomanChat', () => ({ useRomanChat: (s: unknown) => mockUseRomanChat(s) }));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ firstName: 'Maya' }) }));
jest.mock('../../../hooks/useCoachlessClient', () => ({ useCoachlessClient: () => mockCoachless }));
jest.mock('@react-navigation/native', () => ({
  NavigationContext: jest.requireActual('react').createContext({ goBack: jest.fn(), navigate: jest.fn() }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
// Bundled art resolves to a machine-specific testUri; snapshots keep the slot only.
jest.mock('../../../components/roman/RomanAvatar', () => ({ testID }: { testID?: string }) =>
  jest.requireActual('react').createElement(jest.requireActual('react-native').View, { testID, accessibilityLabel: 'Roman' }),
);
jest.mock('../../../components/ai/useOpenSupport', () => ({ useOpenSupport: () => jest.fn() }));
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ ...mockWindow, scale: 3, fontScale: 1 }),
}));

let state: UseRomanChatResult;
beforeEach(() => {
  jest.clearAllMocks();
  mockCoachless = false;
  mockWindow = { width: 390, height: 844 };
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
  state = {
    phase: 'ready', session: null, isFirstOpen: false, messages: [],
    sending: false, sendError: null, nextCursor: null, loadingOlder: false,
    reload: jest.fn(), loadOlder: jest.fn(), clearSendError: jest.fn(),
    send: jest.fn(async () => 'sent' as const),
  };
  mockUseRomanChat.mockImplementation(() => state);
});
afterEach(() => jest.restoreAllMocks());

const flat = (node: TestInstance): TextStyle => StyleSheet.flatten(node.props.style) ?? {};

describe('B30 launch state (prototype 69)', () => {
  it('shows the portrait and one serif line with the time of day', async () => {
    const r = await render(<RomanGreeting surface="client" isFirstOpen={false} firstName="Maya" hour={15} />);
    expect(r.getByTestId('roman-greeting-avatar')).toBeTruthy();
    const line = r.getByText(
      "Good afternoon, Maya. I can explain your targets, your plan and today's food, using your own numbers.",
    );
    // Serif reading text, lineHeight 28 on 19 (over the 1.2x floor).
    expect(flat(line)).toMatchObject({ fontFamily: typography.h2.fontFamily, fontSize: 19, lineHeight: 28 });
    const first = await render(<RomanGreeting surface="client" isFirstOpen firstName="" hour={8} />);
    expect(first.getByText(/^Good morning\. My name is Roman\. I can explain/)).toBeTruthy();
  });

  it.each([
    [false, 'AI assistant · Working with your coach'],
    [true, 'AI assistant'],
  ])('client (coachless %s): title, overline, four chips, footer', async (coachless, overline) => {
    mockCoachless = coachless;
    const r = await render(<RomanChatScreen surface="client" />);
    expect(flat(r.getByText('Roman')).fontFamily).toBe(typography.h1.fontFamily);
    expect(r.getByTestId('roman-chat-overline').props.children).toBe(overline);
    expect(ROMAN_QUICK_STARTS).toEqual(['Explain my targets', "Today's workout", 'Hit my protein', 'How was my week']);
    ROMAN_QUICK_STARTS.forEach((label, i) => {
      expect(r.getByTestId(`roman-quick-start-${i}`).props.accessibilityLabel).toBe(label);
    });
    expect(r.getByText(ROMAN_ROOM_FOOTER)).toBeTruthy();
    expect(r.getByTestId('roman-composer-input').props.placeholder).toBe('Ask Roman anything.');
  });

  it('coach surface keeps its own register: no client chips or footer', async () => {
    const r = await render(<RomanChatScreen surface="coach" />);
    expect(r.queryByTestId('roman-quick-starts')).toBeNull();
    expect(r.queryByText(ROMAN_ROOM_FOOTER)).toBeNull();
    expect(r.getByTestId('roman-chat-overline').props.children).toBe('AI assistant · For your practice');
  });
});

describe('B30 chips send fixed prompts (prototype 70-73)', () => {
  it('sends the chip label, keeps a typed draft, and outlines the chip', async () => {
    const r = await render(<RomanChatScreen surface="client" />);
    await fireEvent.changeText(r.getByTestId('roman-composer-input'), 'My own words');
    await fireEvent.press(r.getByTestId('roman-quick-start-0'));
    expect(state.send).toHaveBeenCalledWith('Explain my targets');
    expect(r.getByTestId('roman-composer-input').props.value).toBe('My own words');
    expect(r.getByTestId('roman-quick-start-0').props.accessibilityState).toMatchObject({ selected: true });
  });

  it('a failed chip leaves its prompt to send again; chips are inert while sending', async () => {
    state.send = jest.fn(async () => 'send-failed' as const);
    const r = await render(<RomanChatScreen surface="client" />);
    await fireEvent.press(r.getByTestId('roman-quick-start-3'));
    expect(r.getByTestId('roman-composer-input').props.value).toBe('How was my week');
    state.sending = true;
    await r.rerender(<RomanChatScreen surface="client" />);
    expect(r.getByTestId('roman-quick-start-1').props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('a failed chip never replaces a typed draft (B-601-SOL-B-1)', async () => {
    state.send = jest.fn(async () => 'send-failed' as const);
    const r = await render(<RomanChatScreen surface="client" />);
    await fireEvent.changeText(r.getByTestId('roman-composer-input'), 'My own words');
    await fireEvent.press(r.getByTestId('roman-quick-start-2'));
    expect(state.send).toHaveBeenCalledWith(ROMAN_QUICK_STARTS[2]);
    expect(r.getByTestId('roman-composer-input').props.value).toBe('My own words');
  });
});

describe('QA evidence: the room at 360x800 and 390x844', () => {
  it.each([
    [360, 800],
    [390, 844],
  ])('%sx%s launch state', async (width, height) => {
    mockWindow = { width, height };
    // The snapshot holds the morning greeting: pin the hour so the CI clock never changes it.
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(9);
    const r = await render(<RomanChatScreen surface="client" />);
    expect(r.getByTestId('roman-empty-greeting')).toBeTruthy();
    expect(r.toJSON()).toMatchSnapshot();
  });
});
