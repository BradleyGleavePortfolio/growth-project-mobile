/**
 * SEND-ONCE-PHONE (182-S10, the phone half of b#1228), write 5 of 5: a Roman turn. At the wire: the real
 * RomanChatScreen, the real useRomanChat and the real sendMessage; only `fetch` (the send) and the session reads are
 * stubbed. The key travels as the Idempotency-Key header only (the body stays exactly { content }: strict DTOs).
 *
 * Send again after no answer (offline, a timeout), a 5xx, or a cut stream after the 200 sends the same key, so the
 * server answers from what it stored (no second model run). New words, a success, a 400 / 409, or a coded frame
 * after the stream opened (the turn is stored with no reply: a same-key resend would only replay that) make a new
 * key. The Roman draft is kept on the device, so its key comes back with it after leaving.
 */
import React from 'react';
import { AccessibilityInfo } from 'react-native';
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
  openOrResumeSession: async () => ({ id: 'sess-1', surface: 'client', messageCount: 0 }),
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
const { CHAT_DRAFT_KEY_PREFIX } = require('../../../lib/chatDrafts');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
type Wire = { throws: Error } | { status: number; text?: string | Error };
const DONE = (text: string) => `data: {"type":"delta","text":"${text}"}\n\ndata: {"type":"done","text":"${text}","messageId":"m-reply-1","interrupted":false}\n\n`;
const NO_ANSWER: Wire = { throws: new TypeError('Network request failed') };
const TIMEOUT: Wire = { throws: Object.assign(new Error('Aborted'), { name: 'AbortError' }) };
const SERVER_DOWN: Wire = { status: 500, text: '{"error":"internal"}' };
const CUT_STREAM: Wire = { status: 200, text: new TypeError('Network request failed') }; // the 200 came, the body did not
const REFUSED_400: Wire = { status: 400, text: '{"error":"bad_request","code":"community.message.idempotency_key_invalid"}' };
const REUSED_409: Wire = { status: 409, text: '{"error":"conflict","code":"community.message.idempotency_key_reused"}' };
const NO_REPLY_FRAME: Wire = {
  status: 200,
  text: 'event: error\ndata: {"code":"ROMAN_UNAVAILABLE","message":"Roman is not available right now."}\n\n',
};
const OK: Wire = { status: 200, text: DONE('Swap it.') };

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
  mockList.mockReset().mockResolvedValue({ messages: [], nextCursor: null });
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
  await waitFor(() => expect(r.getByTestId(INPUT)).toBeTruthy());
  return r;
};
const boxOf = (r: Awaited<ReturnType<typeof open>>): string => r.getByTestId(INPUT).props.value;
const sendFrom = async (r: Awaited<ReturnType<typeof open>>) => {
  await act(async () => { fireEvent.press(r.getByTestId('roman-composer-send')); });
};
const sendAgain = async (r: Awaited<ReturnType<typeof open>>) => {
  await waitFor(() => expect(r.getByTestId('roman-send-retry')).toBeTruthy());
  await act(async () => { fireEvent.press(r.getByTestId('roman-send-retry')); });
};

it.each([
  ['no answer', NO_ANSWER],
  ['a timeout', TIMEOUT],
  ['a 5xx', SERVER_DOWN],
  ['a cut stream after the 200', CUT_STREAM],
])('Send again after %s sends the same words with the same key', async (_label, failure) => {
  wire = [failure, OK];
  const r = await open();
  await fireEvent.changeText(r.getByTestId(INPUT), 'Swap my Thursday run for a ride?');
  await sendFrom(r);
  expect(boxOf(r)).toBe('Swap my Thursday run for a ride?');
  await sendAgain(r);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(sent(1)).toEqual(sent(0));
  expect(sent(0).content).toBe('Swap my Thursday run for a ride?');
  await waitFor(() => expect(boxOf(r)).toBe(''));
});

