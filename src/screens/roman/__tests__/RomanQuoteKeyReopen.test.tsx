/**
 * QUOTE-KEY-REOPEN-M (agent 203): a quoted Roman send that is still out, or answered "not ready yet", keeps its quote
 * with its send-once key in lib/chatDrafts, so after Back, a reopen or a restart "Replying to Roman" is back over the
 * same words and Send sends the same content under the same Idempotency-Key: the server replays the stored turn and
 * never stores the question twice (LS-953R2 B1's class, 6703511190; MERGE-UP 6776462509; LO-950R5 N4 6836164210).
 *
 * At the wire, as RomanQuoteSendOnce.wire.mergeup950 and RomanSendOnce: the real screen, hook and sendMessage; only
 * fetch and the session reads are stubbed. The fake server keeps one turn per key, as roman.controller.ts:297-311 does
 * at backend 9d0db7eb: a new key stores a turn; the same key and words replay it (its answer, or "not ready yet" while
 * it has none); other words under a kept key are a 409. A restart is the device copy alone: chatDrafts' module memory
 * is emptied (its sign-out sweep, chatDrafts.ts:54-60), the copy is put back, and the room mounts fresh; the copy is
 * read later (getString undefined, the AsyncStorage fallback) or at once (getString returning it, as native MMKV,
 * chatDrafts.ts:69-79). Android hold menu (Reply is a row in the sheet).
 */
