/**
 * ROMAN-PENDING-WORDS-M: while Roman is still writing the answer, the Roman room (client and coach, one screen) shows
 * a true line for that one answer instead of "could not answer". At the wire: the real RomanChatScreen, the real
 * useRomanChat and the real sendMessage; only `fetch` (the send) and the session reads are stubbed, as in
 * RomanSendOnce.test.tsx. The frame is the server's exact bytes (backend main 1462408a roman-sse-error.ts:34-37,
 * written by replayTurn at roman.controller.ts:311). Every other answer draws exactly what it drew before.
 */
import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';

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
  openOrResumeSession: async (surface: string) => ({ id: 'sess-1', surface, messageCount: 0 }),
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
// Required, not imported, so this file type-checks before the new line exists (its red run is at the assertions).
const voice = require('../../../components/roman/romanVoice');
const STORED: string = voice.ROMAN_HELD_NO_ANSWER;
const STILL: string = voice.ROMAN_HELD_NOT_READY;

type Wire = { throws: Error } | { status: number; text?: string | Error };
const frame = (code: string, extra = ''): Wire => ({
  status: 200,
  text: `event: error\ndata: {"code":"${code}","message":"Roman is not available right now."${extra}}\n\n`,
});
const DONE = (text: string) => `data: {"type":"delta","text":"${text}"}\n\ndata: {"type":"done","text":"${text}","messageId":"m-reply-1","interrupted":false}\n\n`;
const PENDING = frame('ROMAN_REPLY_PENDING');
const UNAVAILABLE = frame('ROMAN_UNAVAILABLE');
const CUT_STREAM: Wire = { status: 200, text: new TypeError('Network request failed') };
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
const keyOf = (n: number): string => (fetchMock.mock.calls[n][1].headers as Record<string, string>)['Idempotency-Key'];
const wordsOf = (n: number): string => (JSON.parse(String(fetchMock.mock.calls[n][1].body)) as { content: string }).content;

beforeEach(async () => {
  wire = [];
  fetchMock.mockClear();
  global.fetch = fetchMock as unknown as typeof fetch;
  mockList.mockReset().mockResolvedValue({ messages: [], nextCursor: null });
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  jest.mocked(AccessibilityInfo.announceForAccessibility).mockClear(); // jest-expo's mock: spyOn keeps its calls
  authEvents.emit('logout');
  await waitFor(() => expect([...mockDisk.keys()]).toEqual([]));
});
afterEach(() => {
  global.fetch = realFetch;
  jest.restoreAllMocks();
});

const INPUT = 'roman-composer-input';
const WORDS = 'Swap my Thursday run for a ride?';
const DRAFT_KEY = `${CHAT_DRAFT_KEY_PREFIX}client-1:roman`;
type Screen = Awaited<ReturnType<typeof render>>;
const open = async (surface: 'client' | 'coach'): Promise<Screen> => {
  const r = await render(<RomanChatScreen surface={surface} />);
  await waitFor(() => expect(r.getByTestId(INPUT)).toBeTruthy());
  return r;
};
const boxOf = (r: Screen): string => r.getByTestId(INPUT).props.value;
const sendFrom = async (r: Screen) => {
  await act(async () => { fireEvent.press(r.getByTestId('roman-composer-send')); });
};
const sendAgain = async (r: Screen) => {
  await waitFor(() => expect(r.getByTestId('roman-send-retry')).toBeTruthy());
  await act(async () => { fireEvent.press(r.getByTestId('roman-send-retry')); });
};
/** The words on the send-error row (not its Send again label), or null when no row is drawn. */
const rowLine = (r: Screen): string | null => {
  const row = r.queryByTestId('roman-send-error');
  if (!row) return null;
  const lines = within(row).queryAllByText(/.+/)
    .map((t) => t.props.children)
    .filter((c: unknown): c is string => typeof c === 'string' && c !== 'Send again');
  return lines[0] ?? null;
};
/** Whether `line` is drawn anywhere on the screen (false for a line that does not exist yet). */
const shows = (r: Screen, line: string | undefined): boolean => typeof line === 'string' && r.queryByText(line) != null;
const announced = (line: string): number =>
  jest.mocked(AccessibilityInfo.announceForAccessibility).mock.calls.filter(([s]) => s === line).length;

