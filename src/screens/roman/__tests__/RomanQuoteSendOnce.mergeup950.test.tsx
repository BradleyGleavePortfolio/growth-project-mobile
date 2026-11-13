/**
 * MERGEUP-950 (agent 203), LO-963R1 N7: m#950's quoted reply meets m#953's send-once key in one sendText.
 * The server's rule (roman.controller.ts:307, backend main 359a85eb): one Idempotency-Key, one content; a key whose
 * first turn had other content is refused (409). So under one key the phone sends one content, and a Send again that
 * may replay a stored turn sends that turn's exact words, quote included.
 * Harness as RomanHoldLifetime.fix950 (the hook mocked, :29; its send, :66), with a send that records
 * (content, { key, keep }) and can call keep() as useRomanChat does (lib/sendOnce.ts failedSendKeepsKey).
 */
import React from 'react';
import { AccessibilityInfo, Alert, Platform } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import type { RomanSendOnce, RomanSendOutcome, UseRomanChatResult } from '../useRomanChat';
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
const { romanChatsEvents } = require('../../settings/romanChatsEvents');
const { ROMAN_STORED_NO_REPLY, ROMAN_SEND_FAILED } = require('../../../components/roman/romanVoice');
const { ROMAN_QUICK_STARTS } = require('../../../components/roman/romanVoice');

const REPLY_A = 'Keep Thursday easy: a 30-minute ride at a pace you could talk through.';
const REPLY_B = 'Saturday can take the hills once your legs are fresh.';
const msgs = (): RomanMessage[] => [
  { id: 'u-1', role: 'user', content: 'Swap my Thursday run for a ride?', interrupted: false, createdAt: '2026-11-06T10:00:00Z' },
  { id: 'r-1', role: 'assistant', content: REPLY_A, interrupted: false, createdAt: '2026-11-06T10:00:05Z' },
  { id: 'u-2', role: 'user', content: 'And the weekend?', interrupted: false, createdAt: '2026-11-06T10:01:00Z' },
  { id: 'r-2', role: 'assistant', content: REPLY_B, interrupted: false, createdAt: '2026-11-06T10:01:05Z' },
];
const session = (id: string, messageCount = 4) => ({
  id, surface: 'client' as const, messageCount, startedAt: '2026-11-06T10:00:00Z', lastActivityAt: '2026-11-06T10:01:05Z',
});

const realOS = Platform.OS;
beforeAll(() => Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'android' }));
afterAll(() => Object.defineProperty(Platform, 'OS', { configurable: true, get: () => realOS }));

/** One answer of the mocked hook: the outcome, and whether the failure keeps the key (keep()). */
type Answer = { outcome: RomanSendOutcome; keep?: boolean };
type Call = { content: string; key: string };
let answers: Answer[] = [];
let calls: Call[] = [];
let state: UseRomanChatResult;
const sendMock = jest.fn(async (content: string, once: RomanSendOnce): Promise<RomanSendOutcome> => {
  calls.push({ content, key: once.key });
  const a = answers.shift() ?? { outcome: 'sent' };
  if (a.keep) once.keep();
  // What useRomanChat shows after each answer: the stored line, the failed line, or nothing.
  state = {
    ...state,
    sendError:
      a.outcome === 'stored-no-reply'
        ? { kind: 'unavailable', message: 'x', turnStored: true }
        : a.outcome === 'send-failed'
          ? { kind: 'offline', message: 'x' }
          : null,
  };
  return a.outcome;
});

beforeEach(() => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  answers = [];
  calls = [];
  sendMock.mockClear();
  state = {
    phase: 'ready', session: session('s-old'), isFirstOpen: false, messages: msgs(),
    sending: false, sendError: null, nextCursor: null, loadingOlder: false,
    reload: jest.fn(), loadOlder: jest.fn(), clearSendError: jest.fn(),
    send: sendMock as unknown as UseRomanChatResult['send'],
  };
  mockUseRomanChat.mockImplementation(() => state);
});
afterEach(() => jest.restoreAllMocks());

const INPUT = 'roman-composer-input';
type R = Awaited<ReturnType<typeof render>>;
const open = async (): Promise<R> => render(<RomanChatScreen surface="client" />);
const rerender = async (r: R) => { await r.rerender(<RomanChatScreen surface="client" />); };
const pick = async (r: R, id = 'r-1') => {
  await act(async () => { fireEvent(r.getByTestId(`roman-message-${id}-reply`), 'longPress'); });
  await act(async () => { fireEvent.press(r.getByLabelText('Reply')); });
  expect(r.getByText('Replying to Roman')).toBeTruthy();
};
const type = async (r: R, text: string) => { await fireEvent.changeText(r.getByTestId(INPUT), text); };
const send = async (r: R) => {
  await act(async () => { fireEvent.press(r.getByTestId('roman-composer-send')); });
  await rerender(r);
};
const sendAgain = async (r: R) => {
  await act(async () => { fireEvent.press(r.getByTestId('roman-send-retry')); });
  await rerender(r);
};
const box = (r: R): string => r.getByTestId(INPUT).props.value;
const quoting = (r: R): boolean => r.queryByText('Replying to Roman') != null;

const WORDS = 'Can I do it indoors?';
const QUOTED_A = `> ${REPLY_A}\n\n${WORDS}`;

