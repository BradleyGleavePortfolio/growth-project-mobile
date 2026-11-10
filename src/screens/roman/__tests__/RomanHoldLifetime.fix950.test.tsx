/**
 * FIX-950R1 (agent 202) for m#950: KT-13 LIFETIME, class-first (LS-950 B1, LO-950 B1, LO-950 C1).
 * The reply picked in Roman's room (the held one with its menu open, the one quoted over the
 * composer, the one in the report sheet) belongs to the chat and sign-in it was picked in. Each
 * way the room's chat ends or changes drops it at once, and the next send carries no quote:
 * Delete on this chat, Delete all, the chat gone, a fresh chat, another chat, sign-out.
 * The hook is mocked as in RomanHold197; each change is modelled as useRomanChat makes it.
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
const { authEvents } = require('../../../utils/authEvents');

const session = (id: string, messageCount = 2) => ({
  id, surface: 'client' as const, messageCount, startedAt: '2026-11-06T10:00:00Z', lastActivityAt: '2026-11-06T10:00:05Z',
});
const OTHER: RomanMessage[] = [
  { id: 'u-9', role: 'user', content: 'What about Friday?', interrupted: false, createdAt: '2026-11-05T09:00:00Z' },
  { id: 'r-9', role: 'assistant', content: 'Friday is a rest day.', interrupted: false, createdAt: '2026-11-05T09:00:05Z' },
];
const rerender = async (r: R) => { await r.rerender(<RomanChatScreen surface="client" />); };

/** The erase paths as useRomanChat makes them: the session and messages drop, then a fresh chat opens. */
const dropThenFresh = async (r: R, fire: () => void) => {
  state = { ...state, messages: [], session: null };
  await act(async () => { fire(); });
  await rerender(r);
  state = { ...state, session: session('s-new', 0) };
  await rerender(r);
};

const PATHS: Array<[string, (r: R) => Promise<void>]> = [
  ['Delete on this chat', (r) => dropThenFresh(r, () => romanChatsEvents.emitErased({ id: 's-old' }))],
  ['Delete all', (r) => dropThenFresh(r, () => romanChatsEvents.emitErased({ id: null }))],
  ['the chat is gone', (r) => dropThenFresh(r, () => romanChatsEvents.emitGone({ ownerId: 'client-1', epoch: 0, id: 's-old' }))],
  ['a fresh chat opens', async (r) => { state = { ...state, messages: [], session: session('s-new', 0) }; await rerender(r); }],
  ['another chat from history', async (r) => { state = { ...state, messages: OTHER, session: session('s-other') }; await rerender(r); }],
  ['sign-out', async (r) => { await act(async () => { authEvents.emit('logout'); }); await rerender(r); }],
];

const pickReply = async (r: R) => {
  await hold(r);
  await act(async () => { fireEvent.press(r.getByLabelText('Reply')); });
  expect(r.getByText('Replying to Roman')).toBeTruthy();
};

beforeEach(() => {
  state = { ...state, session: session('s-old') };
});

describe.each(PATHS)('FIX-950R1 KT-13: %s', (_name, change) => {
  it('drops the Reply quote, and the next send carries no quote', async () => {
    const r = await open();
    await pickReply(r);
    await change(r);
    expect(r.queryByText('Replying to Roman')).toBeNull();
    expect(r.queryByLabelText('Cancel reply')).toBeNull();
    await fireEvent.changeText(r.getByTestId(INPUT), 'Hi again');
    await act(async () => { fireEvent.press(r.getByTestId('roman-composer-send')); });
    expect(state.send).toHaveBeenCalledTimes(1);
    expect(state.send).toHaveBeenCalledWith('Hi again', expect.objectContaining({ key: expect.any(String) }));
  });

  it('closes the open menu', async () => {
    const r = await open();
    await hold(r);
    expect(r.getByLabelText('Report Message')).toBeTruthy();
    await change(r);
    expect(r.queryByLabelText('Report Message')).toBeNull();
  });

  it('closes the report sheet without sending a report', async () => {
    const r = await open();
    await hold(r);
    await act(async () => { fireEvent.press(r.getByLabelText('Report Message')); });
    expect(r.getByLabelText('Submit report')).toBeTruthy();
    await change(r);
    expect(r.queryByLabelText('Submit report')).toBeNull();
    expect(api.post).not.toHaveBeenCalled();
  });
});

