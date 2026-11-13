/**
 * ROMAN-RETRY-B-M (owner #203-E41, 203-D13 op B "Roman's place, held"; GOAL ctx#520 planning/ROMAN-RETRY-C frames/B):
 * when a send to Roman gets no answer, or Roman cannot answer now, his answer turn is drawn at once as a cream card with
 * a gold left edge, his face, his words in italic Cormorant and, where the state has it, Send again under them; in the
 * room it sits where his answer would be (after the last turn, in the list) and on Path Copilot it takes the stored
 * card's place. The interrupted note gets a short gold rule.
 *
 * One table over every state a B frame draws: the real RomanChatScreen (client and coach) through the real useRomanChat
 * and romanApi's real sendMessage over a stubbed `fetch` (as RomanSendOnce.test.tsx), and the real
 * ClientPathCopilotScreen through romanApi's real sendMessage and RomanApiError with only openOrResumeSession stubbed
 * (as copilotPendingWords.test.tsx). Every error comes from the wire, never built by hand.
 */
import React from 'react';
import { AccessibilityInfo, Dimensions, FlatList, ScrollView, StyleSheet, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

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
jest.mock('../../../services/api', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
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
jest.mock('../../../config/featureFlags', () => ({
  featureFlags: { ...jest.requireActual('../../../config/featureFlags').featureFlags, clientPathCopilot: true, coachAiCredits: true },
}));
jest.mock('../../../utils/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('../../../services/sentry', () => ({ captureError: jest.fn(), setSentryUser: jest.fn() }));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'client-1', firstName: 'Maya' }) }));
jest.mock('../../../hooks/useCoachlessClient', () => ({ useCoachlessClient: () => false }));
jest.mock('../../../lib/userCache', () => ({ readUserCacheSync: () => ({ id: 'client-1', role: 'student' }) }));
jest.mock('../../../api/schedulingApi', () => ({ resolveClientTimezone: () => 'UTC' }));
jest.mock('../../../hooks/useCalendar', () => ({ useMyCoaches: () => ({ data: [{ name: 'Alex Rivera' }] }) }));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: jest.fn(), navigate: jest.fn() }),
  useRoute: () => ({ params: undefined }),
  NavigationContext: jest.requireActual('react').createContext(null),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@expo-google-fonts/cormorant-garamond', () => ({ CormorantGaramond_400Regular_Italic: 1, useFonts: () => [true, null] }));
jest.mock('../../../components/roman/RomanAvatar', () => () => null);
jest.mock('../../../components/ai/useOpenSupport', () => ({ useOpenSupport: () => jest.fn() }));
jest.mock('../../../components/roman/RomanConsentGate', () => ({ children }: { children?: React.ReactNode }) => children ?? null);
jest.mock('../../../components/StatusBarBand', () => ({ ForestStatusBar: () => null }));
jest.mock('../../../ui/haptics/haptics.service', () => ({ HapticService: { success: jest.fn(), error: jest.fn(), softImpact: jest.fn(), selection: jest.fn() } }));
jest.mock('../../../components/roman/RomanCrisisActions', () => ({ __esModule: true, default: () => null }));
jest.mock('../../../components/coachless/JoinCoachState', () => ({
  __esModule: true, default: () => null, useClientNeedsCoach: () => false,
  ROMAN_LOCK_TITLE: 'Roman works with a coach', ROMAN_LOCK_BODY: 'lock body', JOIN_A_COACH: 'Join a coach',
}));
// The coach's buy links are drawn by main's component, unchanged; here they only mark where they sit and their inset.
jest.mock('../../../components/coach/credits/CreditPoolEmptyLinks', () => {
  const { View: V } = jest.requireActual('react-native');
  return { __esModule: true, default: ({ inset }: { inset?: number }) => <V testID="roman-pool-empty-buy" style={{ paddingLeft: inset }} /> };
});

const RomanChatScreen = require('../RomanChatScreen').default;
const ClientPathCopilotScreen = require('../../client/ClientPathCopilotScreen').default;
const api = require('../../../services/api').default;
const { authEvents } = require('../../../utils/authEvents');
const { forestPop, colors, lightTokens, spacing, typography } = require('../../../theme/tokens');
// Required, not imported, so this file type-checks before the new lines exist (its red run is at the assertions).
const voice = require('../../../components/roman/romanVoice');

// The B words (approved, operator, #203-E15), word for word.
const W8 = 'I could not answer this one.';
const W9 = 'My answer is not ready yet.';
const W10 = 'That did not go through. Your words are still in the box.';
const W11 = 'I could not answer this one. Send it again from the box to ask once more.';
const W12 = 'My answer is not ready yet. Send it again in a moment to see if it is ready.';
const ITALIC = 'CormorantGaramond_400Regular_Italic';

type Wire = { throws: Error } | { status: number; text?: string | Error; retryAfter?: string } | { gate: Promise<void>; then: Wire };
const frame = (code: string): Wire => ({
  status: 200,
  text: `event: error\ndata: {"code":"${code}","message":"Roman is not available right now."}\n\n`,
});
const DONE = (text: string) => `data: {"type":"delta","text":"${text}"}\n\ndata: {"type":"done","text":"${text}","messageId":"m-reply-1","interrupted":false}\n\n`;
const COPILOT_DONE = 'data: {"type":"done","text":"Friday works.","messageId":"m-1","interrupted":false,"copilot":{"sources":[],"suggestion":null}}\n\n';
const PENDING = frame('ROMAN_REPLY_PENDING');
const UNAVAILABLE = frame('ROMAN_UNAVAILABLE');
const CUT_STREAM: Wire = { status: 200, text: new TypeError('Network request failed') };
const NO_ANSWER: Wire = { throws: new TypeError('Network request failed') };
const SERVER_5XX: Wire = { status: 500, text: '{"error":"internal"}' };
const RATE_LIMITED: Wire = { status: 429, text: '', retryAfter: '30' };
const POOL_EMPTY: Wire = { status: 402, text: '{"statusCode":402,"code":"COACH_AI_BUDGET_EXHAUSTED","message":"used up"}' };
const DAILY_CAP: Wire = { status: 429, text: '{"statusCode":429,"code":"ROMAN_RATE_LIMIT","message":"cap"}' };
const REFUSED_HTTP: Wire = { status: 403, text: '{"statusCode":403,"code":"ai_consent_required","message":"off"}' };
const OK: Wire = { status: 200, text: DONE('Swap it.') };

const realFetch = global.fetch;
let wire: Wire[] = [];
let fallback: Wire = OK;
const fetchMock = jest.fn(async (_url: string, _init: RequestInit) => {
  let next = wire.shift() ?? fallback;
  if ('gate' in next) { await next.gate; next = next.then; }
  if ('gate' in next) throw new Error('one gate per answer');
  if ('throws' in next) throw next.throws;
  const body = next.text;
  return {
    ok: next.status >= 200 && next.status < 300,
    status: next.status,
    headers: { get: (h: string) => (h.toLowerCase() === 'retry-after' ? next.retryAfter ?? null : null) },
    text: async () => { if (body instanceof Error) throw body; return body ?? ''; },
  } as unknown as Response;
});
const keyOf = (n: number): string => (fetchMock.mock.calls[n][1].headers as Record<string, string>)['Idempotency-Key'];
const wordsOf = (n: number): string => (JSON.parse(String(fetchMock.mock.calls[n][1].body)) as { content: string }).content;

/** The thread the server holds, newest first (listMessages' order); set before the send whose re-read reads it. */
type Msg = { id: string; role: 'user' | 'assistant'; content: string; interrupted: boolean; createdAt: string };
let thread: Msg[] = [];
const turn = (id: string, role: Msg['role'], content: string, interrupted = false): Msg =>
  ({ id, role, content, interrupted, createdAt: '2026-11-12T09:00:00.000Z' });
const EARLIER = [turn('m-a0', 'assistant', 'Keep Thursday easy.'), turn('m-q0', 'user', 'Can I swap Thursday?')];

let scrolledWithCard: boolean[] = [];
let current: Awaited<ReturnType<typeof render>> | null = null;

beforeEach(async () => {
  wire = [];
  fallback = OK;
  thread = [];
  scrolledWithCard = [];
  current = null;
  fetchMock.mockClear();
  global.fetch = fetchMock as unknown as typeof fetch;
  mockList.mockReset().mockImplementation(async () => ({ messages: thread, nextCursor: null }));
  jest.mocked(api.get).mockResolvedValue({ data: { week: WEEK, suggestions: [] } } as never);
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  jest.mocked(AccessibilityInfo.announceForAccessibility).mockClear();
  // Which of today's scroll triggers brings the card into view: record whether it was drawn at each scrollToEnd.
  jest.spyOn(FlatList.prototype, 'scrollToEnd').mockImplementation(() => {
    scrolledWithCard.push(current?.queryByTestId('roman-send-error') != null || current?.queryByTestId('roman-ask-again') != null);
  });
  authEvents.emit('logout');
  await waitFor(() => expect([...mockDisk.keys()]).toEqual([]));
});
afterEach(() => {
  global.fetch = realFetch;
  jest.restoreAllMocks();
});

type Screen = Awaited<ReturnType<typeof render>>;
const INPUT = 'roman-composer-input';
const WORDS = 'Can I swap my Thursday run for a bike ride this week?';
const LONG = "Can I swap my Thursday run for a bike ride this week? My knee felt tight after Tuesday, and I would rather keep the legs fresh for Saturday's long run with the club.";

const openRoom = async (surface: 'client' | 'coach'): Promise<Screen> => {
  const r = await render(<RomanChatScreen surface={surface} />);
  current = r;
  await waitFor(() => expect(r.getByTestId(INPUT)).toBeTruthy());
  return r;
};
const typeAndSend = async (r: Screen, words: string) => {
  await fireEvent.changeText(r.getByTestId(INPUT), words);
  await act(async () => { fireEvent.press(r.getByTestId('roman-composer-send')); });
};
const boxOf = (r: Screen): string => r.getByTestId(INPUT).props.value;
const style = (node: { props: { style?: unknown } }): TextStyle & ViewStyle =>
  StyleSheet.flatten(node.props.style as StyleProp<TextStyle & ViewStyle>) ?? {};
const announced = (line: string): number =>
  jest.mocked(AccessibilityInfo.announceForAccessibility).mock.calls.filter(([s]) => s === line).length;

/** The B card: the gold edge on the page fill, the line in Roman's italic, Send again (or not), the dots (or not). */
const expectCard = (r: Screen, id: string, line: string, o: { sendAgain: boolean; dots: boolean }) => {
  const card = r.getByTestId(id);
  const look = style(card);
  expect(look.borderLeftColor).toBe(forestPop.gold);
  expect(look.borderLeftWidth).toBe(3);
  expect(look.backgroundColor).toBe(lightTokens.bgSurface);
  const text = within(card).getByText(line);
  expect(style(text).fontFamily).toBe(ITALIC);
  expect(style(text).color).toBe(lightTokens.textPrimary);
  expect(within(card).queryByTestId(`${id}-dots`) != null).toBe(o.dots);
  const again = within(card).queryByTestId('roman-send-retry');
  expect(again != null).toBe(o.sendAgain);
  if (again) {
    expect(again.props.accessibilityLabel).toBe('Send again');
    expect(within(again).getByText('Send again')).toBeTruthy();
  }
  return card;
};
/** The card sits in the list, right after the last turn (and before "loading older"), never as a row under the list. */
const expectAfterLastTurn = (r: Screen, id: string, lastTurnId: string) => {
  const list = r.getByTestId('roman-message-list');
  expect(within(list).getByTestId(id)).toBeTruthy();
  const order = r.getAllByTestId(new RegExp(`^(roman-message-${lastTurnId}|${id}|roman-pool-empty-buy)$`)).map((n) => n.props.testID);
  expect(order.indexOf(id)).toBeGreaterThan(order.indexOf(`roman-message-${lastTurnId}`));
  expect(order.indexOf(`roman-message-${lastTurnId}`)).toBeGreaterThanOrEqual(0);
};
/** The box's ceiling while a card shows: two of body's lines at the window's text size, plus the input's padding. */
const twoLines = (): number => Math.round(2 * typography.body.lineHeight * Dimensions.get('window').fontScale) + 2 * spacing.md;
const mainCeiling = (): number => Math.max(120, Math.round(Dimensions.get('window').height * 0.3));
const growBox = async (r: Screen, height: number) => {
  await act(async () => {
    fireEvent(r.getByTestId(INPUT), 'contentSizeChange', { nativeEvent: { contentSize: { width: 300, height } } });
  });
};

describe('the words', () => {
  it('are the approved B lines, each in romanVoice.ts', () => {
    expect(voice.ROMAN_HELD_NO_ANSWER).toBe(W8);
    expect(voice.ROMAN_HELD_NOT_READY).toBe(W9);
    expect(voice.ROMAN_HELD_NOT_SENT).toBe(W10);
    expect(voice.ROMAN_HELD_NO_ANSWER_COPILOT).toBe(W11);
    expect(voice.ROMAN_HELD_NOT_READY_COPILOT).toBe(W12);
  });
});

/** Cases 1, 2, 4, 13: a stored question with no answer, or one still being written, on both rooms. */
describe.each([
  ['S1 client, stored, no answer', 'client', UNAVAILABLE, W8, false],
  ['S1 client, a cut stream after the 200', 'client', CUT_STREAM, W8, false],
  ['S2 client, still being written (the exact ROMAN_REPLY_PENDING frame)', 'client', PENDING, W9, true],
  // Case 13: a stored turn whose reply is fixed text (the server's fixed-reply pending mark, backend 9251b4eb
  // roman.constants.ts:90-97) answers a same-key resend with the same frame: the phone draws W9, no other words.
  ['S2 coach, the fixed-reply pending mark (same frame)', 'coach', PENDING, W9, true],
  ['S4 coach, stored, no answer', 'coach', UNAVAILABLE, W8, false],
] as const)('%s', (_label, surface, answer, line, dots) => {
  it('draws Roman\'s card after the stored question, in the list, with Send again; the box keeps to two lines', async () => {
    const r = await openRoom(surface);
    thread = [turn('m-q1', 'user', WORDS)];
    wire = [answer];
    await typeAndSend(r, WORDS);
    await waitFor(() => expect(r.queryByTestId('roman-send-error')).toBeTruthy());
    const card = expectCard(r, 'roman-send-error', line, { sendAgain: true, dots });
    expect(card.props.accessibilityRole).toBe('alert');
    expect(card.props.accessibilityLiveRegion).toBe('assertive');
    expectAfterLastTurn(r, 'roman-send-error', 'm-q1');
    // It came into view through today's triggers: the send's end (sending -> false) scrolled with the card drawn,
    // and the list's content-size event (the footer grew) scrolls again.
    expect(scrolledWithCard).toContain(true);
    const before = scrolledWithCard.length;
    await act(async () => { fireEvent(r.getByTestId('roman-message-list'), 'contentSizeChange', 390, 2000); });
    expect(scrolledWithCard.length).toBeGreaterThan(before);
    expect(scrolledWithCard[scrolledWithCard.length - 1]).toBe(true);
    expect(announced(line)).toBe(1);
    expect(boxOf(r)).toBe(WORDS);
    if (surface === 'coach') expect(r.queryByTestId('roman-quick-starts')).toBeNull();
    await growBox(r, 400);
    expect(style(r.getByTestId(INPUT)).height).toBe(twoLines());
    expect(r.getByTestId(INPUT).props.scrollEnabled).toBe(true);
    // Nothing is sent again on its own.
    await act(async () => { await new Promise((res) => setTimeout(res, 20)); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('S3, not stored', () => {
  it('draws the card at the end of the conversation, the words still in the box', async () => {
    thread = EARLIER;
    const r = await openRoom('client');
    wire = [SERVER_5XX];
    await typeAndSend(r, WORDS);
    await waitFor(() => expect(r.queryByTestId('roman-send-error')).toBeTruthy());
    expectCard(r, 'roman-send-error', W10, { sendAgain: true, dots: false });
    expectAfterLastTurn(r, 'roman-send-error', 'm-a0');
    expect(boxOf(r)).toBe(WORDS);
    expect(scrolledWithCard).toContain(true);
  });

  it('on an empty thread (the first send never stored) draws the card under the greeting, scrolled into view', async () => {
    const scrolled = jest.spyOn(ScrollView.prototype, 'scrollToEnd').mockImplementation(() => undefined);
    const r = await openRoom('client');
    // With no card the empty room is main's: the greeting in a plain view, nothing to scroll.
    expect(r.getByTestId('roman-empty-greeting')).toBeTruthy();
    expect(r.queryByTestId('roman-empty-scroll')).toBeNull();
    wire = [NO_ANSWER];
    await typeAndSend(r, WORDS);
    await waitFor(() => expect(r.queryByTestId('roman-send-error')).toBeTruthy());
    expectCard(r, 'roman-send-error', W10, { sendAgain: true, dots: false });
    expect(r.queryByTestId('roman-message-list')).toBeNull();
    const order = r.getAllByTestId(/^(roman-empty-greeting|roman-send-error)$/).map((n) => n.props.testID);
    expect(order).toEqual(['roman-empty-greeting', 'roman-send-error']);
    // At iPhone 320 with 130% text the greeting alone fills the room: the card sits in a scroll under it, and the
    // scroll's content-size event brings it into view (the list's own trigger is a no-op on an empty thread).
    const scroll = r.getByTestId('roman-empty-scroll');
    expect(within(scroll).getByTestId('roman-empty-greeting')).toBeTruthy();
    expect(within(scroll).getByTestId('roman-send-error')).toBeTruthy();
    await act(async () => { fireEvent(scroll, 'contentSizeChange', 320, 900); });
    expect(scrolled).toHaveBeenCalled();
    expect(boxOf(r)).toBe(WORDS);
  });
});

describe('S7, long text', () => {
  it('the box keeps to two lines and scrolls inside; the words are whole', async () => {
    const r = await openRoom('client');
    thread = [turn('m-q1', 'user', LONG)];
    wire = [CUT_STREAM, PENDING];
    await typeAndSend(r, LONG);
    await waitFor(() => expect(r.queryByTestId('roman-send-retry')).toBeTruthy());
    await act(async () => { fireEvent.press(r.getByTestId('roman-send-retry')); });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(r.queryByTestId('roman-send-error-dots')).toBeTruthy());
    expectCard(r, 'roman-send-error', W9, { sendAgain: true, dots: true });
    await growBox(r, 3 * twoLines());
    expect(style(r.getByTestId(INPUT)).height).toBe(twoLines());
    expect(r.getByTestId(INPUT).props.scrollEnabled).toBe(true);
    expect(boxOf(r)).toBe(LONG);
  });
});

/** Case 8: no Send again; each line word for word in the card. */
describe.each([
  ['S8a rate limited', 'client', RATE_LIMITED, () => voice.romanRateLimited(30)],
  ['S8c client used up', 'client', POOL_EMPTY, () => voice.romanPoolEmpty('client')],
  ['S8d coach used up, the buy links under the card', 'coach', POOL_EMPTY, () => voice.romanPoolEmpty('coach')],
] as const)('%s', (_label, surface, answer, line) => {
  it('draws the line in Roman\'s card at the end of the conversation, with no Send again', async () => {
    thread = EARLIER;
    const r = await openRoom(surface);
    wire = [answer];
    await typeAndSend(r, WORDS);
    await waitFor(() => expect(r.queryByTestId('roman-send-error')).toBeTruthy());
    expectCard(r, 'roman-send-error', line(), { sendAgain: false, dots: false });
    expectAfterLastTurn(r, 'roman-send-error', 'm-a0');
    if (surface === 'coach') {
      // The money lines are main's component with main's inset, right after the card, in the conversation.
      const links = within(r.getByTestId('roman-message-list')).getByTestId('roman-pool-empty-buy');
      expect(style(links).paddingLeft).toBe(spacing.xl + 28 + spacing.sm);
      const order = r.getAllByTestId(/^(roman-send-error|roman-pool-empty-buy)$/).map((n) => n.props.testID);
      expect(order).toEqual(['roman-send-error', 'roman-pool-empty-buy']);
    } else {
      expect(r.queryByTestId('roman-pool-empty-buy')).toBeNull();
    }
    expect(announced(line())).toBe(1);
  });
});

describe('S8b, after AI help is allowed for a stored message', () => {
  it('draws ROMAN_AI_ON_ASK_AGAIN in the card, polite, no Send again, and sends nothing', async () => {
    const r = await openRoom('coach');
    thread = [turn('m-q1', 'user', WORDS)];
    wire = [frame('ai_consent_required')];
    await typeAndSend(r, WORDS);
    await waitFor(() => expect(r.queryByTestId('roman-ai-refusal-retry')).toBeTruthy());
    await act(async () => { fireEvent.press(r.getByTestId('roman-ai-refusal-retry')); });
    await waitFor(() => expect(r.queryByTestId('roman-ask-again')).toBeTruthy());
    const card = expectCard(r, 'roman-ask-again', voice.ROMAN_AI_ON_ASK_AGAIN, { sendAgain: false, dots: false });
    expect(card.props.accessibilityLiveRegion).toBe('polite');
    expectAfterLastTurn(r, 'roman-ask-again', 'm-q1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('S9, the interrupted note', () => {
  it('a short gold rule, then the same note in Roman\'s italic, and the same spoken label', async () => {
    thread = [turn('m-a1', 'assistant', 'Yes. Keep Thursday easy', true), turn('m-q1', 'user', WORDS)];
    const r = await openRoom('client');
    const note = r.getByTestId('roman-message-m-a1-interrupted');
    const rule = style(r.getByTestId('roman-message-m-a1-interrupted-rule'));
    expect(rule.backgroundColor).toBe(forestPop.gold);
    expect(rule.width).toBe(spacing['3xl']);
    expect(rule.height).toBe(1);
    const words = within(note).getByText(voice.ROMAN_INTERRUPTED_NOTE);
    expect(style(words).fontFamily).toBe(ITALIC);
    expect(style(words).color).toBe(colors.charcoal);
    expect(r.getByTestId('roman-message-m-a1-reply').props.accessibilityLabel)
      .toBe(`Roman said: Yes. Keep Thursday easy ${voice.ROMAN_INTERRUPTED_NOTE}`);
    expect(r.queryByTestId('roman-send-error')).toBeNull();
  });
});

/** Case 10 is today's behaviour, green at the merge commit and at the head: it reads the line from the screen, not the B words. */
describe('case 10, Send again and the box', () => {
  it('re-sends the box\'s words under the draft\'s key and nothing else; typing clears the card and main\'s ceiling returns', async () => {
    const r = await openRoom('client');
    thread = [turn('m-q1', 'user', WORDS)];
    // A cut stream keeps the draft's key (lib/sendOnce.ts), so Send again replays it; ROMAN_UNAVAILABLE would end it.
    let release: () => void = () => undefined;
    const gate = new Promise<void>((res) => { release = res; });
    wire = [CUT_STREAM, { gate, then: CUT_STREAM }];
    await typeAndSend(r, WORDS);
    await waitFor(() => expect(r.queryByTestId('roman-send-retry')).toBeTruthy());
    expect(r.getByTestId('roman-send-retry').props.accessibilityState).toEqual({ disabled: false });
    await act(async () => { fireEvent.press(r.getByTestId('roman-send-retry')); });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    // While that send is out, Send again cannot be pressed: the card is gone (the send clears it) or disabled.
    const out = r.queryByTestId('roman-send-retry');
    expect(out == null || out.props.accessibilityState?.disabled === true).toBe(true);
    await act(async () => { release(); });
    expect(wordsOf(1)).toBe(WORDS);
    expect(keyOf(1)).toBe(keyOf(0));
    await waitFor(() => expect(r.queryByTestId('roman-send-retry')).toBeTruthy());
    // Announced once per appearance, the same line both times: the second answer is a new appearance.
    const said = jest.mocked(AccessibilityInfo.announceForAccessibility).mock.calls.map(([line]) => line);
    expect(said).toHaveLength(2);
    expect(said[1]).toBe(said[0]);
    await fireEvent.changeText(r.getByTestId(INPUT), `${WORDS} Thanks.`);
    expect(r.queryByTestId('roman-send-error')).toBeNull();
    await growBox(r, 400);
    expect(style(r.getByTestId(INPUT)).height).toBe(Math.min(400, mainCeiling()));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('case 11, pending and after', () => {
  it('pending, then Send again gets the stored reply: the card goes, the answer shows, the box empties, nothing more is sent', async () => {
    const r = await openRoom('client');
    thread = [turn('m-q1', 'user', WORDS)];
    wire = [PENDING, OK];
    await typeAndSend(r, WORDS);
    await waitFor(() => expect(r.queryByTestId('roman-send-error-dots')).toBeTruthy());
    expectCard(r, 'roman-send-error', W9, { sendAgain: true, dots: true });
    thread = [turn('m-reply-1', 'assistant', 'Swap it.'), turn('m-q1', 'user', WORDS)];
    await act(async () => { fireEvent.press(r.getByTestId('roman-send-retry')); });
    await waitFor(() => expect(boxOf(r)).toBe(''));
    expect(r.queryByTestId('roman-send-error')).toBeNull();
    expect(r.getAllByText('Swap it.').length).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(keyOf(1)).toBe(keyOf(0));
  });

  it('pending, then ROMAN_UNAVAILABLE: W8, no dots', async () => {
    const r = await openRoom('client');
    thread = [turn('m-q1', 'user', WORDS)];
    wire = [PENDING, UNAVAILABLE];
    await typeAndSend(r, WORDS);
    await waitFor(() => expect(r.queryByTestId('roman-send-error-dots')).toBeTruthy());
    await act(async () => { fireEvent.press(r.getByTestId('roman-send-retry')); });
    await waitFor(() => expect(r.queryByTestId('roman-send-error-dots')).toBeNull());
    expectCard(r, 'roman-send-error', W8, { sendAgain: true, dots: false });
  });

  it.each([
    ['lower case', frame('roman_reply_pending'), W8],
    ['a suffix', frame('ROMAN_REPLY_PENDING_LATER'), W8],
    ['an unknown code', frame('ROMAN_SOMETHING_NEW'), W8],
    ['a cut stream', CUT_STREAM, W8],
    ['not stored (a 5xx)', SERVER_5XX, W10],
  ] as const)('%s: today\'s turnStored picks W8 or W10, never W9', async (_label, answer, line) => {
    const r = await openRoom('client');
    thread = [turn('m-q1', 'user', WORDS)];
    wire = [answer];
    await typeAndSend(r, WORDS);
    await waitFor(() => expect(r.queryByTestId('roman-send-error')).toBeTruthy());
    expectCard(r, 'roman-send-error', line, { sendAgain: true, dots: false });
    expect(r.queryByText(W9)).toBeNull();
  });
});

describe('case 12, unchanged', () => {
  it('a refusal draws AiRefusalNotice, not the card', async () => {
    const r = await openRoom('client');
    wire = [REFUSED_HTTP];
    await typeAndSend(r, WORDS);
    await waitFor(() => expect(r.queryByTestId('roman-ai-refusal')).toBeTruthy());
    expect(r.queryByTestId('roman-send-error')).toBeNull();
  });

  it('the daily cap is the pop-up, not the card', async () => {
    const r = await openRoom('client');
    wire = [DAILY_CAP];
    await typeAndSend(r, WORDS);
    await waitFor(() => expect(r.queryByTestId('roman-daily-cap')).toBeTruthy());
    expect(r.queryByTestId('roman-send-error')).toBeNull();
  });
});

// ─── Path Copilot ────────────────────────────────────────────────────────────
const WEEK = { number: 3, coach_first_name: 'Alex', target: { kcal: 2150, from: new Date().toISOString(), previous_kcal: 2300 }, workouts: { done: 1, total: 4 }, last_check_in: '2026-10-18' };
const wrap = (ui: React.ReactElement) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>;
const QUESTION = 'Can I swap Thursday for Friday?';
const ask = async (answer: Wire): Promise<Screen> => {
  wire = [answer];
  fallback = { status: 200, text: COPILOT_DONE };
  const s = await render(wrap(<ClientPathCopilotScreen />));
  current = s;
  await act(async () => fireEvent.changeText(await s.findByPlaceholderText('Ask Roman anything.'), QUESTION));
  await act(async () => fireEvent.press(s.getByLabelText('Send message')));
  return s;
};

describe.each([
  ['S6a Copilot, stored', UNAVAILABLE, 'copilot-turn-unavailable', W11, false],
  ['S6a Copilot, stored (a code it does not know)', frame('ROMAN_SOMETHING_NEW'), 'copilot-turn-generic', W11, false],
  ['S6b Copilot, still being written', PENDING, 'copilot-turn-generic', W12, true],
] as const)('%s', (_label, answer, id, line, dots) => {
  it('draws Roman\'s card in place of the notice, no Send again and no Try again; the question back in the box', async () => {
    const s = await ask(answer);
    await waitFor(() => expect(s.queryByTestId(id)).toBeTruthy());
    const card = s.getByTestId(id);
    const look = style(card);
    expect(look.borderLeftColor).toBe(forestPop.gold);
    expect(look.backgroundColor).toBe(lightTokens.bgSurface);
    expect(card.props.accessibilityRole).toBe('alert');
    expect(card.props.accessibilityLiveRegion).toBe('polite');
    expect(style(within(card).getByText(line)).fontFamily).toBe(ITALIC);
    expect(within(card).queryByTestId(`${id}-dots`) != null).toBe(dots);
    expect(s.queryByText('Send again')).toBeNull();
    expect(s.queryByText('Try again')).toBeNull();
    expect(s.queryByTestId('copilot-retry')).toBeNull();
    expect(s.getByPlaceholderText('Ask Roman anything.').props.value).toBe(QUESTION);
  });
});

describe.each([
  ['offline', NO_ANSWER, 'copilot-turn-offline'],
  ['transient (a 5xx)', SERVER_5XX, 'copilot-turn-generic'],
] as const)('case 12, Copilot %s', (_label, answer, id) => {
  it('keeps RomanNotice with Try again', async () => {
    const s = await ask(answer);
    await waitFor(() => expect(s.queryByTestId(id)).toBeTruthy());
    expect(style(s.getByTestId(id)).borderLeftColor).not.toBe(forestPop.gold);
    expect(s.getByTestId('copilot-retry')).toBeTruthy();
  });
});