/** (d): a quoted send that failed in a way that keeps its key. */
const failedQuoted = async (r: R) => {
  answers = [{ outcome: 'send-failed', keep: true }];
  await pick(r);
  await type(r, WORDS);
  await send(r);
  expect(calls[0].content).toBe(QUOTED_A);
  expect(r.getByText(ROMAN_SEND_FAILED)).toBeTruthy();
};

it('MERGEUP-950 N7 (a): a quoted send stored with no answer yet keeps the quote; Send again sends the same words under the same key', async () => {
  answers = [{ outcome: 'stored-no-reply', keep: true }, { outcome: 'stored-no-reply', keep: true }];
  const r = await open();
  await pick(r);
  await type(r, WORDS);
  await send(r);
  expect(calls[0].content).toBe(QUOTED_A);
  expect(r.getByText(ROMAN_STORED_NO_REPLY)).toBeTruthy();
  expect(quoting(r)).toBe(true);
  expect(box(r)).toBe(WORDS);
  await sendAgain(r);
  expect(calls).toHaveLength(2);
  expect(calls[1]).toEqual(calls[0]);
});

it('MERGEUP-950 N7 (b): when that replay is answered, the quote goes, the box empties, and the next send has a new key', async () => {
  answers = [{ outcome: 'stored-no-reply', keep: true }, { outcome: 'sent' }, { outcome: 'sent' }];
  const r = await open();
  await pick(r);
  await type(r, WORDS);
  await send(r);
  await sendAgain(r);
  expect(quoting(r)).toBe(false);
  expect(box(r)).toBe('');
  await type(r, 'One more thing');
  await send(r);
  expect(calls[2].content).toBe('One more thing');
  expect(calls[2].key).not.toBe(calls[0].key);
});

it('MERGEUP-950 N7 (c): a stored turn whose key is spent drops the quote and keeps the words; Send again has no quote and a new key', async () => {
  answers = [{ outcome: 'stored-no-reply' }, { outcome: 'sent' }];
  const r = await open();
  await pick(r);
  await type(r, WORDS);
  await send(r);
  expect(quoting(r)).toBe(false);
  expect(box(r)).toBe(WORDS);
  await sendAgain(r);
  expect(calls[1].content).toBe(WORDS);
  expect(calls[1].key).not.toBe(calls[0].key);
});

it('MERGEUP-950 N7 (d): a failed quoted send that keeps its key keeps the quote and the words; Send again: same content, same key', async () => {
  answers = [];
  const r = await open();
  await failedQuoted(r);
  expect(quoting(r)).toBe(true);
  expect(box(r)).toBe(WORDS);
  await sendAgain(r);
  expect(calls[1]).toEqual(calls[0]);
});

it('MERGEUP-950 N7 (e): Cancel reply after (d), then Send again: no quote and a new key, never the old key', async () => {
  const r = await open();
  await failedQuoted(r);
  await act(async () => { fireEvent.press(r.getByLabelText('Cancel reply')); });
  expect(quoting(r)).toBe(false);
  await sendAgain(r);
  expect(calls[1].content).toBe(WORDS);
  expect(calls[1].key).not.toBe(calls[0].key);
});

it('MERGEUP-950 N7 (f): another Roman reply picked after (d), same words: a new key', async () => {
  const r = await open();
  await failedQuoted(r);
  await pick(r, 'r-2');
  await sendAgain(r);
  expect(calls[1].content).toBe(`> ${REPLY_B}\n\n${WORDS}`);
  expect(calls[1].key).not.toBe(calls[0].key);
});

it('MERGEUP-950 N7 (g): after (d) and Cancel reply, a chip goes unquoted under its own key; the draft keeps its key', async () => {
  const r = await open();
  await failedQuoted(r);
  await act(async () => { fireEvent.press(r.getByLabelText('Cancel reply')); });
  const chip = ROMAN_QUICK_STARTS[0] as string;
  await act(async () => { fireEvent.press(r.getByText(chip)); });
  await rerender(r);
  expect(calls[1].content).toBe(chip);
  expect(calls[1].key).not.toBe(calls[0].key);
  expect(box(r)).toBe(WORDS);
  // The draft's kept key is unchanged: the same reply picked again replays the first send exactly.
  answers = [{ outcome: 'sent' }];
  await pick(r);
  await send(r);
  expect(calls[2]).toEqual(calls[0]);
});

it('MERGEUP-950 N7 (h): Delete all after (d) on a quoted reply: the next send has no quote and a new key', async () => {
  const r = await open();
  await failedQuoted(r);
  state = { ...state, messages: [], session: null, sendError: null };
  await act(async () => { romanChatsEvents.emitErased({ id: null }); });
  await rerender(r);
  state = { ...state, session: session('s-new', 0) };
  await rerender(r);
  expect(quoting(r)).toBe(false);
  expect(box(r)).toBe(WORDS);
  await send(r);
  expect(calls[1].content).toBe(WORDS);
  expect(calls[1].key).not.toBe(calls[0].key);
});

it('MERGEUP-950 N7 (i): a plain message stored with no answer yet: Send again sends the same content and key (m#953 unchanged)', async () => {
  answers = [{ outcome: 'stored-no-reply', keep: true }, { outcome: 'sent' }];
  const r = await open();
  await type(r, WORDS);
  await send(r);
  expect(r.getByText(ROMAN_STORED_NO_REPLY)).toBeTruthy();
  expect(box(r)).toBe(WORDS);
  await sendAgain(r);
  expect(calls[0].content).toBe(WORDS);
  expect(calls[1]).toEqual(calls[0]);
});
