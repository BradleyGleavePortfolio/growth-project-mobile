/**
 * REFINE-988 (agent 203, fix round 1 on m#988): the reopened room's focus and scroll, as this round decided them
 * (notes handoffs/op-203/notes/REFINE-988.md on op203/notes-refine-988). No behaviour changes: these pin main's rules.
 * - Focus (decision a, REC "no focus on reopen"): a reopened room that brings "Replying to Roman" back over the kept
 *   words leaves the box unfocused (no autoFocus, nothing focused), so the keyboard does not rise on every reopen; the
 *   person taps the box, as in the approved Q1.
 * - Scroll (decision b, REC "keep main's rule"): the reopened thread goes to its newest turn by main's scrollToLatest
 *   (RomanChatScreen.tsx:273-288, :647); the restore adds no scroll of its own (no scroll to the quoted answer).
 * Setup copied from RomanQuoteKeyReopen.test.tsx (the real screen, hook and sendMessage; fetch and the session reads
 * stubbed; the fake server keeps one turn per key; a restart is the device copy alone).
 */
import React from 'react';
import { AccessibilityInfo, Platform } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockDisk = new Map<string, string>();
let mockSyncRead = false;
// C5 (LS-988R1): hold the device read or the session open, to pin which arrives first after a restart.
let mockReadGate: Promise<void> | null = null;
let mockOpenGate: Promise<void> | null = null;
jest.mock('../../../storage/mmkv', () => ({
  ...jest.requireActual('../../../storage/mmkv'),
  cacheStorage: {
    getString: (k: string) => (mockSyncRead ? mockDisk.get(k) : undefined),
    getStringAsync: async (k: string) => {
      if (mockReadGate) await mockReadGate;
      return mockDisk.get(k);
    },
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
let mockSessionId = 'sess-1';
jest.mock('../../../api/romanApi', () => ({
  ...jest.requireActual('../../../api/romanApi'),
  openOrResumeSession: async (surface: string) => {
    if (mockOpenGate) await mockOpenGate;
    return { id: mockSessionId, surface, messageCount: 4 };
  },
  listMessages: (...a: unknown[]) => mockList(...a),
  deleteSession: jest.fn(),
}));
jest.mock('../../../utils/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('../../../services/sentry', () => ({ captureError: jest.fn(), setSentryUser: jest.fn() }));
let mockUser: { id: string; firstName: string } = { id: 'client-1', firstName: 'Maya' };
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
const { authEvents } = require('../../../utils/authEvents');
const { CHAT_DRAFT_KEY_PREFIX } = require('../../../lib/chatDrafts');
const { ROMAN_HELD_NOT_READY } = require('../../../components/roman/romanVoice');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DRAFT = `${CHAT_DRAFT_KEY_PREFIX}client-1:roman`;

const REPLY = 'Keep Thursday easy: a 30-minute ride at a pace you could talk through.';
const REPLY_B = 'Saturday can take the hills once your legs are fresh.';
const WORDS = 'Can I do it indoors?';

// The server's page is newest first; useRomanChat turns it around.
const page = (reply = REPLY) => ({
  messages: [
    { id: 'r-2', role: 'assistant', content: REPLY_B, interrupted: false, createdAt: '2026-11-06T10:01:05Z' },
    { id: 'u-2', role: 'user', content: 'And the weekend?', interrupted: false, createdAt: '2026-11-06T10:01:00Z' },
    { id: 'r-1', role: 'assistant', content: reply, interrupted: false, createdAt: '2026-11-06T10:00:05Z' },
    { id: 'u-1', role: 'user', content: 'Swap my Thursday run for a ride?', interrupted: false, createdAt: '2026-11-06T10:00:00Z' },
  ],
  nextCursor: null,
});

const realOS = Platform.OS;
beforeAll(() => Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'android' }));
afterAll(() => Object.defineProperty(Platform, 'OS', { configurable: true, get: () => realOS }));

// ---- The fake server: one turn per key. ----
const DONE = (text: string) => `data: {"type":"delta","text":"${text}"}\n\ndata: {"type":"done","text":"${text}","messageId":"m-reply-9","interrupted":false}\n\n`;
const PENDING_FRAME = 'event: error\ndata: {"code":"ROMAN_REPLY_PENDING","message":"Roman is not available right now."}\n\n';
const NO_REPLY_FRAME = 'event: error\ndata: {"code":"ROMAN_UNAVAILABLE","message":"Roman is not available right now."}\n\n';
const REUSED_409 = '{"error":"conflict","code":"IDEMPOTENCY_KEY_REUSED"}';
const ANSWER = DONE('Yes, the trainer works.');
type Turn = { content: string; answered: boolean };
/** How the first new key is met: answered; "not ready yet"; held (the 200 came, the body has not); no connection. */
type First = 'answer' | 'pending' | 'hold' | 'offline';
/** How a held first send ends: answered; the connection lost (the key is kept); a coded frame (the key is spent). */
type End = 'answer' | 'lost' | 'spent';
const turns = new Map<string, Turn>();
let first: First = 'answer';
let release: ((end: End) => void) | null = null;

const respond = (status: number, body: string | Promise<string>): Response => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => null },
  text: () => Promise.resolve(body),
} as unknown as Response);