/** Cases 1 and 2, then 3: the first send's stream is cut after the 200, Send again gets the exact frame. */
describe.each(['client', 'coach'] as const)('the %s Roman room', (surface) => {
  it('Send again answered "still being written" shows the true line with Send again, and keeps the words and the key; then the stored answer shows and nothing more is sent', async () => {
    wire = [CUT_STREAM, PENDING, OK];
    const r = await open(surface);
    await fireEvent.changeText(r.getByTestId(INPUT), WORDS);
    await sendFrom(r);
    await waitFor(() => expect(rowLine(r)).toBe(STORED)); // a cut stream: the phone cannot tell, today's line
    await sendAgain(r);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(r.getByTestId('roman-send-retry')).toBeTruthy());
    expect(rowLine(r)).toBe(STILL);
    expect(shows(r, STORED)).toBe(false);
    expect(announced(STILL)).toBe(1); // spoken once, the same words
    expect(boxOf(r)).toBe(WORDS);
    expect(keyOf(1)).toBe(keyOf(0));
    expect(mockDisk.get(DRAFT_KEY)).toContain(keyOf(0));
    // Case 3: the first answer is stored by now; the same key replays it.
    mockList.mockResolvedValue({
      messages: [
        { id: 'm-reply-1', role: 'assistant', content: 'Swap it.', interrupted: false, createdAt: '2026-11-10T09:00:01.000Z' },
        { id: 'm-turn-1', role: 'user', content: WORDS, interrupted: false, createdAt: '2026-11-10T09:00:00.000Z' },
      ],
      nextCursor: null,
    });
    await sendAgain(r);
    await waitFor(() => expect(boxOf(r)).toBe(''));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(keyOf(2)).toBe(keyOf(0));
    expect(wordsOf(2)).toBe(WORDS);
    expect(r.queryByTestId('roman-send-error')).toBeNull();
    expect(shows(r, STILL)).toBe(false);
    expect(r.getAllByText('Swap it.').length).toBeGreaterThan(0);
    expect(mockDisk.get(DRAFT_KEY)).toBeUndefined();
  });

  it('reopened while the first send is still out: the exact frame shows the true line, never "could not answer"', async () => {
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
    wire = [PENDING];
    const a = await open(surface);
    await fireEvent.changeText(a.getByTestId(INPUT), WORDS);
    await sendFrom(a);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await a.unmount();
    const b = await open(surface);
    expect(boxOf(b)).toBe(WORDS);
    await sendFrom(b);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(b.getByTestId('roman-send-retry')).toBeTruthy());
    expect(rowLine(b)).toBe(STILL);
    expect(shows(b, STORED)).toBe(false);
    expect(keyOf(1)).toBe(keyOf(0));
    expect(boxOf(b)).toBe(WORDS);
    await act(async () => { loseFirst(); });
  });

  it('case 4: then Send again gets ROMAN_UNAVAILABLE: "could not answer" shows, and the next Send again asks once more under a new key', async () => {
    wire = [CUT_STREAM, PENDING, UNAVAILABLE, OK];
    const r = await open(surface);
    await fireEvent.changeText(r.getByTestId(INPUT), WORDS);
    await sendFrom(r);
    await sendAgain(r); // the exact frame
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await sendAgain(r); // ROMAN_UNAVAILABLE: the first send ended with no reply (or the server's bound passed)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(rowLine(r)).toBe(STORED));
    expect(shows(r, STILL)).toBe(false);
    expect(keyOf(2)).toBe(keyOf(0));
    await sendAgain(r);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(keyOf(3)).not.toBe(keyOf(0));
    expect(wordsOf(3)).toBe(WORDS);
  });
});