import React from 'react';
import { AccessibilityInfo, Platform, Text, TextInput } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockDisk = new Map<string, string>();
let mockSyncRead = false;
jest.mock('../../../storage/mmkv', () => ({
  ...jest.requireActual('../../../storage/mmkv'),
  cacheStorage: {
    getString: (k: string) => (mockSyncRead ? mockDisk.get(k) : undefined),
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
let mockSessionId = 'sess-1';
jest.mock('../../../api/romanApi', () => ({
  ...jest.requireActual('../../../api/romanApi'),
  openOrResumeSession: async (surface: string) => ({ id: mockSessionId, surface, messageCount: 4 }),
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
const { romanChatsEvents } = require('../../settings/romanChatsEvents');
const { CHAT_DRAFT_KEY_PREFIX, useChatDraft } = require('../../../lib/chatDrafts');
const { ROMAN_HELD_NOT_READY } = require('../../../components/roman/romanVoice');
const { ROMAN_QUOTE_MAX, romanQuoteExcerpt, splitRomanQuote, withRomanQuote } = require('../../../components/roman/romanReply');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const OLD_KEY = '4f1d2c3b-5a6e-4b7c-8d9e-0a1b2c3d4e5f';
const DRAFT = `${CHAT_DRAFT_KEY_PREFIX}client-1:roman`;

const REPLY = 'Keep Thursday easy: a 30-minute ride at a pace you could talk through.';
const REPLY_B = 'Saturday can take the hills once your legs are fresh.';
// Over 200 characters, with bold marks the excerpt drops: the strip and the send carry a cut, ellipsis-ended excerpt.
const LONG_REPLY = `**Keep Thursday easy.** ${'A 30-minute ride at a pace you could talk through, then ten minutes of easy stretching. '.repeat(4)}`;
const WORDS = 'Can I do it indoors?';
// Long enough that the quote shrinks to fit the 8000-character send cap (romanReply.ts:35-37).
const LONG_WORDS = `${'Plan the week around my shifts, please. '.repeat(196)}Thanks.`;
const QUOTED = withRomanQuote(REPLY, WORDS);

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
const cancelReply = async (r: R) => { await act(async () => { fireEvent.press(r.getByLabelText('Cancel reply')); }); };
/** Let a send that settles in a closed room finish its device writes. */
const settle = async () => { await act(async () => { await new Promise((done) => setTimeout(done, 30)); }); };
/** The device copy of the Roman box, parsed. */
const copy = (k = DRAFT): { text: string; failed?: Record<string, unknown> } | undefined => {
  const raw = mockDisk.get(k);
  return raw ? JSON.parse(raw) : undefined;
};
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

// ---- Red at main: 1, 2, 3. ----

it.each([
  ['a short reply', REPLY, WORDS],
  ['a reply over 200 characters and a draft so long the quote shrinks', LONG_REPLY, LONG_WORDS],
])('1. while out (%s): Back, reopen: "Replying to Roman" over the same words; Send: the same content under the same key', async (_l, reply, words) => {
  first = 'hold';
  mockList.mockResolvedValue(page(reply));
  const a = await open();
  await quotedSend(a, words);
  const firstSend = sent(0);
  expect(firstSend.content).toBe(withRomanQuote(reply, words));
  await a.unmount(); // Back while the first send has no answer yet
  const b = await open();
  await waitFor(() => expect(quoting(b)).toBe(true));
  expect(boxOf(b)).toBe(words);
  await sendFrom(b);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(sent(1)).toEqual(firstSend);
  expect(turns.size).toBe(1); // the server never stores the question twice
  await act(async () => { release?.('answer'); }); // then the first settles
});

it('2. after "not ready yet" shows (LO-950R5 N4): Back, reopen: the strip and the words, no card; Send: the same content under the same key', async () => {
  first = 'pending';
  const a = await open();
  await quotedSend(a);
  await waitFor(() => expect(a.getByText(ROMAN_HELD_NOT_READY)).toBeTruthy());
  expect(quoting(a)).toBe(true);
  expect(boxOf(a)).toBe(WORDS);
  const firstSend = sent(0);
  await a.unmount();
  const b = await open();
  await waitFor(() => expect(quoting(b)).toBe(true));
  expect(boxOf(b)).toBe(WORDS);
  expect(b.queryByText(ROMAN_HELD_NOT_READY)).toBeNull();
  expect(b.queryByTestId('roman-send-retry')).toBeNull();
  turns.get(firstSend.key)!.answered = true; // Roman's answer is stored by now
  await sendFrom(b);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(sent(1)).toEqual(firstSend);
  expect(turns.size).toBe(1);
  await waitFor(() => expect(boxOf(b)).toBe(''));
  expect(quoting(b)).toBe(false);
});

it.each([
  ['while out', 'read later (getString undefined)', 'hold', false],
  ['while out', 'read at once (native MMKV)', 'hold', true],
  ['after "not ready yet"', 'read later (getString undefined)', 'pending', false],
  ['after "not ready yet"', 'read at once (native MMKV)', 'pending', true],
] as const)('3. a restart %s, the copy %s: only the device copy is left; the strip and the words come back; Send: same content, same key', async (_l, _r, how, sync) => {
  first = how;
  const a = await open();
  await quotedSend(a);
  if (how === 'pending') await waitFor(() => expect(a.getByText(ROMAN_HELD_NOT_READY)).toBeTruthy());
  const firstSend = sent(0);
  await waitFor(() => expect(mockDisk.get(DRAFT)).toContain(firstSend.key));
  await a.unmount();
  await restart();
  mockSyncRead = sync;
  const b = await open();
  await waitFor(() => expect(quoting(b)).toBe(true));
  expect(boxOf(b)).toBe(WORDS);
  await sendFrom(b);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(sent(1)).toEqual(firstSend);
  expect(turns.size).toBe(1);
});

// ---- Green at main and at the head: 4 to 12. ----

it('4. a plain send reopened while out replays its key (LS-953R2 B1); no strip appears', async () => {
  first = 'hold';
  const a = await open();
  await type(a, WORDS);
  await sendFrom(a);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  await a.unmount();
  const b = await open();
  expect(boxOf(b)).toBe(WORDS);
  expect(quoting(b)).toBe(false);
  await sendFrom(b);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(sent(1)).toEqual({ content: WORDS, key: sent(0).key });
  expect(turns.size).toBe(1);
});

it('4. a chip beside a typed draft keeps its key aside across a reopen (LS-953 B2); the draft keeps its words', async () => {
  first = 'hold';
  const a = await open();
  await type(a, 'My separate unfinished question');
  await act(async () => { fireEvent.press(a.getByTestId('roman-quick-start-0')); });
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  await a.unmount();
  const b = await open();
  expect(boxOf(b)).toBe('My separate unfinished question');
  expect(quoting(b)).toBe(false);
  await act(async () => { fireEvent.press(b.getByTestId('roman-quick-start-0')); });
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(sent(1)).toEqual(sent(0));
  expect(turns.size).toBe(1);
  expect(boxOf(b)).toBe('My separate unfinished question');
});

it('5. the excerpt as sent rebuilds the sent words byte for byte: a reply over 200 characters, and a draft that shrinks the quote', () => {
  const full = romanQuoteExcerpt(LONG_REPLY);
  expect(full.length).toBeLessThanOrEqual(ROMAN_QUOTE_MAX);
  expect(full.endsWith('…')).toBe(true);
  for (const words of [WORDS, LONG_WORDS]) {
    const body = withRomanQuote(LONG_REPLY, words);
    const asSent = splitRomanQuote(body)!.quote;
    if (words === LONG_WORDS) expect(asSent.length).toBeLessThan(ROMAN_QUOTE_MAX); // the quote shrank
    else expect(asSent).toBe(full);
    // An excerpt passed back through romanQuoteExcerpt returns unchanged when it fits (proved, not assumed) ...
    expect(romanQuoteExcerpt(asSent)).toBe(asSent);
    expect(romanQuoteExcerpt(asSent, asSent.length)).toBe(asSent);
    // ... so the words rebuilt from it equal the first send's, byte for byte.
    expect(withRomanQuote(asSent, words)).toBe(body);
    expect(withRomanQuote(asSent, words).trim()).toBe(body.trim());
  }
});

it('5. in place: a long reply and a long draft answered "not ready yet": Send again sends the same content under the same key', async () => {
  first = 'pending';
  mockList.mockResolvedValue(page(LONG_REPLY));
  const r = await open();
  await quotedSend(r, LONG_WORDS);
  await waitFor(() => expect(r.getByTestId('roman-send-retry')).toBeTruthy());
  await act(async () => { fireEvent.press(r.getByTestId('roman-send-retry')); });
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(sent(1)).toEqual(sent(0));
  expect(sent(0).content).toBe(withRomanQuote(LONG_REPLY, LONG_WORDS));
  expect(turns.size).toBe(1);
});

it.each([
  ['before Back', false],
  ['after Back, before the reopen', true],
])('6. a quoted send answered in full %s: the reopen shows an empty box and no strip; the device holds nothing of it', async (_l, late) => {
  first = late ? 'hold' : 'answer';
  const a = await open();
  await quotedSend(a);
  if (!late) {
    await waitFor(() => expect(boxOf(a)).toBe(''));
    expect(quoting(a)).toBe(false);
  }
  await a.unmount();
  if (late) {
    await act(async () => { release?.('answer'); });
    await settle();
  }
  await waitFor(() => expect(mockDisk.get(DRAFT)).toBeUndefined());
  const b = await open();
  expect(boxOf(b)).toBe('');
  expect(quoting(b)).toBe(false);
  expect([...mockDisk.values()].join('\n')).not.toContain(romanQuoteExcerpt(REPLY));
});

it.each([
  ['Cancel reply', 'a failed send', 'offline'],
  ['Cancel reply', '"not ready yet"', 'pending'],
  ['another reply picked', 'a failed send', 'offline'],
  ['another reply picked', '"not ready yet"', 'pending'],
] as const)('7. %s after %s that kept its key: the reopen draws no strip; Send: the bare words under a new key (R3)', async (action, _s, how) => {
  first = how;
  const a = await open();
  await quotedSend(a);
  await waitFor(() => expect(a.getByTestId('roman-send-retry')).toBeTruthy());
  const firstSend = sent(0);
  if (action === 'Cancel reply') await cancelReply(a);
  else await pick(a, 'r-2');
  await a.unmount();
  const b = await open();
  await settle();
  expect(quoting(b)).toBe(false);
  expect(boxOf(b)).toBe(WORDS);
  await sendFrom(b);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(sent(1).content).toBe(WORDS);
  expect(sent(1).key).not.toBe(firstSend.key);
});

it.each([
  ['Delete all', () => romanChatsEvents.emitErased({ id: null })],
  ['an erase of this chat', () => romanChatsEvents.emitErased({ id: 'sess-1' })],
  ['a gone event for this chat', () => romanChatsEvents.emitGone({ ownerId: 'client-1', epoch: 0, id: 'sess-1' })],
  ['a different session on reopen', null],
] as const)('8. %s after a kept quoted send: no strip in the fresh chat; the device keeps the words and key only (R2)', async (_l, erase) => {
  first = 'pending';
  const a = await open();
  await quotedSend(a);
  await waitFor(() => expect(a.getByText(ROMAN_HELD_NOT_READY)).toBeTruthy());
  const firstSend = sent(0);
  mockSessionId = 'sess-2';
  let r: R = a;
  if (erase) {
    await act(async () => { erase(); });
    await waitFor(() => expect(mockList).toHaveBeenLastCalledWith('sess-2', expect.anything()));
  } else {
    await a.unmount();
    r = await open();
  }
  await settle();
  expect(quoting(r)).toBe(false);
  expect(boxOf(r)).toBe(WORDS);
  await waitFor(() => expect(Object.keys(copy()?.failed ?? {})).toEqual(['text', 'key']));
  expect(copy()?.failed).toEqual({ text: QUOTED, key: firstSend.key }); // the key stays as main keeps it (LS-950R5 N7)
  if (!erase) {
    await r.unmount();
    r = await open(); // and it never comes back in that chat later
    await settle();
    expect(quoting(r)).toBe(false);
  }
  await sendFrom(r);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(sent(1).content).toBe(WORDS);
  expect(sent(1).key).not.toBe(firstSend.key);
});

it.each([
  ['a sign-out, then the same account signs in', 'client-1'],
  ['another account signs in on the same phone', 'client-2'],
])('9. %s after a kept quoted send: nothing comes back and nothing is left on the device', async (_l, next) => {
  first = 'offline';
  const a = await open();
  await quotedSend(a);
  await waitFor(() => expect(mockDisk.get(DRAFT)).toContain(sent(0).key));
  await a.unmount();
  authEvents.emit('logout');
  await waitFor(() => expect([...mockDisk.keys()]).toEqual([]));
  mockUser = { id: next, firstName: 'Ana' };
  authEvents.emit('login');
  const b = await open();
  await settle();
  expect(boxOf(b)).toBe('');
  expect(quoting(b)).toBe(false);
  expect([...mockDisk.keys()]).toEqual([]);
});

it("10. the coach's Roman room (no hold menu): a kept copy with a quote draws no strip; Send sends the box's words under a new key", async () => {
  mockUser = { id: 'coach-1', firstName: 'Sam' };
  mockDisk.set(`${CHAT_DRAFT_KEY_PREFIX}coach-1:roman`, JSON.stringify({
    text: WORDS,
    failed: { text: QUOTED, key: OLD_KEY, quote: { id: 'r-1', excerpt: REPLY, session: 'sess-1' } },
  }));
  const r = await open('coach');
  await waitFor(() => expect(boxOf(r)).toBe(WORDS));
  await settle();
  expect(quoting(r)).toBe(false);
  await act(async () => { fireEvent(r.getByTestId('roman-message-r-1-reply'), 'longPress'); });
  expect(r.queryByLabelText('Reply')).toBeNull();
  await sendFrom(r);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  expect(sent(0).content).toBe(WORDS);
  expect(sent(0).key).not.toBe(OLD_KEY);
});

function Box({ thread }: { thread: string }) {
  const [text, setText, sendKey] = useChatDraft(thread);
  return (
    <>
      <TextInput accessibilityLabel="box" value={text} onChangeText={setText} />
      <Text testID="key">{sendKey.keyFor(text) ?? 'none'}</Text>
    </>
  );
}

it("11. another chat's device copy without the new record reads and writes exactly as at main", async () => {
  const thread = `${CHAT_DRAFT_KEY_PREFIX}client-1:coach:client-9`;
  const aside = [{ text: 'Check-in', key: 'key-2' }];
  mockDisk.set(thread, JSON.stringify({ text: 'see you at 6', failed: { text: 'see you at 6', key: 'key-1' }, aside }));
  const r = await render(<Box thread="coach:client-9" />);
  await waitFor(() => expect(r.getByLabelText('box').props.value).toBe('see you at 6'));
  expect(r.getByTestId('key').props.children).toBe('key-1');
  await fireEvent.changeText(r.getByLabelText('box'), 'see you at 6!');
  await waitFor(() => expect(mockDisk.get(thread)).toBe(
    JSON.stringify({ text: 'see you at 6!', failed: { text: 'see you at 6', key: 'key-1' }, aside }),
  ));
  await fireEvent.changeText(r.getByLabelText('box'), '');
  await waitFor(() => expect(mockDisk.get(thread)).toBe(JSON.stringify({ text: '', aside })));
});

it.each([
  ['a quote that is not a record', 42],
  ['a quote with a field of the wrong kind', { id: 'r-1', excerpt: 7, session: 'sess-1' }],
])('11. a device copy with %s keeps its words and key and draws no strip', async (_l, quote) => {
  mockDisk.set(DRAFT, JSON.stringify({ text: WORDS, failed: { text: QUOTED, key: OLD_KEY, quote } }));
  const r = await open();
  await waitFor(() => expect(boxOf(r)).toBe(WORDS));
  await settle();
  expect(quoting(r)).toBe(false);
  await pick(r);
  await sendFrom(r);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  expect(sent(0)).toEqual({ content: QUOTED, key: OLD_KEY }); // the key was kept
});

it("12. a device copy written by main's code (the key under the quoted words, no quote record) reopens as today: no strip, a new key", async () => {
  mockDisk.set(DRAFT, JSON.stringify({ text: WORDS, failed: { text: QUOTED, key: OLD_KEY } }));
  const r = await open();
  await waitFor(() => expect(boxOf(r)).toBe(WORDS));
  await settle();
  expect(quoting(r)).toBe(false);
  await sendFrom(r);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  expect(sent(0).content).toBe(WORDS);
  expect(sent(0).key).not.toBe(OLD_KEY);
});

// ---- 13: the first send ends after the reopen and before the new Send. A quoted send must act as a plain send does at
// main in the same order: the same key exactly when the plain send keeps it, and the same number of stored turns. ----

it.each([
  ['answered', 'plain', true, 1, 'answer'],
  ['answered', 'quoted', true, 1, 'answer'],
  ['failed, the key kept', 'plain', true, 1, 'lost'],
  ['failed, the key kept', 'quoted', true, 1, 'lost'],
  ['failed, the key spent', 'plain', false, 2, 'spent'],
  ['failed, the key spent', 'quoted', false, 2, 'spent'],
] as const)('13. the first send ends (%s) after the reopen, before Send (%s): same key %s, turns stored %s', async (_l, kind, sameKey, stored, end) => {
  first = 'hold';
  const a = await open();
  if (kind === 'quoted') await quotedSend(a);
  else {
    await type(a, WORDS);
    await sendFrom(a);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  }
  const firstSend = sent(0);
  await a.unmount();
  const b = await open();
  await settle();
  await act(async () => { release?.(end); });
  await settle();
  await sendFrom(b);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  if (sameKey) expect(sent(1)).toEqual(firstSend);
  else expect(sent(1).key).not.toBe(firstSend.key);
  expect(turns.size).toBe(stored);
});