it.each([
  ['no answer', NO_ANSWER],
  ['a cut stream', CUT_STREAM],
])('LS-953 B2: retrying a quick-start chip after %s keeps its key while another draft is in the box', async (_label, failure) => {
  wire = [failure, OK];
  const r = await open();
  await fireEvent.changeText(r.getByTestId(INPUT), 'My separate unfinished question');
  await act(async () => { fireEvent.press(r.getByTestId('roman-quick-start-0')); });
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  expect(boxOf(r)).toBe('My separate unfinished question');
  await act(async () => { fireEvent.press(r.getByTestId('roman-quick-start-0')); });
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  const first = sent(0);
  const retry = sent(1);
  expect(retry.content).toBe(first.content);
  expect(retry.key).toBe(first.key);
  expect(boxOf(r)).toBe('My separate unfinished question');
});

it('a chip kept aside keeps its key after the typed draft is sent and after leaving; its own answer ends it', async () => {
  wire = [NO_ANSWER, OK, OK, OK];
  const a = await open();
  await fireEvent.changeText(a.getByTestId(INPUT), 'My separate unfinished question');
  await act(async () => { fireEvent.press(a.getByTestId('roman-quick-start-0')); });
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  await sendFrom(a);
  await waitFor(() => expect(boxOf(a)).toBe(''));
  const { key } = sent(0);
  await waitFor(() => expect(mockDisk.get(`${CHAT_DRAFT_KEY_PREFIX}client-1:roman`)).toContain(key));
  await a.unmount();
  const b = await open();
  await act(async () => { fireEvent.press(b.getByTestId('roman-quick-start-0')); });
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  expect(sent(2)).toEqual(sent(0));
  expect(sent(1).key).not.toBe(key);
  await waitFor(() => expect(mockDisk.get(`${CHAT_DRAFT_KEY_PREFIX}client-1:roman`)).toBeUndefined());
  await act(async () => { fireEvent.press(b.getByTestId('roman-quick-start-0')); });
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
  expect(sent(3).content).toBe(sent(0).content);
  expect(sent(3).key).not.toBe(key);
});

it('a chip that fails beside a failed typed draft leaves the draft its own key', async () => {
  wire = [NO_ANSWER, NO_ANSWER, OK, OK];
  const r = await open();
  await fireEvent.changeText(r.getByTestId(INPUT), 'My separate unfinished question');
  await sendFrom(r);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  await act(async () => { fireEvent.press(r.getByTestId('roman-quick-start-0')); });
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(boxOf(r)).toBe('My separate unfinished question');
  await sendFrom(r);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  await act(async () => { fireEvent.press(r.getByTestId('roman-quick-start-0')); });
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
  expect(sent(2)).toEqual(sent(0));
  expect(sent(3)).toEqual(sent(1));
  expect(sent(1).key).not.toBe(sent(0).key);
});

it('new words after a failed send are a new key', async () => {
  wire = [NO_ANSWER, OK];
  const r = await open();
  await fireEvent.changeText(r.getByTestId(INPUT), 'Swap my Thursday run?');
  await sendFrom(r);
  await fireEvent.changeText(r.getByTestId(INPUT), 'Swap my Friday run?');
  await sendFrom(r);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(sent(1).key).not.toBe(sent(0).key);
});

it.each([
  ['a 400', REFUSED_400],
  ['a 409', REUSED_409],
  ['a coded no-reply frame after the stream opened', NO_REPLY_FRAME],
])('after %s the same words sent again are a new key', async (_label, failure) => {
  wire = [failure, OK];
  const r = await open();
  await fireEvent.changeText(r.getByTestId(INPUT), 'Swap my Thursday run for a ride?');
  await sendFrom(r);
  expect(boxOf(r)).toBe('Swap my Thursday run for a ride?');
  await sendAgain(r);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(sent(1).key).not.toBe(sent(0).key);
});

it('a kept key ends when the replay answers with the coded no-reply frame: the next Send again asks once more', async () => {
  wire = [NO_ANSWER, NO_REPLY_FRAME, OK];
  const r = await open();
  await fireEvent.changeText(r.getByTestId(INPUT), 'Swap my Thursday run for a ride?');
  await sendFrom(r);
  await sendAgain(r);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  await sendAgain(r);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  expect(sent(1).key).toBe(sent(0).key);
  expect(sent(2).key).not.toBe(sent(1).key);
});

