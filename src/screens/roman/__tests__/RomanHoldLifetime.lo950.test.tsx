/**
 * LO-950 B-TEST (lens, agent 202) for m#950 @ 6dfef520: KT-13 LIFETIME. The quote picked with Reply
 * must not outlive an erase of the chat it came from. useRomanChat drops the erased chat's messages
 * and opens a fresh one (useRomanChat.ts 179-197, B-376-1); the screen's replyTarget
 * (RomanChatScreen.tsx 160) is never cleared, so the erased reply stays over the composer and the
 * next message to the fresh chat carries it as "> ...". The hook is mocked here exactly as in
 * RomanHold197; the erase is modelled as the real hook does it (messages emptied, session dropped)
 * plus the real erased event.
 *
 * Copied header of RomanHold197 (ROMAN-HOLD-M (owner #197-D3, phone half of backend #1223): pressing and holding one of Roman's
 * replies in the real RomanChatScreen opens the people's chat menu (Reply, Copy, Report Message).
 * Reply quotes the reply into the next message to Roman; Report sends POST
 * /roman/messages/:id/report with the people's chat reasons; a failed report says so and sends
 * again on the next tap. Client room only: the coach's own Roman room is unchanged (no
 * coach-visible change, job promotion trigger). The menu is the in-app Android sheet here
 * (the iOS native sheet is MessageActionSheet.test's).
 */
import React from 'react';
import { AccessibilityInfo, Alert, Platform } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
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
let mockUser = { id: 'client-1', firstName: 'Maya' };
jest.mock('../useRomanChat', () => ({ useRomanChat: (s: unknown) => mockUseRomanChat(s) }));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../../../hooks/useCoachlessClient', () => ({ useCoachlessClient: () => false }));
jest.mock('@react-navigation/native', () => ({
  NavigationContext: jest.requireActual('react').createContext({ goBack: jest.fn(), navigate: jest.fn() }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../../components/roman/RomanAvatar', () => () => null);
jest.mock('../../../components/ai/useOpenSupport', () => ({ useOpenSupport: () => jest.fn() }));
jest.mock('../../../components/roman/RomanConsentGate', () => ({ children }: { children: React.ReactNode }) => children);

const RomanChatScreen = require('../RomanChatScreen').default;
const api = require('../../../services/api').default as { post: jest.Mock };
const Clipboard = require('expo-clipboard') as { setStringAsync: jest.Mock };

const ROMAN_REPLY =
  'Keep Thursday easy: a **30-minute** ride at a pace you could talk through. Save the hills for Saturday when your legs are fresh.';
const msgs = (): RomanMessage[] => [
  { id: 'u-1', role: 'user', content: 'Swap my Thursday run for a ride?', interrupted: false, createdAt: '2026-11-06T10:00:00Z' },
  { id: 'r-1', role: 'assistant', content: ROMAN_REPLY, interrupted: false, createdAt: '2026-11-06T10:00:05Z' },
];

const realOS = Platform.OS;
beforeAll(() => Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'android' }));
afterAll(() => Object.defineProperty(Platform, 'OS', { configurable: true, get: () => realOS }));

let state: UseRomanChatResult;
beforeEach(() => {
  mockUser = { id: 'client-1', firstName: 'Maya' };
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  api.post.mockReset();
  Clipboard.setStringAsync.mockClear();
  state = {
    phase: 'ready', session: null, isFirstOpen: false, messages: msgs(),
    sending: false, sendError: null, nextCursor: null, loadingOlder: false,
    reload: jest.fn(), loadOlder: jest.fn(), clearSendError: jest.fn(),
    send: jest.fn(async () => 'sent' as const),
  };
  mockUseRomanChat.mockImplementation(() => state);
});
afterEach(() => jest.restoreAllMocks());

const INPUT = 'roman-composer-input';
const open = (surface: 'client' | 'coach' = 'client') => render(<RomanChatScreen surface={surface} />);
type R = Awaited<ReturnType<typeof render>>;
const hold = async (r: R, id = 'r-1') => {
  await act(async () => { fireEvent(r.getByTestId(`roman-message-${id}-reply`), 'longPress'); });
};

const { romanChatsEvents } = require('../../settings/romanChatsEvents');

it('LO-950 B1: after the chat is erased, the Reply quote is gone and the next message carries no quote', async () => {
  const session = (id: string) => ({ id, surface: 'client' as const, messageCount: 2, startedAt: '2026-11-06T10:00:00Z', lastActivityAt: '2026-11-06T10:00:05Z' });
  state = { ...state, session: session('s-old') };
  const r = await open('client');
  await hold(r);
  await act(async () => { fireEvent.press(r.getByLabelText('Reply')); });
  expect(r.getByText('Replying to Roman')).toBeTruthy();
  // The person opens "Your conversations with Roman" from the header and deletes this chat.
  state = { ...state, messages: [], session: null };
  await act(async () => { romanChatsEvents.emitErased({ id: null }); });
  r.rerender(<RomanChatScreen surface="client" />);
  // ...and the hook opens a fresh chat (useRomanChat.ts 191: open()).
  state = { ...state, session: { ...session('s-new'), messageCount: 0 } };
  await act(async () => { r.rerender(<RomanChatScreen surface="client" />); });
  // The erased reply's words must not stay on screen (B-376-1, KT-13).
  expect(r.queryByText('Replying to Roman')).toBeNull();
  expect(r.queryByText(/30-minute/)).toBeNull();
  await fireEvent.changeText(r.getByTestId(INPUT), 'Hi again');
  await act(async () => { fireEvent.press(r.getByTestId('roman-composer-send')); });
  expect(state.send).toHaveBeenCalledWith('Hi again');
});
