/**
 * One past conversation with Roman: read only, with Delete.
 * Reads the transcript (oldest first, earlier pages on request), deletes it
 * with the permanent-delete confirm, tells the list it is gone, says when
 * reading is switched off (uncoded 404) while still offering Delete, and is
 * bound to the account that opened it.
 */
import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import RomanConversationScreen from '../RomanConversationScreen';
import { chatDateLabel, chatIdentity, failureView, ROMAN_CHATS_COPY } from '../romanChatsCopy';
import { romanChatsEvents } from '../romanChatsEvents';
import { authEvents } from '../../../utils/authEvents';
import { authEpoch } from '../../../services/accountBinding';
import { captureError } from '../../../services/sentry';
import type { RomanChatsApi, RomanChatsFailure, RomanTranscriptPage } from '../../../api/romanChatsApi';
import type { RomanMessage } from '../../../api/romanApi';

jest.mock('../../../services/api', () => ({ __esModule: true, default: {} }));
jest.mock('../../../utils/haptics', () => ({ lightTap: jest.fn(), mediumTap: jest.fn(), warningTap: jest.fn(), selectionTap: jest.fn() }));
jest.mock('../../../utils/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn(), log: jest.fn() } }));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#123456' }) }),
}));
jest.mock('expo-font', () => ({ isLoaded: () => true, loadAsync: jest.fn() }));
jest.mock('../../../services/sentry', () => ({ captureError: jest.fn(), setSentryUser: jest.fn() }));

const msg = (id: string, role: RomanMessage['role'], content: string): RomanMessage => ({
  id,
  role,
  content,
  interrupted: false,
  createdAt: '2026-10-01T08:00:00.000Z',
});
const pageOf = (messages: RomanMessage[], nextCursor: string | null = null) => ({
  ok: true as const,
  value: { messages, nextCursor } as RomanTranscriptPage,
});
const fail = (failure: RomanChatsFailure) => ({ ok: false as const, failure });

function makeApi(over: Partial<Record<keyof RomanChatsApi, jest.Mock>> = {}): Record<keyof RomanChatsApi, jest.Mock> {
  return {
    list: jest.fn(),
    // Newest first, as the server sends them.
    readMessages: jest.fn(async () => pageOf([msg('m2', 'assistant', 'Here is your plan.'), msg('m1', 'user', 'Hello')])),
    deleteOne: jest.fn(async () => ({ ok: true as const, value: null })),
    deleteAll: jest.fn(),
    ...over,
  };
}

let signedIn: string | null = 'user-a';
const navigation = { goBack: jest.fn(), navigate: jest.fn() };
/** Opened from a list loaded for user-a in the current sign-in. */
const paramsNow = () => ({
  id: 'cx1',
  ownerId: 'user-a',
  binding: { subject: 'sub:user-a', epoch: authEpoch() },
  startedAt: '2026-10-01T08:00:00.000Z',
  surface: 'client' as const,
  messageCount: 2,
});
const BA = expect.objectContaining({ subject: 'sub:user-a' });
const renderScreen = (api: RomanChatsApi, params = paramsNow()) =>
  render(<RomanConversationScreen navigation={navigation as never} route={{ params }} api={api} sessionUserId={() => signedIn} />);

let gone: jest.Mock;
let off: () => void;
beforeEach(() => {
  signedIn = 'user-a';
  jest.clearAllMocks();
  gone = jest.fn();
  off = romanChatsEvents.onGone(gone);
});
afterEach(() => off());

it('shows the transcript oldest first, read only', async () => {
  const api = makeApi();
  const screen = await renderScreen(api);
  const items = await screen.findAllByTestId(/^roman-transcript-message-/);
  expect(items.map((i) => i.props.testID)).toEqual(['roman-transcript-message-m1', 'roman-transcript-message-m2']);
  expect(screen.getByText(ROMAN_CHATS_COPY.readOnlyNote)).toBeTruthy();
  expect(api.readMessages).toHaveBeenCalledWith(BA, 'cx1', {});
});

