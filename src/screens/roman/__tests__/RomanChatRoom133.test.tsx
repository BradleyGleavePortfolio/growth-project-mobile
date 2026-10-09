/**
 * ROMAN-ROOM-133 (B30; prototype 69-73): launch state, chips, reply blocks,
 * the reading reveal (and Reduce Motion), and the room at 360x800 and
 * 390x844 for the QA evidence. Turn and composer styling: RomanChatGuidance.
 */
import React from 'react';
import { AccessibilityInfo, StyleSheet } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import RomanChatScreen from '../RomanChatScreen';
import type { UseRomanChatResult } from '../useRomanChat';
import RomanGreeting from '../../../components/roman/RomanGreeting';
import { romanBlocks } from '../../../components/roman/RomanMessageBubble';
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

const flat = (node: { props: { style?: unknown } }) => StyleSheet.flatten(node.props.style as never) ?? {};
type Node = { props: { style?: unknown }; parent: Node | null };
/** Opacity of the nearest wrapper that sets one (the reveal's Animated.View). */
function opacityOf(node: Node): number {
  for (let n: Node | null = node; n; n = n.parent) {
    const o = (flat(n) as { opacity?: number }).opacity;
    if (typeof o === 'number') return o;
  }
  return 1;
}

describe('B30 launch state (prototype 69)', () => {
  it('shows the portrait and one serif line with the time of day', async () => {
    const r = await render(<RomanGreeting surface="client" isFirstOpen={false} firstName="Maya" hour={15} />);
    expect(r.getByTestId('roman-greeting-avatar')).toBeTruthy();
    const line = r.getByText(
      "Good afternoon, Maya. I can explain your targets, your plan and today's food, using your own numbers.",
    );
    expect(flat(line).fontFamily).toBe(typography.h2.fontFamily);
    expect(flat(line).lineHeight).toBeGreaterThanOrEqual(flat(line).fontSize * 1.2);
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
});

describe('B30 replies read like prose', () => {
  it('splits replies into paragraphs and bullets and drops emphasis markers', () => {
    expect(romanBlocks('Your targets are **1,789** calories.\n\n- Protein first.\n• Fat a quarter.\n2. Carbs the rest.\nAim for close.')).toEqual([
      { kind: 'paragraph', text: 'Your targets are 1,789 calories.' },
      { kind: 'bullet', marker: '\u2022', text: 'Protein first.' },
      { kind: 'bullet', marker: '\u2022', text: 'Fat a quarter.' },
      { kind: 'bullet', marker: '2.', text: 'Carbs the rest.' },
      { kind: 'paragraph', text: 'Aim for close.' },
    ]);
  });

  it.each([
    [false, 0],
    [true, 1],
  ])('a fresh reply fades in (Reduce Motion %s starts at %s); history does not', async (reduce, start) => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(reduce);
    const old = { id: 'a0', role: 'assistant' as const, content: 'Earlier reply.', interrupted: false, createdAt: '2026-10-08' };
    state.messages = [old];
    let resolveSend: (v: 'sent') => void = () => undefined;
    state.send = jest.fn(() => new Promise<'sent'>((res) => { resolveSend = res; }));
    const r = await render(<RomanChatScreen surface="client" />);
    expect(opacityOf(r.getByText('Earlier reply.') as unknown as Node)).toBe(1);
    await fireEvent.press(r.getByTestId('roman-quick-start-1'));
    state.messages = [old,
      { id: 'u1', role: 'user', content: "Today's workout", interrupted: false, createdAt: '2026-10-08' },
      { id: 'a1', role: 'assistant', content: 'Foundations, session one.', interrupted: false, createdAt: '2026-10-08' }];
    await act(async () => { resolveSend('sent'); });
    await r.rerender(<RomanChatScreen surface="client" />);
    expect(opacityOf(r.getByText('Foundations, session one.') as unknown as Node)).toBe(start);
    expect(opacityOf(r.getByText('Earlier reply.') as unknown as Node)).toBe(1);
  });
});

describe('QA evidence: the room at 360x800 and 390x844', () => {
  it.each([
    [360, 800],
    [390, 844],
  ])('%sx%s launch state', async (width, height) => {
    mockWindow = { width, height };
    const r = await render(<RomanChatScreen surface="client" />);
    expect(r.getByTestId('roman-empty-greeting')).toBeTruthy();
    expect(r.toJSON()).toMatchSnapshot();
  });
});
