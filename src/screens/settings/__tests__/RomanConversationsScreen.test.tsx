/**
 * "Your conversations with Roman" (backend #635 list + delete).
 *
 * List (newest first, paged by the backend cursor), open, delete one with a
 * permanent-delete confirm, delete all with a typed confirm, optimistic UI
 * that rolls back on failure, binding to the signed-in account (sign-out and
 * account switch), loading / empty / offline states, accessibility labels,
 * and the copy for every mapped backend failure.
 */
import React from 'react';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import RomanConversationsScreen from '../RomanConversationsScreen';
import { compareChats } from '../useRomanChats';
import { failureView, ROMAN_CHATS_COPY, chatDateLabel, type RomanChatsOp } from '../romanChatsCopy';
import { romanChatsEvents } from '../romanChatsEvents';
import { authEvents } from '../../../utils/authEvents';
import { captureError } from '../../../services/sentry';
import type {
  RomanChatPage,
  RomanChatsApi,
  RomanChatsFailure,
  RomanChatsOutcome,
  RomanChatSummary,
} from '../../../api/romanChatsApi';

jest.mock('../../../services/api', () => ({ __esModule: true, default: {} }));
jest.mock('../../../utils/haptics', () => ({ lightTap: jest.fn(), mediumTap: jest.fn(), warningTap: jest.fn(), selectionTap: jest.fn() }));
jest.mock('../../../utils/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn(), log: jest.fn() } }));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#123456' }) }),
}));
jest.mock('expo-font', () => ({ isLoaded: () => true, loadAsync: jest.fn() }));
jest.mock('../../../services/sentry', () => ({ captureError: jest.fn(), setSentryUser: jest.fn() }));

function chat(id: string, startedAt: string, over: Partial<RomanChatSummary> = {}): RomanChatSummary {
  return {
    id,
    surface: 'client',
    dayKey: startedAt.slice(0, 10),
    messageCount: 4,
    startedAt,
    lastActivityAt: startedAt,
    ...over,
  };
}
const A1 = chat('ca1', '2026-10-02T08:00:00.000Z');
const A2 = chat('ca2', '2026-09-30T08:00:00.000Z', { messageCount: 1 });
const A3 = chat('ca3', '2026-09-20T08:00:00.000Z', { surface: 'coach' });
const B1 = chat('cb1', '2026-10-01T08:00:00.000Z');

const ok = <T,>(value: T): RomanChatsOutcome<T> => ({ ok: true, value });
const fail = (failure: RomanChatsFailure): RomanChatsOutcome<never> => ({ ok: false, failure });
const page = (sessions: RomanChatSummary[], nextCursor: string | null = null): RomanChatsOutcome<RomanChatPage> =>
  ok({ sessions, nextCursor });