/** Case 5: not the exact code, each on a first send: today's "could not answer" line, as before. */
it.each([
  ['the code in lower case', frame('roman_reply_pending')],
  ['the code with a suffix', frame('ROMAN_REPLY_PENDING_V2')],
  ['an unknown code', frame('ROMAN_SOMETHING_NEW')],
  ['ROMAN_UNAVAILABLE on a first send', UNAVAILABLE],
  ['a cut stream', CUT_STREAM],
  ['the pending frame with a third field (wire drift)', frame('ROMAN_REPLY_PENDING', ',"retry":true')],
])('case 5: %s draws "could not answer", never the still-writing line', async (_label, answer) => {
  wire = [answer];
  const r = await open('client');
  await fireEvent.changeText(r.getByTestId(INPUT), WORDS);
  await sendFrom(r);
  await waitFor(() => expect(r.getByTestId('roman-send-retry')).toBeTruthy());
  expect(rowLine(r)).toBe(STORED);
  expect(shows(r, STILL)).toBe(false);
});

/** Case 7: every other line is unchanged (refusal, daily cap and the AI-help grant: aiRefusalClientSurfaces.test.tsx). */
it.each([
  ['not stored (a 5xx)', { status: 500, text: '{"error":"internal"}' } as Wire, voice.ROMAN_HELD_NOT_SENT, true],
  ['rate limited', { status: 429, text: '' } as Wire, voice.romanRateLimited(undefined), false],
  ['pool empty', frame('COACH_AI_BUDGET_EXHAUSTED'), voice.romanPoolEmpty('client'), false],
])('case 7: %s draws its own line, as before', async (_label, answer, line, retry) => {
  wire = [answer];
  const r = await open('client');
  await fireEvent.changeText(r.getByTestId(INPUT), WORDS);
  await sendFrom(r);
  await waitFor(() => expect(rowLine(r)).toBe(line));
  expect(r.queryByTestId('roman-send-retry') != null).toBe(retry);
  expect(shows(r, STILL)).toBe(false);
});

it('case 8: each line is announced once when it appears, not again on a re-render; each answer after a Send again (which clears the row while it sends) is announced once, as before', async () => {
  wire = [CUT_STREAM, PENDING, PENDING, UNAVAILABLE];
  const say = jest.mocked(AccessibilityInfo.announceForAccessibility);
  const since = (mark: number): string[] => say.mock.calls.slice(mark).map(([line]) => String(line));
  const r = await open('client');
  await fireEvent.changeText(r.getByTestId(INPUT), WORDS);
  await sendFrom(r);
  await waitFor(() => expect(rowLine(r)).toBe(STORED));
  expect(since(0)).toEqual([STORED]);
  let mark = say.mock.calls.length;
  await sendAgain(r); // the exact frame
  await waitFor(() => expect(since(mark)).toHaveLength(1));
  const pending = rowLine(r);
  expect(since(mark)).toEqual([pending]);
  mark = say.mock.calls.length;
  await act(async () => { r.rerender(<RomanChatScreen surface="client" />); });
  expect(since(mark)).toEqual([]);
  await sendAgain(r); // the exact frame again
  await waitFor(() => expect(since(mark)).toHaveLength(1));
  expect(since(mark)).toEqual([pending]);
  expect(rowLine(r)).toBe(pending);
  mark = say.mock.calls.length;
  await sendAgain(r); // ROMAN_UNAVAILABLE
  await waitFor(() => expect(rowLine(r)).toBe(STORED));
  expect(since(mark)).toEqual([STORED]);
});

it('case 9: typing in the box clears the line drawn for the exact frame', async () => {
  wire = [CUT_STREAM, PENDING];
  const r = await open('client');
  await fireEvent.changeText(r.getByTestId(INPUT), WORDS);
  await sendFrom(r);
  await sendAgain(r);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(r.getByTestId('roman-send-error')).toBeTruthy());
  await act(async () => { fireEvent.changeText(r.getByTestId(INPUT), `${WORDS} Or a swim?`); });
  expect(r.queryByTestId('roman-send-error')).toBeNull();
});
