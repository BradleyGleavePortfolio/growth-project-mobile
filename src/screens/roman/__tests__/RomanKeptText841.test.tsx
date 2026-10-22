/**
 * CHAT-DISCARD (owner 10-21, op 1) in the Roman chat, at screen level (Opus C3, m#841): the real RomanChatScreen keeps
 * half-typed text on the device for the signed-in account. It is back after leaving and opening Roman again and after
 * the app closed (device copy, memory empty); a failed send keeps it; a sent message and a sign-out leave the box
 * empty. Roman keeps one text per account (Opus C5), on the client and the coach surface alike.
 */
import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import type { UseRomanChatResult } from '../useRomanChat';

const mockDisk = new Map<string, string>();
jest.mock('../../../storage/mmkv', () => ({
  cacheStorage: {
    getString: () => undefined, // the AsyncStorage fallback in release builds: no synchronous read
    getStringAsync: async (k: string) => mockDisk.get(k),
    set: async (k: string, v: string) => { mockDisk.set(k, v); },
    delete: async (k: string) => { mockDisk.delete(k); },
    getAllKeys: async () => [...mockDisk.keys()],
  },
}));
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
// The coach surface's consent gate has its own suite; here it is open.
jest.mock('../../../components/roman/RomanConsentGate', () => ({ children }: { children: React.ReactNode }) => children);

const RomanChatScreen = require('../RomanChatScreen').default;
const { authEvents } = require('../../../utils/authEvents');
const { CHAT_DRAFT_KEY_PREFIX } = require('../../../lib/chatDrafts');

let state: UseRomanChatResult;
beforeEach(async () => {
  mockUser = { id: 'client-1', firstName: 'Maya' };
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
  state = {
    phase: 'ready', session: null, isFirstOpen: false, messages: [],
    sending: false, sendError: null, nextCursor: null, loadingOlder: false,
    reload: jest.fn(), loadOlder: jest.fn(), clearSendError: jest.fn(),
    send: jest.fn(async () => 'sent' as const),
  };
  mockUseRomanChat.mockImplementation(() => state);
  authEvents.emit('logout');
  await waitFor(() => expect([...mockDisk.keys()]).toEqual([]));
});
afterEach(() => jest.restoreAllMocks());

const INPUT = 'roman-composer-input';
const open = (surface: 'client' | 'coach' = 'client') => render(<RomanChatScreen surface={surface} />);
const boxOf = (r: Awaited<ReturnType<typeof render>>): string => r.getByTestId(INPUT).props.value;

it.each(['client', 'coach'] as const)('%s: half-typed text is back after leaving Roman and opening him again', async (surface) => {
  mockUser = surface === 'coach' ? { id: 'coach-1', firstName: 'Jordan' } : { id: 'client-1', firstName: 'Maya' };
  const a = await open(surface);
  await fireEvent.changeText(a.getByTestId(INPUT), 'What should I eat bef');
  await a.unmount();
  expect(boxOf(await open(surface))).toBe('What should I eat bef');
  await waitFor(() => expect(mockDisk.get(`${CHAT_DRAFT_KEY_PREFIX}${mockUser.id}:roman`)).toContain('What should I eat bef'));
});

it('after the app closed (memory empty), the device copy fills the box; another account never sees it', async () => {
  mockDisk.set(`${CHAT_DRAFT_KEY_PREFIX}client-1:roman`, JSON.stringify({ text: 'How much protein after a l' }));
  const r = await open();
  await waitFor(() => expect(boxOf(r)).toBe('How much protein after a l'));
  await r.unmount();
  mockUser = { id: 'client-2', firstName: 'Ben' };
  const other = await open();
  await act(async () => undefined);
  expect(boxOf(other)).toBe('');
});

it('a failed send keeps the text, also after leaving; a sent message leaves the box empty', async () => {
  state.send = jest.fn(async () => 'send-failed' as const);
  const a = await open();
  await fireEvent.changeText(a.getByTestId(INPUT), 'Swap my Thursday run for a ride?');
  await act(async () => { fireEvent.press(a.getByTestId('roman-composer-send')); });
  expect(state.send).toHaveBeenCalledWith('Swap my Thursday run for a ride?');
  expect(boxOf(a)).toBe('Swap my Thursday run for a ride?');
  await a.unmount();
  state.send = jest.fn(async () => 'sent' as const);
  const b = await open();
  expect(boxOf(b)).toBe('Swap my Thursday run for a ride?');
  await act(async () => { fireEvent.press(b.getByTestId('roman-composer-send')); });
  expect(boxOf(b)).toBe('');
  await b.unmount();
  expect(boxOf(await open())).toBe('');
});

it('a sign-out removes the kept Roman text from memory and the device', async () => {
  const a = await open();
  await fireEvent.changeText(a.getByTestId(INPUT), 'What should I eat bef');
  await a.unmount();
  await waitFor(() => expect([...mockDisk.keys()]).toHaveLength(1));
  authEvents.emit('logout');
  await waitFor(() => expect([...mockDisk.keys()]).toEqual([]));
  expect(boxOf(await open())).toBe('');
});
