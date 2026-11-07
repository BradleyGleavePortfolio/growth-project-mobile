/**
 * ROMAN-HOLD-M (owner #197-D3, phone half of backend #1223): pressing and holding one of Roman's
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

describe.each(['client'] as const)('%s: hold a Roman reply', (surface) => {
  beforeEach(() => {
    mockUser = { id: 'client-1', firstName: 'Maya' };
  });

  it('opens the people\'s chat menu with Reply, Copy and Report Message', async () => {
    const r = await open(surface);
    expect(r.queryByLabelText('Report Message')).toBeNull();
    await hold(r);
    expect(r.getByLabelText('Reply')).toBeTruthy();
    expect(r.getByLabelText('Copy')).toBeTruthy();
    expect(r.getByLabelText('Report Message')).toBeTruthy();
    expect(r.getByText('Cancel')).toBeTruthy();
  });

  it('Reply quotes the reply into the next message to Roman, then the quote goes with the send', async () => {
    const r = await open(surface);
    await hold(r);
    await act(async () => { fireEvent.press(r.getByLabelText('Reply')); });
    expect(r.getByText('Replying to Roman')).toBeTruthy();
    expect(r.queryByTestId('roman-quick-starts')).toBeNull();
    await fireEvent.changeText(r.getByTestId(INPUT), 'Can I do it indoors?');
    await act(async () => { fireEvent.press(r.getByTestId('roman-composer-send')); });
    const excerpt = ROMAN_REPLY.replace(/\*\*/g, '');
    expect(state.send).toHaveBeenCalledWith(`> ${excerpt}\n\nCan I do it indoors?`);
    expect(r.queryByText('Replying to Roman')).toBeNull();
    expect(r.getByTestId(INPUT).props.value).toBe('');
  });

  it('a failed reply send keeps the quote and the text; Cancel reply drops the quote only', async () => {
    state.send = jest.fn(async () => 'send-failed' as const);
    const r = await open(surface);
    await hold(r);
    await act(async () => { fireEvent.press(r.getByLabelText('Reply')); });
    await fireEvent.changeText(r.getByTestId(INPUT), 'Can I do it indoors?');
    await act(async () => { fireEvent.press(r.getByTestId('roman-composer-send')); });
    expect(r.getByText('Replying to Roman')).toBeTruthy();
    expect(r.getByTestId(INPUT).props.value).toBe('Can I do it indoors?');
    state.send = jest.fn(async () => 'sent' as const); // read on the next render (Cancel reply)
    await act(async () => { fireEvent.press(r.getByLabelText('Cancel reply')); });
    expect(r.queryByText('Replying to Roman')).toBeNull();
    await act(async () => { fireEvent.press(r.getByTestId('roman-composer-send')); });
    expect(state.send).toHaveBeenCalledWith('Can I do it indoors?');
  });

  it('Report sends the reply id and reason, then says it was submitted', async () => {
    api.post.mockResolvedValueOnce({ data: { reportId: 'rep-1', status: 'received' } });
    const r = await open(surface);
    await hold(r);
    await act(async () => { fireEvent.press(r.getByLabelText('Report Message')); });
    await act(async () => { fireEvent.press(r.getByLabelText('Misinformation')); });
    await act(async () => { fireEvent.press(r.getByLabelText('Submit report')); });
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/roman/messages/r-1/report', { reason: 'other', details: 'Misinformation.' });
    expect(Alert.alert).toHaveBeenCalledWith('Reported', 'Your report has been submitted.');
  });
});

it('a report that fails offline says so, keeps the pick, and Submit Report sends it again', async () => {
  api.post.mockRejectedValueOnce(Object.assign(new Error('Network Error'), { isAxiosError: true, code: 'ERR_NETWORK' }));
  api.post.mockResolvedValueOnce({ data: { reportId: 'rep-1', status: 'already_reported' } });
  const r = await open();
  await hold(r);
  await act(async () => { fireEvent.press(r.getByLabelText('Report Message')); });
  await act(async () => { fireEvent.press(r.getByLabelText('Spam')); });
  await act(async () => { fireEvent.press(r.getByLabelText('Submit report')); });
  expect(r.getByText('Sending your report could not be confirmed. Check your connection, then try again.')).toBeTruthy();
  // KT-11: the line is announced (and scrolled into view) rather than left below the fold.
  expect(r.getByTestId('report-sheet-error').props.accessibilityRole).toBe('alert');
  expect(Alert.alert).not.toHaveBeenCalled();
  await act(async () => { fireEvent.press(r.getByLabelText('Submit report')); });
  expect(api.post).toHaveBeenCalledTimes(2);
  expect(api.post.mock.calls[1]).toEqual(['/roman/messages/r-1/report', { reason: 'spam', details: undefined }]);
  await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('Reported', 'Your report has been submitted.'));
});

