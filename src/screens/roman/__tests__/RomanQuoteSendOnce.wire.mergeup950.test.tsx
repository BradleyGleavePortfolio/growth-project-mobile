/**
 * MERGEUP-950C (agent 203), LO-963R1 N7 case (a) at the wire: the real RomanChatScreen, the real useRomanChat and the
 * real sendMessage; only `fetch` (the send) and the session reads are stubbed (harness from RomanSendOnce.test.tsx,
 * m#953). A quoted reply whose answer is not ready yet (the server's ROMAN_REPLY_PENDING frame after the 200: the turn
 * is stored and the key is kept) keeps "Replying to Roman" over the kept words, and Send again sends the same content
 * under the same Idempotency-Key, so the server replays that stored turn instead of refusing a key reused with other
 * content (409, roman.controller.ts:307, backend main 359a85eb). Android menu (Reply is a row in the sheet).
 */
import React from 'react';
import { AccessibilityInfo, Platform } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockDisk = new Map<string, string>();
jest.mock('../../../storage/mmkv', () => ({
  ...jest.requireActual('../../../storage/mmkv'),
  cacheStorage: {
    getString: () => undefined,
    getStringAsync: async (k: string) => mockDisk.get(k),
    set: async (k: string, v: string) => { mockDisk.set(k, v); },
    delete: async (k: string) => { mockDisk.delete(k); },
    getAllKeys: async () => [...mockDisk.keys()],
  },
}));
jest.mock('../../../services/secureStorage', () => ({ secureStorage: { getItem: jest.fn(async () => 'test-token') } }));
jest.mock('../../../services/api', () => ({ __esModule: true, default: {} }));
jest.mock('../../../services/accountBinding', () => ({
  ...jest.requireActual('../../../services/accountBinding'),
  captureAccountBinding: async () => null,
}));
const mockList = jest.fn();
jest.mock('../../../api/romanApi', () => ({
  ...jest.requireActual('../../../api/romanApi'),
  openOrResumeSession: async () => ({ id: 'sess-1', surface: 'client', messageCount: 2 }),
  listMessages: (...a: unknown[]) => mockList(...a),
  deleteSession: jest.fn(),
}));
jest.mock('../../../utils/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('../../../services/sentry', () => ({ captureError: jest.fn(), setSentryUser: jest.fn() }));
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
const { authEvents } = require('../../../utils/authEvents');
const { ROMAN_STORED_NO_REPLY } = require('../../../components/roman/romanVoice');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
type Wire = { throws: Error } | { status: number; text?: string | Error };
const DONE = (text: string) => `data: {"type":"delta","text":"${text}"}\n\ndata: {"type":"done","text":"${text}","messageId":"m-reply-1","interrupted":false}\n\n`;
// The frame RomanSendOnce.test.tsx's FIX-953R3 cases use (CONTRACT 6754738036): the turn is stored, the reply is not
// ready yet, and the key stays with the words.
const REPLY_PENDING_FRAME: Wire = {
  status: 200,
  text: 'event: error\ndata: {"code":"ROMAN_REPLY_PENDING","message":"Roman is not available right now."}\n\n',
};
const OK: Wire = { status: 200, text: DONE('Yes, the trainer works.') };

const REPLY = 'Keep Thursday easy: a 30-minute ride at a pace you could talk through.';
const WORDS = 'Can I do it indoors?';
const QUOTED = `> ${REPLY}\n\n${WORDS}`;
// The server's page is newest first; useRomanChat turns it around.
const PAGE = {
  messages: [
    { id: 'r-1', role: 'assistant', content: REPLY, interrupted: false, createdAt: '2026-11-06T10:00:05Z' },
    { id: 'u-1', role: 'user', content: 'Swap my Thursday run for a ride?', interrupted: false, createdAt: '2026-11-06T10:00:00Z' },
  ],
  nextCursor: null,
};

const realOS = Platform.OS;
beforeAll(() => Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'android' }));
afterAll(() => Object.defineProperty(Platform, 'OS', { configurable: true, get: () => realOS }));

const realFetch = global.fetch;
let wire: Wire[] = [];
const fetchMock = jest.fn(async (_url: string, _init: RequestInit) => {
  const next = wire.shift() ?? OK;
  if ('throws' in next) throw next.throws;
  const body = next.text;
  return {
    ok: next.status >= 200 && next.status < 300,
    status: next.status,
    headers: { get: () => null },
    text: async () => { if (body instanceof Error) throw body; return body ?? ''; },
  } as unknown as Response;
});

/** Send `n` at the wire: its words (the whole body) and its key (a v4 uuid header, never missing). */
const sent = (n: number): { content: string; key: string } => {
  const init = fetchMock.mock.calls[n][1];
  const headers = init.headers as Record<string, string>;
  const body = JSON.parse(String(init.body)) as Record<string, unknown>;
  expect(Object.keys(body)).toEqual(['content']); // never a body field
  expect(headers['Idempotency-Key']).toEqual(expect.stringMatching(UUID));
  return { content: String(body.content), key: headers['Idempotency-Key'] };
};

beforeEach(async () => {
  wire = [];
  fetchMock.mockClear();
  global.fetch = fetchMock as unknown as typeof fetch;
  mockList.mockReset().mockResolvedValue(PAGE);
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  authEvents.emit('logout');
  await waitFor(() => expect([...mockDisk.keys()]).toEqual([]));
});
afterEach(() => {
  global.fetch = realFetch;
  jest.restoreAllMocks();
});

const INPUT = 'roman-composer-input';
const open = async () => {
  const r = await render(<RomanChatScreen surface="client" />);
  await waitFor(() => expect(r.getByTestId('roman-message-r-1-reply')).toBeTruthy());
  return r;
};
type R = Awaited<ReturnType<typeof open>>;
const boxOf = (r: R): string => r.getByTestId(INPUT).props.value;
const quoting = (r: R): boolean => r.queryByText('Replying to Roman') != null;

it('MERGEUP-950C N7 (a) at the wire: a quoted reply answered "not ready yet" keeps the quote; Send again sends the same content under the same Idempotency-Key', async () => {
  wire = [REPLY_PENDING_FRAME, OK];
  const r = await open();
  await act(async () => { fireEvent(r.getByTestId('roman-message-r-1-reply'), 'longPress'); });
  await act(async () => { fireEvent.press(r.getByLabelText('Reply')); });
  expect(quoting(r)).toBe(true);
  await fireEvent.changeText(r.getByTestId(INPUT), WORDS);
  await act(async () => { fireEvent.press(r.getByTestId('roman-composer-send')); });
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  const first = sent(0);
  expect(first.content).toBe(QUOTED);
  await waitFor(() => expect(r.getByTestId('roman-send-retry')).toBeTruthy());
  expect(r.getByText(ROMAN_STORED_NO_REPLY)).toBeTruthy();
  expect(quoting(r)).toBe(true);
  expect(boxOf(r)).toBe(WORDS);
  await act(async () => { fireEvent.press(r.getByTestId('roman-send-retry')); });
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(sent(1)).toEqual(first);
  // The replay is answered: the quote goes once and the box empties.
  await waitFor(() => expect(boxOf(r)).toBe(''));
  expect(quoting(r)).toBe(false);
});