const realFetch = global.fetch;
const fetchMock = jest.fn(async (_url: string, init: RequestInit): Promise<Response> => {
  const key = (init.headers as Record<string, string>)['Idempotency-Key'];
  const content = (JSON.parse(String(init.body)) as { content: string }).content;
  const kept = turns.get(key);
  if (kept) {
    if (kept.content !== content) return respond(409, REUSED_409);
    return respond(200, kept.answered ? ANSWER : PENDING_FRAME);
  }
  const how: First = turns.size === 0 ? first : 'answer';
  if (how === 'offline') throw new TypeError('Network request failed');
  const turn: Turn = { content, answered: false };
  turns.set(key, turn);
  if (how === 'answer') {
    turn.answered = true;
    return respond(200, ANSWER);
  }
  if (how === 'pending') return respond(200, PENDING_FRAME);
  const body = new Promise<string>((resolve, reject) => {
    release = (end) => {
      if (end === 'answer') {
        turn.answered = true;
        resolve(ANSWER);
      } else if (end === 'spent') resolve(NO_REPLY_FRAME);
      else reject(new TypeError('Connection lost after the turn was stored'));
    };
  });
  body.catch(() => undefined);
  return respond(200, body);
});

/** Send `n` at the wire: its words (the whole body) and its key (a v4 uuid header, never missing). */
const sent = (n: number): { content: string; key: string } => {
  const init = fetchMock.mock.calls[n][1];
  const headers = init.headers as Record<string, string>;
  const body = JSON.parse(String(init.body)) as Record<string, unknown>;
  expect(Object.keys(body)).toEqual(['content']);
  expect(headers['Idempotency-Key']).toEqual(expect.stringMatching(UUID));
  return { content: String(body.content), key: headers['Idempotency-Key'] };
};

beforeEach(async () => {
  turns.clear();
  first = 'answer';
  release = null;
  mockSyncRead = false;
  mockReadGate = null;
  mockOpenGate = null;
  mockSessionId = 'sess-1';
  mockUser = { id: 'client-1', firstName: 'Maya' };
  fetchMock.mockClear();
  global.fetch = fetchMock as unknown as typeof fetch;
  mockList.mockReset().mockResolvedValue(page());
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  authEvents.emit('logout');
  await waitFor(() => expect([...mockDisk.keys()]).toEqual([]));
});
afterEach(async () => {
  // A held first send that a test left out ends here, so no request outlives its test.
  await act(async () => { release?.('lost'); });
  await settle();
  global.fetch = realFetch;
  jest.restoreAllMocks();
});