it('loads earlier messages with the cursor and puts them on top', async () => {
  const api = makeApi({
    readMessages: jest
      .fn()
      .mockResolvedValueOnce(pageOf([msg('m3', 'user', 'Later')], 'm3'))
      .mockResolvedValueOnce(pageOf([msg('m2', 'assistant', 'Earlier'), msg('m1', 'user', 'Earliest')])),
  });
  const screen = await renderScreen(api);
  await fireEvent.press(await screen.findByTestId('roman-chat-transcript-earlier'));
  const items = await screen.findAllByTestId(/^roman-transcript-message-/);
  expect(api.readMessages).toHaveBeenLastCalledWith(BA, 'cx1', { cursor: 'm3' });
  expect(items.map((i) => i.props.testID)).toEqual([
    'roman-transcript-message-m1',
    'roman-transcript-message-m2',
    'roman-transcript-message-m3',
  ]);
});

it('Delete: permanent-delete confirm, then tells the list and goes back', async () => {
  const api = makeApi();
  const screen = await renderScreen(api);
  await fireEvent.press(await screen.findByTestId('roman-chat-transcript-delete'));
  expect(screen.getByText(/permanently deletes your conversation with Roman from .* It cannot be undone\./)).toBeTruthy();
  await fireEvent.press(screen.getByTestId('roman-chat-transcript-confirm-confirm'));
  expect(api.deleteOne).toHaveBeenCalledWith(BA, 'cx1');
  expect(gone).toHaveBeenCalledWith({ ownerId: 'user-a', epoch: authEpoch(), id: 'cx1', notice: ROMAN_CHATS_COPY.deletedOne });
  expect(navigation.goBack).toHaveBeenCalled();
});

it('a failed delete stays here with specific copy and a retry', async () => {
  const api = makeApi({
    deleteOne: jest.fn().mockResolvedValueOnce(fail({ reason: 'erase_incomplete' })).mockResolvedValueOnce({ ok: true, value: null }),
  });
  const screen = await renderScreen(api);
  await fireEvent.press(await screen.findByTestId('roman-chat-transcript-delete'));
  await fireEvent.press(screen.getByTestId('roman-chat-transcript-confirm-confirm'));
  expect(await screen.findByText(failureView('delete_one', { reason: 'erase_incomplete' }).message)).toBeTruthy();
  expect(navigation.goBack).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('roman-chat-transcript-notice-retry'));
  expect(api.deleteOne).toHaveBeenCalledTimes(2);
  expect(navigation.goBack).toHaveBeenCalled();
});

it('reading switched off on the server (uncoded 404): says so and still offers Delete', async () => {
  const api = makeApi({ readMessages: jest.fn(async () => fail({ reason: 'route_missing' })) });
  const screen = await renderScreen(api);
  expect(await screen.findByText(failureView('read', { reason: 'route_missing' }).message)).toBeTruthy();
  expect(screen.getByTestId('roman-chat-transcript-delete')).toBeTruthy();
});

it('a chat that no longer exists: Back to your conversations removes it from the list', async () => {
  const api = makeApi({ readMessages: jest.fn(async () => fail({ reason: 'not_found' })) });
  const screen = await renderScreen(api);
  const message = failureView('read', { reason: 'not_found' }).message;
  expect(await screen.findByText(message)).toBeTruthy();
  expect(screen.queryByTestId('roman-chat-transcript-delete')).toBeNull();
  await fireEvent.press(screen.getByTestId('roman-chat-transcript-error-back'));
  expect(gone).toHaveBeenCalledWith({ ownerId: 'user-a', epoch: authEpoch(), id: 'cx1', notice: message });
});

it('offline read: Try again reads again', async () => {
  const api = makeApi({
    readMessages: jest.fn().mockResolvedValueOnce(fail({ reason: 'offline' })).mockResolvedValueOnce(pageOf([msg('m1', 'user', 'Hi')])),
  });
  const screen = await renderScreen(api);
  await fireEvent.press(await screen.findByTestId('roman-chat-transcript-error-retry'));
  expect(await screen.findByTestId('roman-transcript-message-m1')).toBeTruthy();
});

it('opened for another account: reads nothing and shows nothing', async () => {
  signedIn = 'user-b';
  const api = makeApi();
  const screen = await renderScreen(api);
  expect(screen.getByTestId('roman-chat-transcript-other-account')).toBeTruthy();
  expect(api.readMessages).not.toHaveBeenCalled();
});