it('Copy puts Roman\'s words on the clipboard', async () => {
  const r = await open();
  await hold(r);
  await act(async () => { fireEvent.press(r.getByLabelText('Copy')); });
  expect(Clipboard.setStringAsync).toHaveBeenCalledWith(ROMAN_REPLY);
  expect(r.queryByLabelText('Report Message')).toBeNull();
});

it('a reply still on its way (no server id yet) can be quoted or copied but not reported', async () => {
  state.messages = [...msgs().slice(0, 1), { ...msgs()[1], id: 'assistant-1730887205000' }];
  const r = await open();
  await hold(r, 'assistant-1730887205000');
  expect(r.getByLabelText('Reply')).toBeTruthy();
  expect(r.queryByLabelText('Report Message')).toBeNull();
});

it('holding the person\'s own message does nothing; a screen reader reaches the menu by its long-press action', async () => {
  const r = await open();
  expect(r.queryByTestId('roman-message-u-1-reply')).toBeNull();
  const reply = r.getByTestId('roman-message-r-1-reply');
  expect(reply.props.accessibilityHint).toBe('Long press for message actions.');
  await act(async () => { fireEvent(reply, 'accessibilityAction', { nativeEvent: { actionName: 'longpress' } }); });
  expect(r.getByLabelText('Report Message')).toBeTruthy();
});

it('a sent reply shows its quote as a strip, not as "> " text', async () => {
  state.messages = [
    ...msgs(),
    { id: 'u-2', role: 'user', content: '> Keep Thursday easy\n\nCan I do it indoors?', interrupted: false, createdAt: '2026-11-06T10:01:00Z' },
  ];
  const r = await open();
  expect(r.getByLabelText('Replying to: Keep Thursday easy')).toBeTruthy();
  expect(r.getByLabelText('You said: Can I do it indoors?')).toBeTruthy();
  expect(r.queryByText(/^> /)).toBeNull();
});

it('the coach\'s own Roman room is unchanged: holding a reply opens no menu', async () => {
  mockUser = { id: 'coach-1', firstName: 'Jordan' };
  const r = await open('coach');
  const reply = r.getByTestId('roman-message-r-1-reply');
  expect(reply.props.accessibilityHint).toBeUndefined();
  await hold(r);
  expect(r.queryByLabelText('Report Message')).toBeNull();
  expect(r.queryByLabelText('Reply')).toBeNull();
  expect(api.post).not.toHaveBeenCalled();
  mockUser = { id: 'client-1', firstName: 'Maya' };
});

// B-TEST LS-950 B1: history is pushed over the live room. A successful
// Delete, Delete all, or transcript-gone event replaces its session/messages,
// but the new reply selection must not survive that source-chat boundary.
const selectThenEraseSource = async (r: R) => {
  await hold(r);
  await act(async () => { fireEvent.press(r.getByLabelText('Reply')); });
  expect(r.getByText('Replying to Roman')).toBeTruthy();
  state = {
    ...state,
    session: {
      id: 'fresh-session', surface: 'client', messageCount: 0,
      startedAt: '2026-11-06T10:02:00Z', lastActivityAt: '2026-11-06T10:02:00Z',
    },
    messages: [],
  };
  await r.rerender(<RomanChatScreen />);
};

const sourceSession = () => ({
  id: 'source-session', surface: 'client' as const, messageCount: 2,
  startedAt: '2026-11-06T10:00:00Z', lastActivityAt: '2026-11-06T10:00:05Z',
});

it('B-TEST LS-950 B1: erasing the source chat removes its selected reply words from the fresh chat', async () => {
  state.session = sourceSession();
  const r = await open();
  await selectThenEraseSource(r);
  expect(r.queryByText('Replying to Roman')).toBeNull();
});

it('B-TEST LS-950 B1: the next send after erasing the source chat contains no erased quote', async () => {
  state.session = sourceSession();
  const r = await open();
  await selectThenEraseSource(r);
  await fireEvent.changeText(r.getByTestId(INPUT), 'A fresh question');
  await act(async () => { fireEvent.press(r.getByTestId('roman-composer-send')); });
  expect(state.send).toHaveBeenCalledWith('A fresh question');
});
