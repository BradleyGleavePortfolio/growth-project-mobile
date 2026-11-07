/**
 * FIX-950R2 (agent 202) for m#950: KT-13 LIFETIME of the iOS native menu (LS-950R2 B1, class-first),
 * through the real RomanChatScreen and the real MessageActionSheet with Platform.OS 'ios'.
 * ActionSheetIOS keeps the choice callback outside React, so each test holds on to it as the
 * native side does and fires it after the event. Every way the menu's chat or sign-in ends:
 * the menu is dismissed, and its old Reply, Copy and Report run nothing. Same-chat controls:
 * Reply, Copy and Report still do what they did. Also LS-950R2 C3 (a late report answer) and
 * LO-950R2 N3 (the report sheet's pick) stay with their chat.
 */
import React from 'react';
import { AccessibilityInfo, ActionSheetIOS, Alert, Platform } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import type { UseRomanChatResult } from '../useRomanChat';
import type { RomanMessage } from '../../../api/romanApi';

jest.mock('../../../storage/mmkv', () => ({
  ...jest.requireActual('../../../storage/mmkv'),
  cacheStorage: {
    getString: () => undefined, getStringAsync: async () => undefined,
    set: async () => undefined, delete: async () => undefined, getAllKeys: async () => [],
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
const api = require('../../../services/api').default as { post: jest.Mock };
const Clipboard = require('expo-clipboard') as { setStringAsync: jest.Mock };
const { romanChatsEvents } = require('../../settings/romanChatsEvents');
const { authEvents } = require('../../../utils/authEvents');

const REPLY = 'Keep Thursday easy: a 30-minute ride at a pace you could talk through.';
const msgs = (): RomanMessage[] => [
  { id: 'u-1', role: 'user', content: 'Swap my Thursday run for a ride?', interrupted: false, createdAt: '2026-11-06T10:00:00Z' },
  { id: 'r-1', role: 'assistant', content: REPLY, interrupted: false, createdAt: '2026-11-06T10:00:05Z' },
];
const OTHER: RomanMessage[] = [
  { id: 'u-9', role: 'user', content: 'What about Friday?', interrupted: false, createdAt: '2026-11-05T09:00:00Z' },
  { id: 'r-9', role: 'assistant', content: 'Friday is a rest day.', interrupted: false, createdAt: '2026-11-05T09:00:05Z' },
];
const session = (id: string, messageCount = 2) => ({
  id, surface: 'client' as const, messageCount, startedAt: '2026-11-06T10:00:00Z', lastActivityAt: '2026-11-06T10:00:05Z',
});

const realOS = Platform.OS;
beforeAll(() => Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'ios' }));
afterAll(() => Object.defineProperty(Platform, 'OS', { configurable: true, get: () => realOS }));

type Shown = { options: string[]; choose: (index: number) => void };
let shown: Shown[];
let dismiss: jest.SpyInstance;
let state: UseRomanChatResult;
beforeEach(() => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  shown = [];
  jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation((o, cb) => {
    shown.push({ options: o.options as string[], choose: cb });
  });
  dismiss = jest.spyOn(ActionSheetIOS, 'dismissActionSheet').mockImplementation(() => undefined);
  api.post.mockReset();
  Clipboard.setStringAsync.mockClear();
  state = {
    phase: 'ready', session: session('s-old'), isFirstOpen: false, messages: msgs(),
    sending: false, sendError: null, nextCursor: null, loadingOlder: false,
    reload: jest.fn(), loadOlder: jest.fn(), clearSendError: jest.fn(),
    send: jest.fn(async () => 'sent' as const),
  };
  mockUseRomanChat.mockImplementation(() => state);
});
afterEach(() => jest.restoreAllMocks());

type R = Awaited<ReturnType<typeof render>>;
const INPUT = 'roman-composer-input';
const open = () => render(<RomanChatScreen surface="client" />);
const rerender = async (r: R) => { await r.rerender(<RomanChatScreen surface="client" />); };
const hold = async (r: R, id = 'r-1') => {
  await act(async () => { fireEvent(r.getByTestId(`roman-message-${id}-reply`), 'longPress'); });
  return shown[shown.length - 1];
};
const choose = async (menu: Shown, label: string) => {
  const i = menu.options.indexOf(label);
  expect(i).toBeGreaterThanOrEqual(0);
  await act(async () => { menu.choose(i); });
};
const dropThenFresh = async (r: R, fire: () => void) => {
  state = { ...state, messages: [], session: null };
  await act(async () => { fire(); });
  await rerender(r);
  state = { ...state, session: session('s-new', 0) };
  await rerender(r);
};

// Every way the menu's chat, screen or sign-in ends (the FIX-950R1 table, plus unmount and the sign-in rows).
const EVENTS: Array<[string, (r: R) => Promise<void>]> = [
  ['Delete on this chat', (r) => dropThenFresh(r, () => romanChatsEvents.emitErased({ id: 's-old' }))],
  ['Delete all', (r) => dropThenFresh(r, () => romanChatsEvents.emitErased({ id: null }))],
  ['the chat is gone', (r) => dropThenFresh(r, () => romanChatsEvents.emitGone({ ownerId: 'client-1', epoch: 0, id: 's-old' }))],
  ['a fresh chat opens', async (r) => { state = { ...state, messages: [], session: session('s-new', 0) }; await rerender(r); }],
  ['another chat from history', async (r) => { state = { ...state, messages: OTHER, session: session('s-other') }; await rerender(r); }],
  ['the screen unmounts', async (r) => { await r.unmount(); }],
  // services/authActions.ts signOut and the refresh failure in services/api.ts both end in authEvents.emit('logout').
  ['sign-out or session expiry', async (r) => { await act(async () => { authEvents.emit('logout'); }); await rerender(r); }],
  ['another sign-in', async (r) => { await act(async () => { authEvents.emit('login'); }); await rerender(r); }],
];

describe.each(EVENTS)('FIX-950R2 KT-13 (iOS native menu): %s', (name, end) => {
  it.each(['Reply', 'Copy', 'Report Message'])('dismisses the menu, and its old %s runs nothing', async (label) => {
    const r = await open();
    const menu = await hold(r);
    expect(menu.options).toEqual(['Reply', 'Copy', 'Report Message', 'Cancel']);
    await end(r);
    expect(dismiss).toHaveBeenCalledTimes(1);
    await choose(menu, label);
    expect(Clipboard.setStringAsync).not.toHaveBeenCalled();
    if (name !== 'the screen unmounts') {
      expect(r.queryByText('Replying to Roman')).toBeNull();
      expect(r.queryByLabelText('Submit report')).toBeNull();
      await fireEvent.changeText(r.getByTestId(INPUT), 'Next one');
      await act(async () => { fireEvent.press(r.getByTestId('roman-composer-send')); });
      expect(state.send).toHaveBeenCalledWith('Next one');
    }
  });
});

describe('FIX-950R2 same chat on iOS (positive controls)', () => {
  it('Reply quotes the held reply, and the next send carries it', async () => {
    const r = await open();
    await choose(await hold(r), 'Reply');
    expect(r.getByText('Replying to Roman')).toBeTruthy();
    await fireEvent.changeText(r.getByTestId(INPUT), 'Indoors?');
    await act(async () => { fireEvent.press(r.getByTestId('roman-composer-send')); });
    expect((state.send as jest.Mock).mock.calls[0][0]).toBe(`> ${REPLY}\n\nIndoors?`);
    expect(dismiss).not.toHaveBeenCalled();
  });

  it('Copy copies the held reply', async () => {
    const r = await open();
    await choose(await hold(r), 'Copy');
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith(REPLY);
    expect(dismiss).not.toHaveBeenCalled();
  });

  it('Report opens the sheet for the held reply and files it', async () => {
    api.post.mockResolvedValueOnce({ data: { reportId: 'rep-1', status: 'received' } });
    const r = await open();
    await choose(await hold(r), 'Report Message');
    await act(async () => { fireEvent.press(r.getByLabelText('Spam')); });
    await act(async () => { fireEvent.press(r.getByLabelText('Submit report')); });
    expect(api.post).toHaveBeenCalledWith('/roman/messages/r-1/report', { reason: 'spam', details: undefined });
    expect(Alert.alert).toHaveBeenCalledWith('Reported', 'Your report has been submitted.');
    expect(dismiss).not.toHaveBeenCalled();
  });

  it('Cancel closes it and runs nothing; the same chat re-rendered keeps an open menu working', async () => {
    const r = await open();
    await choose(await hold(r), 'Cancel');
    expect(Clipboard.setStringAsync).not.toHaveBeenCalled();
    const menu = await hold(r);
    state = { ...state, messages: [...msgs()] };
    await rerender(r);
    expect(dismiss).not.toHaveBeenCalled();
    await choose(menu, 'Copy');
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith(REPLY);
    expect(shown).toHaveLength(2);
  });
});

it('FIX-950R2 LS-950R2 C3: a report answer that comes after the chat changed closes nothing and shows no alert', async () => {
  let answer: (v: unknown) => void = () => undefined;
  api.post.mockImplementationOnce(() => new Promise((res) => { answer = res; }));
  const r = await open();
  await choose(await hold(r), 'Report Message');
  await act(async () => { fireEvent.press(r.getByLabelText('Spam')); });
  await act(async () => { fireEvent.press(r.getByLabelText('Submit report')); });
  state = { ...state, messages: OTHER, session: session('s-other') };
  await rerender(r);
  await choose(await hold(r, 'r-9'), 'Report Message');
  await act(async () => { answer({ data: { reportId: 'rep-1', status: 'received' } }); });
  expect(Alert.alert).not.toHaveBeenCalledWith('Reported', expect.anything());
  expect(r.getByLabelText('Submit report')).toBeTruthy();
});

it('FIX-950R2 LO-950R2 N3: after a chat change the next report sheet starts with no reason picked', async () => {
  const r = await open();
  await choose(await hold(r), 'Report Message');
  await act(async () => { fireEvent.press(r.getByLabelText('Spam')); });
  expect(r.getByLabelText('Spam').props.accessibilityState).toMatchObject({ selected: true });
  state = { ...state, messages: OTHER, session: session('s-other') };
  await rerender(r);
  await choose(await hold(r, 'r-9'), 'Report Message');
  expect(r.getByLabelText('Spam').props.accessibilityState).toMatchObject({ selected: false });
});