it('two separate sends of the same words ("ok" twice) get two keys', async () => {
  const r = await open();
  await fireEvent.changeText(r.getByTestId(INPUT), 'ok');
  await sendFrom(r);
  await waitFor(() => expect(boxOf(r)).toBe(''));
  await fireEvent.changeText(r.getByTestId(INPUT), 'ok');
  await sendFrom(r);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(sent(1).key).not.toBe(sent(0).key);
});

it('leaving after a failed send and coming back keeps the words and the key', async () => {
  wire = [NO_ANSWER, OK];
  const a = await open();
  await fireEvent.changeText(a.getByTestId(INPUT), 'Swap my Thursday run for a ride?');
  await sendFrom(a);
  const { key } = sent(0);
  await waitFor(() => expect(mockDisk.get(`${CHAT_DRAFT_KEY_PREFIX}client-1:roman`)).toContain(key));
  await a.unmount();
  const b = await open();
  expect(boxOf(b)).toBe('Swap my Thursday run for a ride?');
  await sendFrom(b);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(sent(1)).toEqual({ content: 'Swap my Thursday run for a ride?', key });
  await waitFor(() => expect(mockDisk.get(`${CHAT_DRAFT_KEY_PREFIX}client-1:roman`)).toBeUndefined());
});

it('LS-953R2 B1: reopening while the first answer is pending replays the kept draft key', async () => {
  let finishFirst!: (text: string) => void;
  const pendingBody = new Promise<string>((resolve) => { finishFirst = resolve; });
  fetchMock.mockImplementationOnce(async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: () => pendingBody,
  } as unknown as Response));

  const a = await open();
  await fireEvent.changeText(a.getByTestId(INPUT), 'Swap my Thursday run for a ride?');
  await sendFrom(a);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  expect(a.getByTestId('roman-composer-input').props.editable).toBe(false);
  const first = sent(0);
  // No answer has settled. Back/reopen retains the existing draft, not a new intent.
  await a.unmount();
  const b = await open();
  expect(boxOf(b)).toBe(first.content);
  await sendFrom(b);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  const retry = sent(1);
  // Settle the abandoned request so this test leaves no pending transport.
  await act(async () => { finishFirst(DONE('The first answer.')); });
  expect(retry).toEqual(first);
});

// FIX-953R3: the exact frame backend main f239683f sends a same-key resend while the first send may still store its
// reply (CONTRACT 6754738036; roman.controller.ts:307-309). The member sees the same stored line as for
// ROMAN_UNAVAILABLE; only the key differs: it stays with the words.
const { ROMAN_STORED_NO_REPLY } = require('../../../components/roman/romanVoice');
const REPLY_PENDING_FRAME: Wire = {
  status: 200,
  text: 'event: error\ndata: {"code":"ROMAN_REPLY_PENDING","message":"Roman is not available right now."}\n\n',
};

it('FIX-953R3: reopened while the first send is out, a "still being written" answer keeps the words and the key; Send again replays the stored answer', async () => {
  let loseFirst!: () => void;
  const firstBody = new Promise<string>((_resolve, reject) => {
    loseFirst = () => reject(new TypeError('Connection lost after the turn was stored'));
  });
  firstBody.catch(() => undefined);
  fetchMock.mockImplementationOnce(async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: () => firstBody,
  } as unknown as Response));
  wire = [REPLY_PENDING_FRAME, OK];

  const a = await open();
  await fireEvent.changeText(a.getByTestId(INPUT), 'Swap my Thursday run for a ride?');
  await sendFrom(a);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  const first = sent(0);
  await a.unmount(); // Back while the first send is still out
  const b = await open();
  expect(boxOf(b)).toBe(first.content);
  await sendFrom(b); // Roman is still writing the first answer
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(sent(1)).toEqual(first);
  await waitFor(() => expect(b.getByTestId('roman-send-retry')).toBeTruthy());
  expect(b.getByText(ROMAN_STORED_NO_REPLY)).toBeTruthy();
  expect(boxOf(b)).toBe(first.content);
  expect(mockDisk.get(`${CHAT_DRAFT_KEY_PREFIX}client-1:roman`)).toContain(first.key);
  await sendAgain(b); // the first answer is stored by now: the same key replays it
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  expect(sent(2)).toEqual(first);
  await waitFor(() => expect(boxOf(b)).toBe(''));
  // The abandoned first request ends with no answer only now; nothing more is sent.
  await act(async () => { loseFirst(); });
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