const INPUT = 'roman-composer-input';
const open = async (surface: 'client' | 'coach' = 'client') => {
  const r = await render(<RomanChatScreen surface={surface} />);
  await waitFor(() => expect(r.getByTestId('roman-message-r-1-reply')).toBeTruthy());
  return r;
};
type R = Awaited<ReturnType<typeof open>>;
const boxOf = (r: R): string => r.getByTestId(INPUT).props.value;
const quoting = (r: R): boolean => r.queryByText('Replying to Roman') != null;
const pick = async (r: R, id = 'r-1') => {
  await act(async () => { fireEvent(r.getByTestId(`roman-message-${id}-reply`), 'longPress'); });
  await act(async () => { fireEvent.press(r.getByLabelText('Reply')); });
  expect(quoting(r)).toBe(true);
};
const type = async (r: R, text: string) => { await fireEvent.changeText(r.getByTestId(INPUT), text); };
const sendFrom = async (r: R) => { await act(async () => { fireEvent.press(r.getByTestId('roman-composer-send')); }); };
/** Let a send that settles in a closed room finish its device writes. */
const settle = async () => { await act(async () => { await new Promise((done) => setTimeout(done, 30)); }); };
/** A restart: chatDrafts' memory goes (its sign-out sweep) and only the device copy is left. */
const restart = async () => {
  const kept = new Map(mockDisk);
  authEvents.emit('logout');
  await waitFor(() => expect([...mockDisk.keys()]).toEqual([]));
  kept.forEach((v, k) => mockDisk.set(k, v));
};

/** Reply to Roman's answer r-1, type, Send. */
const quotedSend = async (r: R, words = WORDS) => {
  await pick(r);
  await type(r, words);
  await sendFrom(r);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
};

const TextInputStateModule = require('react-native/Libraries/Components/TextInput/TextInputState');
const TextInputState = TextInputStateModule.default ?? TextInputStateModule;
const { FlatList } = require('react-native');

const REOPENS = [
  ['while out (Back before the answer)', 'hold', false, false],
  ['after "not ready yet"', 'pending', false, false],
  ['after a restart, the copy read later', 'pending', true, false],
  ['after a restart, the copy read at once (native MMKV)', 'pending', true, true],
] as const;

/** Reply to r-1, type, Send (the first send met as `how`), then leave; reopen (or restart and open). */
const reopenWithKeptQuote = async (how: First, viaRestart: boolean, sync: boolean): Promise<R> => {
  first = how;
  const a = await open();
  await quotedSend(a);
  if (how === 'pending') await waitFor(() => expect(a.getByText(ROMAN_HELD_NOT_READY)).toBeTruthy());
  await waitFor(() => expect(mockDisk.get(DRAFT)).toContain(sent(0).key));
  await a.unmount();
  if (viaRestart) {
    await restart();
    mockSyncRead = sync;
  }
  const b = await open();
  await waitFor(() => expect(quoting(b)).toBe(true));
  expect(boxOf(b)).toBe(WORDS);
  return b;
};

it.each(REOPENS)('R2-a. focus: reopened %s, the strip is back over the words and the box is not focused', async (_l, how, viaRestart, sync) => {
  const b = await reopenWithKeptQuote(how, viaRestart, sync);
  const input = b.getByTestId(INPUT);
  expect(input.props.autoFocus).toBeFalsy();
  expect(TextInputState.currentlyFocusedInput()).toBeNull();
  await settle();
  expect(TextInputState.currentlyFocusedInput()).toBeNull();
  expect(quoting(b)).toBe(true);
});

it.each(REOPENS)('R2-b. scroll: reopened %s, the thread goes to its newest turn by main\'s rule and nothing scrolls to the quoted answer', async (_l, how, viaRestart, sync) => {
  const toEnd = jest.spyOn(FlatList.prototype, 'scrollToEnd');
  const toIndex = jest.spyOn(FlatList.prototype, 'scrollToIndex');
  const toItem = jest.spyOn(FlatList.prototype, 'scrollToItem');
  const toOffset = jest.spyOn(FlatList.prototype, 'scrollToOffset');
  const b = await reopenWithKeptQuote(how, viaRestart, sync);
  await settle();
  expect(toEnd).toHaveBeenCalled();
  const before = toEnd.mock.calls.length;
  await act(async () => { fireEvent(b.getByTestId('roman-message-list'), 'contentSizeChange', 390, 2000); });
  expect(toEnd.mock.calls.length).toBe(before + 1); // the list's content size: main's scrollToLatest (:647)
  expect(toIndex).not.toHaveBeenCalled();
  expect(toItem).not.toHaveBeenCalled();
  expect(toOffset).not.toHaveBeenCalled();
  expect(quoting(b)).toBe(true);
});

it('R2-c. a plain open with no kept quote: no strip, the box not focused, the thread at its newest turn', async () => {
  const toEnd = jest.spyOn(FlatList.prototype, 'scrollToEnd');
  const r = await open();
  await settle();
  expect(quoting(r)).toBe(false);
  expect(r.getByTestId(INPUT).props.autoFocus).toBeFalsy();
  expect(TextInputState.currentlyFocusedInput()).toBeNull();
  expect(toEnd).toHaveBeenCalled();
});

