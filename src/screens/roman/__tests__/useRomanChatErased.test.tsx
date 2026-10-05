/**
 * B-376-1 (Sol 6004856689, Opus 6004927452): the live Roman chat stays
 * mounted under "Your conversations with Roman", which #376 opens from the
 * chat header. When the person erases the chat the live screen holds (Delete
 * on its row, Delete all, or Delete in its transcript), the live screen must
 * drop it: the erased text leaves the screen and the next message goes to a
 * freshly opened chat, never to the erased one (the server answers 404).
 * Adapted from both lens probes (Sol run 37384807869, Opus run 37385259212).
 */
import React from 'react';
import { act, fireEvent, render, renderHook, waitFor } from '@testing-library/react-native';
import RomanConversationsScreen from '../../settings/RomanConversationsScreen';
import RomanConversationScreen from '../../settings/RomanConversationScreen';
import { useRomanChat } from '../useRomanChat';
import { RomanApiError, type RomanMessage } from '../../../api/romanApi';
import { authEpoch, type AccountBinding } from '../../../services/accountBinding';
import { ROMAN_CHATS_COPY } from '../../settings/romanChatsCopy';
import type { RomanChatsApi, RomanChatSummary } from '../../../api/romanChatsApi';

const mockOpen = jest.fn();
const mockList = jest.fn();
const mockSend = jest.fn();

jest.mock('../../../api/romanApi', () => {
  const actual = jest.requireActual('../../../api/romanApi');
  return {
    ...actual,
    openOrResumeSession: (...args: unknown[]) => mockOpen(...args),
    listMessages: (...args: unknown[]) => mockList(...args),
    sendMessage: (...args: unknown[]) => mockSend(...args),
    deleteSession: jest.fn(),
  };
});
jest.mock('../../../services/api', () => ({ __esModule: true, default: {} }));
jest.mock('../../../utils/haptics', () => ({
  lightTap: jest.fn(),
  mediumTap: jest.fn(),
  warningTap: jest.fn(),
  selectionTap: jest.fn(),
}));
jest.mock('../../../utils/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn(), log: jest.fn() },
}));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#123456' }) }),
}));
jest.mock('expo-font', () => ({ isLoaded: () => true, loadAsync: jest.fn() }));
jest.mock('../../../services/sentry', () => ({ captureError: jest.fn(), setSentryUser: jest.fn() }));

const LIVE = 'live-chat-today';
const FRESH = 'fresh-chat-today';
const OLDER = 'older-chat';
const USER = 'user-a';
const MESSAGE: RomanMessage = {
  id: 'm-live-1',
  role: 'user',
  content: 'A private question for Roman',
  interrupted: false,
  createdAt: '2026-10-05T20:00:00.000Z',
};
const summary = (id: string, dayKey: string): RomanChatSummary => ({
  id,
  surface: 'client',
  dayKey,
  messageCount: 1,
  startedAt: `${dayKey}T20:00:00.000Z`,
  lastActivityAt: `${dayKey}T20:00:00.000Z`,
});
const TODAY = summary(LIVE, '2026-10-05');
const YESTERDAY = summary(OLDER, '2026-10-04');
const sessionUserId = () => USER;
const captureBinding = async (): Promise<AccountBinding> => ({ subject: `sub:${USER}`, epoch: authEpoch() });
const navigation = { navigate: jest.fn(), goBack: jest.fn() };

/** Server state: which chats are erased. */
let erased = new Set<string>();

function historyApi(): RomanChatsApi {
  return {
    list: jest.fn(async () => ({
      ok: true as const,
      value: { sessions: [TODAY, YESTERDAY].filter((c) => !erased.has(c.id)), nextCursor: null },
    })),
    deleteOne: jest.fn(async (_binding: AccountBinding, id: string) => {
      erased.add(id);
      return { ok: true as const, value: null };
    }),
    deleteAll: jest.fn(async () => {
      erased = new Set([LIVE, OLDER]);
      return { ok: true as const, value: null };
    }),
    readMessages: jest.fn(async () => ({ ok: true as const, value: { messages: [MESSAGE], nextCursor: null } })),
  } as unknown as RomanChatsApi;
}

beforeEach(() => {
  erased = new Set();
  jest.clearAllMocks();
  // open-or-resume answers today's live chat, or a fresh one once it is erased.
  mockOpen.mockImplementation(async () => ({
    id: erased.has(LIVE) ? FRESH : LIVE,
    surface: 'client',
    messageCount: erased.has(LIVE) ? 0 : 1,
  }));
  mockList.mockImplementation(async (id: string) => {
    if (erased.has(id)) throw new RomanApiError('unavailable', 'Roman is not available right now.');
    return { messages: id === LIVE ? [MESSAGE] : [], nextCursor: null };
  });
  mockSend.mockImplementation(async (id: string) => {
    if (erased.has(id)) throw new RomanApiError('unavailable', 'Roman is not available right now.');
    return { text: 'A reply', messageId: `reply-${id}`, interrupted: false };
  });
});