it('FIX-950R1 KT-13: in the gap before the fresh chat opens, no quote is drawn or sent', async () => {
  const r = await open();
  await pickReply(r);
  state = { ...state, messages: [], session: null };
  await act(async () => { romanChatsEvents.emitErased({ id: null }); });
  await rerender(r);
  expect(r.queryByText('Replying to Roman')).toBeNull();
  await fireEvent.changeText(r.getByTestId(INPUT), 'Quick one');
  await act(async () => { fireEvent.press(r.getByTestId('roman-composer-send')); });
  expect(state.send).toHaveBeenCalledWith('Quick one', expect.objectContaining({ key: expect.any(String) }));
});

it('FIX-950R1 KT-13: the same chat re-rendered keeps the quote (no needless drop)', async () => {
  const r = await open();
  await pickReply(r);
  state = { ...state, messages: [...msgs()] };
  await rerender(r);
  expect(r.getByText('Replying to Roman')).toBeTruthy();
});

it('FIX-950R1 LO-950 C1: a send the server stored without a reply drops the quote, keeps the draft; the next send has no quote', async () => {
  state.send = jest.fn(async () => 'stored-no-reply' as const);
  const r = await open();
  await pickReply(r);
  await fireEvent.changeText(r.getByTestId(INPUT), 'Can I do it indoors?');
  await act(async () => { fireEvent.press(r.getByTestId('roman-composer-send')); });
  expect((state.send as jest.Mock).mock.calls[0][0]).toMatch(/^> Keep Thursday easy/);
  expect(r.queryByText('Replying to Roman')).toBeNull();
  expect(r.getByTestId(INPUT).props.value).toBe('Can I do it indoors?');
  await act(async () => { fireEvent.press(r.getByTestId('roman-composer-send')); });
  expect((state.send as jest.Mock).mock.calls[1][0]).toBe('Can I do it indoors?');
});

it('FIX-950R1 KT-13: a send that ends after the chat changed never clears the new chat\'s pick', async () => {
  let finish: (v: 'sent') => void = () => undefined;
  state.send = jest.fn(() => new Promise<'sent'>((res) => { finish = res; }));
  const r = await open();
  await pickReply(r);
  await fireEvent.changeText(r.getByTestId(INPUT), 'First');
  await act(async () => { fireEvent.press(r.getByTestId('roman-composer-send')); });
  state = { ...state, messages: OTHER, session: session('s-other') };
  await rerender(r);
  await hold(r, 'r-9');
  await act(async () => { fireEvent.press(r.getByLabelText('Reply')); });
  await act(async () => { finish('sent'); });
  expect(r.getByText('Replying to Roman')).toBeTruthy();
  // The new pick's words: once in the chat, once in the quote over the composer.
  expect(r.getAllByText('Friday is a rest day.')).toHaveLength(2);
});

it('FIX-950R1 KT-13: in the chat that comes next, hold, Reply and Report work as before', async () => {
  api.post.mockResolvedValueOnce({ data: { reportId: 'rep-9', status: 'received' } });
  const r = await open();
  await pickReply(r);
  state = { ...state, messages: OTHER, session: session('s-other') };
  await rerender(r);
  await hold(r, 'r-9');
  await act(async () => { fireEvent.press(r.getByLabelText('Reply')); });
  expect(r.getByText('Replying to Roman')).toBeTruthy();
  await fireEvent.changeText(r.getByTestId(INPUT), 'And Saturday?');
  await act(async () => { fireEvent.press(r.getByTestId('roman-composer-send')); });
  expect(state.send).toHaveBeenCalledWith('> Friday is a rest day.\n\nAnd Saturday?', expect.objectContaining({ key: expect.any(String) }));
  await hold(r, 'r-9');
  await act(async () => { fireEvent.press(r.getByLabelText('Report Message')); });
  await act(async () => { fireEvent.press(r.getByLabelText('Spam')); });
  await act(async () => { fireEvent.press(r.getByLabelText('Submit report')); });
  expect(api.post).toHaveBeenCalledWith('/roman/messages/r-9/report', { reason: 'spam', details: undefined });
});