/** A promise the test settles by hand. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function makeApi(over: Partial<Record<keyof RomanChatsApi, jest.Mock>> = {}): Record<keyof RomanChatsApi, jest.Mock> {
  return {
    list: jest.fn(async () => page([A1, A2])),
    deleteOne: jest.fn(async () => ok(null)),
    deleteAll: jest.fn(async () => ok(null)),
    readMessages: jest.fn(),
    ...over,
  };
}

let signedIn: string | null = 'user-a';
const sessionUserId = () => signedIn;
const navigation = { goBack: jest.fn(), navigate: jest.fn() };
const renderScreen = (api: RomanChatsApi) =>
  render(<RomanConversationsScreen navigation={navigation as never} api={api} sessionUserId={sessionUserId} />);

beforeEach(() => {
  signedIn = 'user-a';
  jest.clearAllMocks();
});

async function confirmDeleteOne(screen: Awaited<ReturnType<typeof render>>, id: string) {
  await fireEvent.press(screen.getByTestId(`roman-chat-delete-${id}`));
  await fireEvent.press(await screen.findByTestId('roman-chats-confirm-one-confirm'));
}

async function confirmDeleteAll(screen: Awaited<ReturnType<typeof render>>) {
  await fireEvent.press(screen.getByTestId('roman-chats-delete-all'));
  await fireEvent.changeText(await screen.findByTestId('roman-chats-confirm-all-input'), 'delete');
  await fireEvent.press(screen.getByTestId('roman-chats-confirm-all-confirm'));
}

describe('list', () => {
  it('shows a loading state, then every chat newest first with accessible labels', async () => {
    const d = deferred<RomanChatsOutcome<RomanChatPage>>();
    const api = makeApi({ list: jest.fn(() => d.promise) });
    const screen = await renderScreen(api);
    expect(screen.getByTestId('roman-chats-loading').props.accessibilityLabel).toBe(ROMAN_CHATS_COPY.loading);
    await act(async () => d.resolve(page([A1, A2])));
    const rows = screen.getAllByTestId(/^roman-chat-row-/);
    expect(rows.map((r) => r.props.testID)).toEqual(['roman-chat-row-ca1', 'roman-chat-row-ca2']);
    expect(screen.getByTestId('roman-chat-open-ca2').props.accessibilityLabel).toBe(`${chatDateLabel(A2)}. 1 message.`);
    expect(screen.getByTestId('roman-chat-delete-ca1').props.accessibilityLabel).toBe(
      `Delete the conversation from ${chatDateLabel(A1)}`,
    );
    expect(screen.getByText(ROMAN_CHATS_COPY.intro)).toBeTruthy();
    expect(api.list).toHaveBeenCalledWith({});
  });

  it('pages with the backend cursor and labels coach-tool chats', async () => {
    const api = makeApi({
      list: jest
        .fn()
        .mockResolvedValueOnce(page([A1, A2], 'ca2'))
        .mockResolvedValueOnce(page([A3])),
    });
    const screen = await renderScreen(api);
    await fireEvent.press(await screen.findByTestId('roman-chats-load-more'));
    await screen.findByTestId('roman-chat-row-ca3');
    expect(api.list).toHaveBeenLastCalledWith({ cursor: 'ca2' });
    expect(screen.getByText(`4 messages. ${ROMAN_CHATS_COPY.coachTools}`)).toBeTruthy();
    expect(screen.queryByTestId('roman-chats-load-more')).toBeNull();
  });

  it('an out-of-date cursor reloads from the top and says so', async () => {
    const api = makeApi({
      list: jest
        .fn()
        .mockResolvedValueOnce(page([A1], 'ca1'))
        .mockResolvedValueOnce(fail({ reason: 'cursor_invalid' }))
        .mockResolvedValueOnce(page([A1, A2])),
    });
    const screen = await renderScreen(api);
    await fireEvent.press(await screen.findByTestId('roman-chats-load-more'));
    await screen.findByTestId('roman-chat-row-ca2');
    expect(screen.getByText(ROMAN_CHATS_COPY.refreshed)).toBeTruthy();
    expect(api.list).toHaveBeenCalledTimes(3);
    expect(api.list).toHaveBeenLastCalledWith({});
  });

  it('shows the empty state and no Delete all when there are no chats', async () => {
    const screen = await renderScreen(makeApi({ list: jest.fn(async () => page([])) }));
    expect(await screen.findByText(ROMAN_CHATS_COPY.empty)).toBeTruthy();
    expect(screen.queryByTestId('roman-chats-delete-all')).toBeNull();
  });

  it('offline: says what happened, Try again reloads', async () => {
    const api = makeApi({
      list: jest.fn().mockResolvedValueOnce(fail({ reason: 'offline' })).mockResolvedValueOnce(page([A1])),
    });
    const screen = await renderScreen(api);
    expect(await screen.findByText(failureView('load', { reason: 'offline' }).message)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('roman-chats-error-retry'));
    await screen.findByTestId('roman-chat-row-ca1');
    expect(captureError).not.toHaveBeenCalled();
  });

  it('an unknown failure shows a short reference and a support path, and is reported without content', async () => {
    const api = makeApi({
      list: jest.fn(async () => fail({ reason: 'unexpected', status: 500, code: null, requestId: 'abcdef1234567890' })),
    });
    const screen = await renderScreen(api);
    expect(await screen.findByText(/mention reference abcdef12\./)).toBeTruthy();
    expect(screen.getByTestId('roman-chats-error-support')).toBeTruthy();
    expect(captureError).toHaveBeenCalledTimes(1);
    const [, ctx] = (captureError as jest.Mock).mock.calls[0];
    expect(ctx).toEqual({ where: 'roman-chats GET /roman/sessions', status: 500, code: null, request_id: 'abcdef1234567890' });
  });

  it('opening a chat passes the owner so the transcript is bound to this account', async () => {
    const screen = await renderScreen(makeApi());
    await fireEvent.press(await screen.findByTestId('roman-chat-open-ca1'));
    expect(navigation.navigate).toHaveBeenCalledWith('RomanConversation', {
      id: 'ca1',
      ownerId: 'user-a',
      startedAt: A1.startedAt,
      surface: 'client',
      messageCount: 4,
    });
  });
});

describe('delete one', () => {
  it('confirms with permanent-delete copy, removes the row at once, then confirms', async () => {
    const d = deferred<RomanChatsOutcome<null>>();
    const api = makeApi({ deleteOne: jest.fn(() => d.promise) });
    const screen = await renderScreen(api);
    await fireEvent.press(await screen.findByTestId('roman-chat-delete-ca1'));
    expect(screen.getByText(ROMAN_CHATS_COPY.confirmOneBody(chatDateLabel(A1)))).toBeTruthy();
    expect(ROMAN_CHATS_COPY.confirmOneBody('x')).toMatch(/permanently deletes .* cannot be undone\./);
    await fireEvent.press(screen.getByTestId('roman-chats-confirm-one-confirm'));
    expect(screen.queryByTestId('roman-chat-row-ca1')).toBeNull();
    expect(api.deleteOne).toHaveBeenCalledWith('ca1');
    await act(async () => d.resolve(ok(null)));
    expect(screen.getByText(ROMAN_CHATS_COPY.deletedOne)).toBeTruthy();
    expect(screen.queryByTestId('roman-chat-row-ca1')).toBeNull();
  });

  it('Keep it cancels without sending anything', async () => {
    const api = makeApi();
    const screen = await renderScreen(api);
    await fireEvent.press(await screen.findByTestId('roman-chat-delete-ca1'));
    await fireEvent.press(screen.getByTestId('roman-chats-confirm-one-cancel'));
    expect(api.deleteOne).not.toHaveBeenCalled();
    expect(screen.getByTestId('roman-chat-row-ca1')).toBeTruthy();
  });

  it('rolls back to the same place on failure, with specific copy and a working retry', async () => {
    const api = makeApi({
      deleteOne: jest.fn().mockResolvedValueOnce(fail({ reason: 'erase_incomplete' })).mockResolvedValueOnce(ok(null)),
    });
    const screen = await renderScreen(api);
    await confirmDeleteOne(screen, 'ca1');
    expect(await screen.findByText(failureView('delete_one', { reason: 'erase_incomplete' }).message)).toBeTruthy();
    expect(screen.getAllByTestId(/^roman-chat-row-/).map((r) => r.props.testID)).toEqual([
      'roman-chat-row-ca1',
      'roman-chat-row-ca2',
    ]);
    await fireEvent.press(screen.getByTestId('roman-chats-notice-retry'));
    await screen.findByText(ROMAN_CHATS_COPY.deletedOne);
    expect(api.deleteOne).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('roman-chat-row-ca1')).toBeNull();
  });

  it('a 404 (already gone for this account) is a quiet success, not an error', async () => {
    const api = makeApi({ deleteOne: jest.fn(async () => fail({ reason: 'not_found' })) });
    const screen = await renderScreen(api);
    await confirmDeleteOne(screen, 'ca2');
    expect(await screen.findByText(ROMAN_CHATS_COPY.alreadyGone)).toBeTruthy();
    expect(screen.queryByTestId('roman-chat-row-ca2')).toBeNull();
    expect(captureError).not.toHaveBeenCalled();
  });

  it('a chat erased on the transcript screen leaves the list (same account only)', async () => {
    const screen = await renderScreen(makeApi());
    await screen.findByTestId('roman-chat-row-ca1');
    await act(async () => romanChatsEvents.emitGone({ ownerId: 'user-b', id: 'ca1', notice: 'x' }));
    expect(screen.getByTestId('roman-chat-row-ca1')).toBeTruthy();
    await act(async () => romanChatsEvents.emitGone({ ownerId: 'user-a', id: 'ca1', notice: ROMAN_CHATS_COPY.deletedOne }));
    expect(screen.queryByTestId('roman-chat-row-ca1')).toBeNull();
    expect(screen.getByText(ROMAN_CHATS_COPY.deletedOne)).toBeTruthy();
  });
});

describe('delete all', () => {
  it('needs DELETE typed before the button works, then empties the list', async () => {
    const api = makeApi();
    const screen = await renderScreen(api);
    await fireEvent.press(await screen.findByTestId('roman-chats-delete-all'));
    expect(screen.getByText(ROMAN_CHATS_COPY.confirmAllBody)).toBeTruthy();
    const confirm = screen.getByTestId('roman-chats-confirm-all-confirm');
    expect(confirm.props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
    await fireEvent.press(confirm);
    expect(api.deleteAll).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByTestId('roman-chats-confirm-all-input'), 'dele');
    await fireEvent.press(screen.getByTestId('roman-chats-confirm-all-confirm'));
    expect(api.deleteAll).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByTestId('roman-chats-confirm-all-input'), ' delete ');
    await fireEvent.press(screen.getByTestId('roman-chats-confirm-all-confirm'));
    expect(api.deleteAll).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(ROMAN_CHATS_COPY.deletedAll)).toBeTruthy();
    expect(screen.queryAllByTestId(/^roman-chat-row-/)).toHaveLength(0);
    expect(screen.getByText(ROMAN_CHATS_COPY.empty)).toBeTruthy();
  });

  it('offline: rolls the whole list back, with copy that says it may not be deleted', async () => {
    const api = makeApi({ deleteAll: jest.fn(async () => fail({ reason: 'offline' })) });
    const screen = await renderScreen(api);
    await screen.findByTestId('roman-chat-row-ca1');
    await confirmDeleteAll(screen);
    expect(await screen.findByText(failureView('delete_all', { reason: 'offline' }).message)).toBeTruthy();
    expect(screen.getAllByTestId(/^roman-chat-row-/)).toHaveLength(2);
    expect(api.list).toHaveBeenCalledTimes(1);
  });

  it('partial erase (503 ROMAN_ERASE_INCOMPLETE): re-reads the list to show exactly what is left', async () => {
    const api = makeApi({
      list: jest.fn().mockResolvedValueOnce(page([A1, A2])).mockResolvedValueOnce(page([A2])),
      deleteAll: jest.fn(async () => fail({ reason: 'erase_incomplete' })),
    });
    const screen = await renderScreen(api);
    await screen.findByTestId('roman-chat-row-ca1');
    await confirmDeleteAll(screen);
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByTestId('roman-chat-row-ca1')).toBeNull());
    expect(screen.getByTestId('roman-chat-row-ca2')).toBeTruthy();
    expect(screen.getByText(failureView('delete_all', { reason: 'erase_incomplete' }).message)).toBeTruthy();
    expect(screen.getByTestId('roman-chats-notice-retry')).toBeTruthy();
  });
});

describe('bound to the signed-in account', () => {
  it('sign-out clears the list at once; signing in as someone else shows only their chats', async () => {
    const api = makeApi({
      list: jest.fn(async () => (signedIn === 'user-a' ? page([A1, A2]) : page([B1]))),
    });
    const screen = await renderScreen(api);
    await screen.findByTestId('roman-chat-row-ca1');
    signedIn = null;
    await act(async () => authEvents.emit('logout'));
    expect(screen.queryAllByTestId(/^roman-chat-row-/)).toHaveLength(0);
    expect(screen.getByTestId('roman-chats-signed-out')).toBeTruthy();
    signedIn = 'user-b';
    await act(async () => authEvents.emit('login'));
    await screen.findByTestId('roman-chat-row-cb1');
    expect(screen.queryByTestId('roman-chat-row-ca1')).toBeNull();
  });

  it("drops a list answer that arrives after the account changed", async () => {
    const first = deferred<RomanChatsOutcome<RomanChatPage>>();
    const api = makeApi({
      list: jest.fn().mockImplementationOnce(() => first.promise).mockImplementation(async () => page([B1])),
    });
    const screen = await renderScreen(api);
    signedIn = 'user-b';
    await act(async () => authEvents.emit('login'));
    await screen.findByTestId('roman-chat-row-cb1');
    await act(async () => first.resolve(page([A1, A2])));
    expect(screen.queryByTestId('roman-chat-row-ca1')).toBeNull();
    expect(screen.getByTestId('roman-chat-row-cb1')).toBeTruthy();
  });

  it('never sends a delete for a list loaded by another account', async () => {
    const api = makeApi({
      list: jest.fn(async () => (signedIn === 'user-a' ? page([A1, A2]) : page([B1]))),
    });
    const screen = await renderScreen(api);
    await screen.findByTestId('roman-chat-row-ca1');
    // The session changed without an auth event reaching this screen yet.
    signedIn = 'user-b';
    await confirmDeleteOne(screen, 'ca1');
    expect(api.deleteOne).not.toHaveBeenCalled();
    await screen.findByTestId('roman-chat-row-cb1');
    expect(screen.queryByTestId('roman-chat-row-ca1')).toBeNull();
  });

  it('a delete answer for the previous account never touches the new list', async () => {
    const del = deferred<RomanChatsOutcome<null>>();
    const api = makeApi({
      list: jest.fn(async () => (signedIn === 'user-a' ? page([A1, A2]) : page([B1]))),
      deleteOne: jest.fn(() => del.promise),
    });
    const screen = await renderScreen(api);
    await screen.findByTestId('roman-chat-row-ca1');
    await confirmDeleteOne(screen, 'ca1');
    signedIn = 'user-b';
    await act(async () => authEvents.emit('login'));
    await screen.findByTestId('roman-chat-row-cb1');
    await act(async () => del.resolve(fail({ reason: 'erase_incomplete' })));
    expect(screen.queryByTestId('roman-chat-row-ca1')).toBeNull();
    expect(screen.queryByTestId('roman-chats-notice')).toBeNull();
  });
});

describe('copy for every mapped failure', () => {
  const reasons: RomanChatsFailure[] = [
    { reason: 'offline' },
    { reason: 'signed_out' },
    { reason: 'not_allowed', requestId: 'req-1234567890' },
    { reason: 'not_found' },
    { reason: 'route_missing' },
    { reason: 'cursor_invalid' },
    { reason: 'erase_incomplete' },
    { reason: 'busy' },
    { reason: 'unexpected', status: 500, code: null, requestId: 'req-1234567890' },
  ];
  const ops: RomanChatsOp[] = ['load', 'load_more', 'delete_one', 'delete_all', 'read'];

  it.each(ops)('%s: specific, plain copy with a next step; only unknown failures report', (op) => {
    for (const f of reasons) {
      const v = failureView(op, f);
      expect(v.message.length).toBeGreaterThan(20);
      expect(v.message).not.toMatch(/!|Something went wrong|^Please try again\.?$/);
      expect(v.message).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
      expect(v.report).toBe(f.reason === 'unexpected');
      if (f.reason === 'unexpected' || f.reason === 'not_allowed') {
        expect(v.message).toContain('reference req-1234');
        expect(v.action).toBe('retry_support');
      }
    }
  });

  it('delete copy never claims a result the server did not confirm', () => {
    const unknown = { reason: 'unexpected', status: 500, code: null, requestId: null } as const;
    expect(failureView('delete_one', unknown).message).toMatch(/could not confirm/);
    expect(failureView('delete_all', unknown).message).toMatch(/could not confirm/);
    expect(failureView('delete_one', { reason: 'offline' }).message).toMatch(/may not be deleted yet/);
    expect(failureView('delete_all', { reason: 'erase_incomplete' }).message).toMatch(/already deleted stay deleted/);
  });

  it('the screen copy has no exclamation marks', () => {
    for (const v of Object.values(ROMAN_CHATS_COPY)) {
      const text = typeof v === 'function' ? (v as (x: string) => string)('Monday, October 1') : v;
      expect(text).not.toMatch(/!/);
    }
  });
});

it('compareChats orders newest first, then by id', () => {
  expect([A2, A3, A1].sort(compareChats).map((c) => c.id)).toEqual(['ca1', 'ca2', 'ca3']);
  const same = chat('cz', A1.startedAt);
  expect([A1, same].sort(compareChats).map((c) => c.id)).toEqual(['cz', 'ca1']);
});

it('the row exposes list structure for assistive tech', async () => {
  const screen = await renderScreen(makeApi());
  const row = await screen.findByTestId('roman-chat-row-ca1');
  expect(row.props.role).toBe('listitem');
  expect(within(row).getByTestId('roman-chat-open-ca1').props.accessibilityHint).toBe(ROMAN_CHATS_COPY.open);
});