async function liveChat() {
  const live = await renderHook(() => useRomanChat('client'));
  await waitFor(() => expect(live.result.current.phase).toBe('ready'));
  expect(live.result.current.session?.id).toBe(LIVE);
  expect(live.result.current.messages).toEqual([MESSAGE]);
  return live;
}

async function historyList() {
  const api = historyApi();
  const screen = await render(
    <RomanConversationsScreen
      navigation={navigation as never}
      api={api}
      sessionUserId={sessionUserId}
      captureBinding={captureBinding}
    />,
  );
  await screen.findByTestId(`roman-chat-row-${LIVE}`);
  return screen;
}

async function deleteRow(id: string) {
  const screen = await historyList();
  await fireEvent.press(screen.getByTestId(`roman-chat-delete-${id}`));
  await fireEvent.press(screen.getByTestId('roman-chats-confirm-one-confirm'));
  await screen.findByText(ROMAN_CHATS_COPY.deletedOne);
}

async function erase(operation: 'list-one' | 'list-all' | 'transcript-one') {
  if (operation === 'list-one') return deleteRow(LIVE);
  if (operation === 'list-all') {
    const screen = await historyList();
    await fireEvent.press(screen.getByTestId('roman-chats-delete-all'));
    await fireEvent.changeText(screen.getByTestId('roman-chats-confirm-all-input'), 'DELETE');
    await fireEvent.press(screen.getByTestId('roman-chats-confirm-all-confirm'));
    await screen.findByText(ROMAN_CHATS_COPY.deletedAll);
    return;
  }
  const binding = await captureBinding();
  const transcript = await render(
    <RomanConversationScreen
      navigation={navigation as never}
      route={{ params: { ...TODAY, ownerId: USER, binding } }}
      api={historyApi()}
      sessionUserId={sessionUserId}
    />,
  );
  await fireEvent.press(await transcript.findByTestId('roman-chat-transcript-delete'));
  await fireEvent.press(transcript.getByTestId('roman-chat-transcript-confirm-confirm'));
  await waitFor(() => expect(navigation.goBack).toHaveBeenCalledTimes(1));
}

it('control: an ordinary send before any delete goes to the live chat', async () => {
  const live = await liveChat();
  let outcome: string | undefined;
  await act(async () => {
    outcome = await live.result.current.send('Normal message');
  });
  expect(outcome).toBe('sent');
  expect(mockSend).toHaveBeenCalledWith(LIVE, 'Normal message');
});

it.each(['list-one', 'list-all', 'transcript-one'] as const)(
  '%s: erasing the open chat clears it from the live screen and the next send goes to a fresh chat',
  async (operation) => {
    const live = await liveChat();
    await erase(operation);
    expect(erased.has(LIVE)).toBe(true);

    // The erased text is gone from the live screen, which now holds a fresh chat.
    await waitFor(() => expect(live.result.current.session?.id).toBe(FRESH));
    expect(live.result.current.phase).toBe('ready');
    expect(live.result.current.messages.some((m) => m.id === MESSAGE.id)).toBe(false);

    let outcome: string | undefined;
    await act(async () => {
      outcome = await live.result.current.send('Start fresh');
    });
    expect(outcome).toBe('sent');
    expect(mockSend).toHaveBeenLastCalledWith(FRESH, 'Start fresh');
    expect(mockSend).not.toHaveBeenCalledWith(LIVE, expect.anything());
  },
);

it('a send right after the erase waits for the fresh chat instead of the erased one', async () => {
  const live = await liveChat();
  await deleteRow(LIVE);
  let outcome: string | undefined;
  await act(async () => {
    outcome = await live.result.current.send('Straight away');
  });
  expect(outcome).toBe('sent');
  expect(mockSend).toHaveBeenLastCalledWith(FRESH, 'Straight away');
});

it('control: deleting another chat leaves the live chat as it is', async () => {
  const live = await liveChat();
  await deleteRow(OLDER);
  expect(mockOpen).toHaveBeenCalledTimes(1);
  expect(live.result.current.session?.id).toBe(LIVE);
  expect(live.result.current.messages).toEqual([MESSAGE]);
  let outcome: string | undefined;
  await act(async () => {
    outcome = await live.result.current.send('Still here');
  });
  expect(outcome).toBe('sent');
  expect(mockSend).toHaveBeenLastCalledWith(LIVE, 'Still here');
});