// ---- LS-988R1 (AUDIT 6872745845), folded in this round. ----

const cancelReply = async (r: R) => { await act(async () => { fireEvent.press(r.getByLabelText('Cancel reply')); }); };
const deferred = (): { gate: Promise<void>; open: () => void } => {
  let open = () => undefined as void;
  const gate = new Promise<void>((done) => { open = done; });
  return { gate, open };
};

// C1: red at 91f847cf (the failure re-filed the quote it read at the send's start, RomanChatScreen.tsx:404).
it('C1. Cancel reply while the first send is out, then it fails keeping its key: Back, reopen: no strip (R3); Send: the bare words under a new key', async () => {
  first = 'hold';
  const a = await open();
  await quotedSend(a);
  const firstSend = sent(0);
  await cancelReply(a);
  expect(quoting(a)).toBe(false);
  await act(async () => { release?.('lost'); }); // the send fails in a way that keeps its key
  await settle();
  await a.unmount();
  const b = await open();
  await settle();
  expect(boxOf(b)).toBe(WORDS);
  expect(quoting(b)).toBe(false);
  await sendFrom(b);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(sent(1).content).toBe(WORDS);
  expect(sent(1).key).not.toBe(firstSend.key);
});

it('C1. another reply picked while the first send is out, then it fails keeping its key: Back, reopen: no strip for the first reply', async () => {
  first = 'hold';
  const a = await open();
  await quotedSend(a);
  await pick(a, 'r-2');
  await act(async () => { release?.('lost'); });
  await settle();
  await a.unmount();
  const b = await open();
  await settle();
  expect(boxOf(b)).toBe(WORDS);
  expect(quoting(b)).toBe(false);
});

it('C1. Cancel reply in the reopened room while the closed room\'s send is still out: after it fails keeping its key, the next reopen draws no strip', async () => {
  first = 'hold';
  const a = await open();
  await quotedSend(a);
  await a.unmount(); // Back while out
  const b = await open();
  await waitFor(() => expect(quoting(b)).toBe(true));
  await cancelReply(b);
  await act(async () => { release?.('lost'); }); // the closed room's send ends now
  await settle();
  await b.unmount();
  const c = await open();
  await settle();
  expect(boxOf(c)).toBe(WORDS);
  expect(quoting(c)).toBe(false);
});

// LO-988R1 (AUDIT 6873008435) C1's P3, the same order in one room: red at 91f847cf.
it('C1 (LO-988R1 P3). Cancel reply while the first send is out, then it fails keeping its key: in the same room, typing the old words back draws no strip', async () => {
  first = 'hold';
  const a = await open();
  await quotedSend(a);
  await cancelReply(a);
  await act(async () => { release?.('lost'); });
  await settle();
  expect(quoting(a)).toBe(false);
  await type(a, `${WORDS} x`);
  await type(a, WORDS);
  await settle();
  expect(boxOf(a)).toBe(WORDS);
  expect(quoting(a)).toBe(false);
});

it('C1. Cancel reply, then the same reply picked again and Send again (the same words, the kept key): it fails keeping its key; Back, reopen: the strip is back', async () => {
  first = 'pending';
  const a = await open();
  await quotedSend(a);
  await waitFor(() => expect(a.getByText(ROMAN_HELD_NOT_READY)).toBeTruthy());
  const firstSend = sent(0);
  await cancelReply(a);
  await pick(a, 'r-1');
  await sendFrom(a);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(sent(1)).toEqual(firstSend);
  await settle();
  await a.unmount();
  const b = await open();
  await waitFor(() => expect(quoting(b)).toBe(true));
  expect(boxOf(b)).toBe(WORDS);
});

// C3: red at 91f847cf (the restore ran on every keystroke, RomanChatScreen.tsx:219-231).
it('C3. the box edited before Back: the reopen draws no strip, and typing the kept words back does not bring it in', async () => {
  first = 'pending';
  const a = await open();
  await quotedSend(a);
  await waitFor(() => expect(a.getByText(ROMAN_HELD_NOT_READY)).toBeTruthy());
  await type(a, `${WORDS} Or outside?`);
  await settle();
  await a.unmount();
  const b = await open();
  await settle();
  expect(quoting(b)).toBe(false);
  await type(b, WORDS);
  await settle();
  expect(quoting(b)).toBe(false);
});