it('sign-out clears the transcript at once, and no delete is sent afterwards', async () => {
  const api = makeApi();
  const screen = await renderScreen(api);
  await screen.findByTestId('roman-transcript-message-m1');
  signedIn = null;
  await act(async () => authEvents.emit('logout'));
  expect(screen.queryByTestId('roman-transcript-message-m1')).toBeNull();
  expect(screen.queryByText('Hello')).toBeNull();
  expect(screen.queryByTestId('roman-chat-transcript-delete')).toBeNull();
  expect(api.deleteOne).not.toHaveBeenCalled();
});

it('opened under an older sign-in of the same account: reads nothing and shows nothing', async () => {
  const stale = paramsNow();
  await act(async () => authEvents.emit('login'));
  const api = makeApi();
  const screen = await renderScreen(api, stale);
  expect(screen.getByTestId('roman-chat-transcript-other-account')).toBeTruthy();
  expect(screen.getByText(ROMAN_CHATS_COPY.otherAccount)).toBeTruthy();
  expect(api.readMessages).not.toHaveBeenCalled();
});

it('the transcript title, delete label and confirm name the start time, not only the day (B-331-1)', async () => {
  const screen = await renderScreen(makeApi());
  await screen.findByTestId('roman-transcript-message-m1');
  const p = paramsNow();
  expect(screen.getByText(ROMAN_CHATS_COPY.transcriptTitle(chatDateLabel(p)))).toBeTruthy();
  expect(chatDateLabel(p)).toMatch(/ at \d{1,2}:\d{2} (AM|PM)$/);
  await fireEvent.press(screen.getByTestId('roman-chat-transcript-delete'));
  expect(screen.getByText(ROMAN_CHATS_COPY.confirmOneBody(chatIdentity(p)))).toBeTruthy();
  expect(chatIdentity(p)).toContain('(2 messages)');
});

describe('Sol B-331-6: a delete answer never crosses an auth change', () => {
  type Late = { ok: true; value: null } | ReturnType<typeof fail>;
  const lateCases: Array<[string, Late]> = [
    ['success', { ok: true, value: null }],
    ['not found', fail({ reason: 'not_found' })],
    ['failure', fail({ reason: 'unexpected', status: 500, code: null, requestId: 'req-late-1' })],
  ];
  const switches: Array<[string, () => void]> = [
    ['A -> sign out -> B', () => (signedIn = 'user-b')],
    ['A -> sign out -> A again', () => (signedIn = 'user-a')],
  ];

  for (const [switchName, signInAgain] of switches) {
    for (const [lateName, late] of lateCases) {
      it(`${switchName}, late ${lateName}: no state, no list event, no navigation, no report`, async () => {
        let settle!: (v: Late) => void;
        const api = makeApi({ deleteOne: jest.fn(() => new Promise<Late>((r) => (settle = r))) });
        const screen = await renderScreen(api);
        await screen.findByTestId('roman-transcript-message-m1');
        await fireEvent.press(screen.getByTestId('roman-chat-transcript-delete'));
        await fireEvent.press(screen.getByTestId('roman-chat-transcript-confirm-confirm'));
        expect(api.deleteOne).toHaveBeenCalledTimes(1);
        signedIn = null;
        await act(async () => authEvents.emit('logout'));
        signInAgain();
        await act(async () => authEvents.emit('login'));
        expect(screen.getByTestId('roman-chat-transcript-other-account')).toBeTruthy();
        await act(async () => settle(late));
        expect(gone).not.toHaveBeenCalled();
        expect(navigation.goBack).not.toHaveBeenCalled();
        expect(captureError).not.toHaveBeenCalled();
        expect(screen.queryByTestId('roman-chat-transcript-notice')).toBeNull();
        expect(screen.getByTestId('roman-chat-transcript-other-account')).toBeTruthy();
        expect(screen.queryByTestId('roman-chat-transcript-delete')).toBeNull();
      });
    }
  }

  it('an auth change closes an open confirm sheet, so it cannot delete afterwards', async () => {
    const api = makeApi();
    const screen = await renderScreen(api);
    await screen.findByTestId('roman-transcript-message-m1');
    await fireEvent.press(screen.getByTestId('roman-chat-transcript-delete'));
    expect(screen.getByTestId('roman-chat-transcript-confirm-confirm')).toBeTruthy();
    await act(async () => authEvents.emit('login'));
    expect(screen.queryByTestId('roman-chat-transcript-confirm-confirm')).toBeNull();
    expect(api.deleteOne).not.toHaveBeenCalled();
  });
});