it('FIX-953R3: a quick-start chip beside a typed draft answered "still being written" keeps its key aside', async () => {
  wire = [CUT_STREAM, REPLY_PENDING_FRAME, OK];
  const r = await open();
  await fireEvent.changeText(r.getByTestId(INPUT), 'My separate unfinished question');
  await act(async () => { fireEvent.press(r.getByTestId('roman-quick-start-0')); });
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  await act(async () => { fireEvent.press(r.getByTestId('roman-quick-start-0')); });
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(sent(1)).toEqual(sent(0));
  expect(boxOf(r)).toBe('My separate unfinished question');
  await act(async () => { fireEvent.press(r.getByTestId('roman-quick-start-0')); });
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  expect(sent(2)).toEqual(sent(0));
  expect(boxOf(r)).toBe('My separate unfinished question');
});

// FIX-953R3: backend main f239683f tells the two apart (b#1233, CONTRACT 6754738036): a same-key resend whose first
// send may still store its reply answers the coded ROMAN_REPLY_PENDING frame (roman.controller.ts:307-309,
// roman-sse-error.ts:33-37, roman.service.ts:869-872); one that ended with no reply answers ROMAN_UNAVAILABLE, as
// before. The phone keeps the key on the pending code only, so this runs as a plain `it`.
it('LS-953R2 B2: Send again after an in-flight no-reply replay never creates a second stored turn', async () => {
  // Backend main f239683f roman.controller.ts:179-181,297-311: same key + a stored
  // user turn without a reply answers ROMAN_REPLY_PENDING while its first
  // send may still store the reply. A new key creates a new turn.
  const stored = new Map<string, string>();
  let firstKey: string | undefined;
  let firstReplyReady = false;
  fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
    const key = (init.headers as Record<string, string>)['Idempotency-Key'];
    const content = (JSON.parse(String(init.body)) as { content: string }).content;
    const replay = stored.has(key);
    if (!replay) stored.set(key, content);
    const initial = firstKey === undefined;
    if (initial) firstKey = key;
    const body = replay && key === firstKey && !firstReplyReady
      ? 'event: error\ndata: {"code":"ROMAN_REPLY_PENDING","message":"Roman is not available right now."}\n\n'
      : DONE('Swap it.');
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => {
        if (initial) throw new TypeError('Connection lost after the turn was stored');
        return body;
      },
    } as unknown as Response;
  });
  mockList.mockImplementation(async () => ({
    messages: [...stored].reverse().map(([id, content]) => ({
      id, role: 'user', content, interrupted: false, createdAt: '2026-11-07T06:00:00.000Z',
    })),
    nextCursor: null,
  }));

  const r = await open();
  await fireEvent.changeText(r.getByTestId(INPUT), 'Swap my Thursday run for a ride?');
  await sendFrom(r); // first turn stored; phone loses the buffered stream
  await sendAgain(r); // replay arrives while the first answer is still pending
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(sent(1)).toEqual(sent(0));
  expect(stored.size).toBe(1);
  // The first answer can finish before the next tap: there is no tight race
  // at the third send. The visible Send again action and unchanged draft remain.
  firstReplyReady = true;
  expect(boxOf(r)).toBe('Swap my Thursday run for a ride?');
  await sendAgain(r);
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(stored.size).toBe(1);
});