// C5: pins, green at 91f847cf; each reaches a guard or an order no case reached (mutations in FIX ROUND 1).
it('C5a. the byte check: the box edited before Back draws no strip; Send: the edited words under a new key', async () => {
  first = 'pending';
  const a = await open();
  await quotedSend(a);
  await waitFor(() => expect(a.getByText(ROMAN_HELD_NOT_READY)).toBeTruthy());
  const firstSend = sent(0);
  await type(a, `${WORDS} Or outside?`);
  await settle();
  await a.unmount();
  const b = await open();
  await settle();
  expect(quoting(b)).toBe(false);
  await sendFrom(b);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(sent(1).content).toBe(`${WORDS} Or outside?`);
  expect(sent(1).key).not.toBe(firstSend.key);
});

it('C5b. the sign-in guard: a sign-out and sign-in while the reopened room is open drops the strip and it does not come back in that room', async () => {
  first = 'pending';
  const a = await open();
  await quotedSend(a);
  await waitFor(() => expect(a.getByText(ROMAN_HELD_NOT_READY)).toBeTruthy());
  await a.unmount();
  const b = await open();
  await waitFor(() => expect(quoting(b)).toBe(true));
  await act(async () => { authEvents.emit('logout'); authEvents.emit('login'); });
  await settle();
  expect(quoting(b)).toBe(false);
});

it('C5c. the same reply picked again after a reopen keeps the record: Back, reopen: the strip; Send: the same content under the same key', async () => {
  first = 'pending';
  const a = await open();
  await quotedSend(a);
  await waitFor(() => expect(a.getByText(ROMAN_HELD_NOT_READY)).toBeTruthy());
  const firstSend = sent(0);
  await a.unmount();
  const b = await open();
  await waitFor(() => expect(quoting(b)).toBe(true));
  await pick(b, 'r-1');
  await b.unmount();
  const c = await open();
  await waitFor(() => expect(quoting(c)).toBe(true));
  expect(boxOf(c)).toBe(WORDS);
  await sendFrom(c);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(sent(1)).toEqual(firstSend);
  expect(turns.size).toBe(1);
});

it.each([
  ['the session opens first, then the device copy lands', 'read'],
  ['the device copy lands first, then the session opens', 'open'],
] as const)('C5d. a restart, the copy read later: %s; the strip and the words come back', async (_l, late) => {
  first = 'pending';
  const a = await open();
  await quotedSend(a);
  await waitFor(() => expect(a.getByText(ROMAN_HELD_NOT_READY)).toBeTruthy());
  await waitFor(() => expect(mockDisk.get(DRAFT)).toContain(sent(0).key));
  await a.unmount();
  await restart();
  const g = deferred();
  if (late === 'read') mockReadGate = g.gate;
  else mockOpenGate = g.gate;
  const b = await render(<RomanChatScreen surface="client" />);
  if (late === 'read') {
    await waitFor(() => expect(b.getByTestId('roman-message-r-1-reply')).toBeTruthy());
    expect(quoting(b)).toBe(false); // the session is open; the copy has not landed
  } else {
    await settle(); // the copy has landed; the session is not open yet
    expect(b.queryByTestId('roman-message-r-1-reply')).toBeNull();
  }
  await act(async () => { g.open(); });
  await waitFor(() => expect(quoting(b)).toBe(true));
  expect(boxOf(b)).toBe(WORDS);
});

it('C5e. an offline quoted send, reopened without a Cancel: the strip and the words; Send: the same content under the same key', async () => {
  first = 'offline';
  const a = await open();
  await quotedSend(a);
  await settle();
  const firstSend = sent(0);
  await waitFor(() => expect(mockDisk.get(DRAFT)).toContain(firstSend.key));
  await a.unmount();
  const b = await open();
  await waitFor(() => expect(quoting(b)).toBe(true));
  expect(boxOf(b)).toBe(WORDS);
  first = 'answer'; // the connection is back
  await sendFrom(b);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(sent(1)).toEqual(firstSend);
  expect(turns.size).toBe(1);
});
