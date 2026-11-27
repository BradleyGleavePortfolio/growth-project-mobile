/**
 * FIX-982R3 class test ([R24]) for LO-982R3 B1, operator ruling (2): the coach's first name on the Messages card must not
 * break inside the word on the phone wherever main (8efe38e0) kept it whole, at every iPhone width and iOS Larger Text step
 * (react-native React/CoreModules/RCTAccessibilityManager.mm:259-270, plus the 1.24 and 1.3 rows of the earlier rounds and
 * [R41]) and at common Android widths and font scales.
 * The class is every place m#982 lays out a coach or client name in a size it chose (git grep at FIX-982R3's head; FIX ROUND 3
 * lists the search): only the coach card's name line, MessagesInboxScreen.tsx:273 (or "Message your coach" when the name read
 * fails), whose face the 32 / 24 pt rule at :189 picks. The monogram's one initial (:268), the privacy line (:309) and Create
 * account's coach-name lines (CreateAccountScreen.tsx:1257, :1289, :1548-1549) keep main's styles byte for byte; Sign in,
 * Forgot password and AuthStyleB lay out no coach or client name.
 * Widths (LO-982R3, TextKit on the app's own font files): "Mohammadreza", PLAN H1's own example and the widest one-word name
 * in the rounds' fixtures, is 6.307 em in CormorantGaramond_500Medium with letterSpacing 0, as this PR draws it. main drew it
 * in CormorantGaramond_400Regular at 24 pt with letterSpacing 0.5: 150.55 pt of glyphs at 24 pt plus 12 x 0.5 (iOS leaves
 * letterSpacing unscaled, RCTAttributedTextUtils.mm:191-192; Android scales it with the text).
 * Room: window - 144 for the name (24 pt gutters, 18 pt card padding, the 48 pt monogram and its 12 pt gap), with or without
 * the ring at this head (the ring moves under: FIX-982R2, fix982r2.test.tsx); main's was the same with nothing unread and
 * 52 pt less with a ring, so "main kept it whole" below is read with nothing unread, its widest case.
 * The test reads the size the screen picks; it measures no text, and the screen measures no name (PLAN H1).
 */
import React from 'react';
import { act, render } from '@testing-library/react-native';
import { Dimensions, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import type { InboxThread } from '../../../api/messagingV2Api';

const mockRoman = jest.fn(() => true);
jest.mock('../../../config/featureFlags', () => ({ featureFlags: { get romanChat() { return mockRoman(); } } }));
jest.mock('../../../theme/ThemeProvider', () => ({ useTheme: () => ({
  colors: new Proxy({}, { get: () => '#000000' }),
  semanticColors: jest.requireActual('../../../theme/tokens').lightTokens,
  tokens: jest.requireActual('../../../theme/tokens').default,
}) }));
jest.mock('../../../ui/haptics/haptics.service', () => ({ HapticService: { selection: jest.fn(), softImpact: jest.fn() } }));
jest.mock('../../../services/sentry', () => ({ captureError: jest.fn() }));
const mockGet = jest.fn();
jest.mock('../../../services/api', () => ({ __esModule: true, default: { get: (u: string) => mockGet(u) } }));
const mockInbox = jest.fn();
jest.mock('../../../api/messagingV2Api', () => ({ messagingV2Api: { getClientInbox: () => mockInbox() } }));
const mockList = jest.fn();
jest.mock('../../../api/romanChatsApi', () => ({
  ROMAN_CHATS_MAX_LIMIT: 100,
  romanChatsApi: { list: (...a: unknown[]) => mockList(...a), readMessages: jest.fn() },
}));
jest.mock('../../../services/accountBinding', () => ({
  captureAccountBinding: async () => ({ subject: 'client-1', epoch: 1 }),
  bindingIsCurrent: () => true,
}));
jest.mock('../../../hooks/useFeatureFlags', () => ({ useFeatureFlags: () => ({ flags: { messaging_core_v2: true } }) }));
jest.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => false }));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => null }));
jest.mock('../../../components/coachless/JoinCoachState', () => ({
  JOIN_A_COACH: 'Join a coach',
  ROMAN_LOCK_TITLE: 'Roman works with a coach',
  ROMAN_LOCK_BODY: "Roman reads your plan and a coach's guidance, so he is available once you join a coach. Your own logging stays open.",
  useClientNeedsCoach: () => false,
}));
jest.mock('../../../entitlements/EntitlementProvider', () => ({ useEntitlement: () => ({ messageCoach: jest.fn() }) }));
jest.mock('../../../components/ai/useOpenSupport', () => ({ useOpenSupport: () => jest.fn() }));
jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => require('react').createElement(require('react-native').Text, { testID: `icon-${name}` }),
}));
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useFocusEffect: (cb: () => void | (() => void)) => jest.requireActual('react').useEffect(() => cb(), [cb]),
}));

import MessagesInboxScreen from '../MessagesInboxScreen';

const NAME = 'Mohammadreza';
const thread = (unread: number): InboxThread => ({
  thread_id: 't1', kind: 'coach_client', coach_id: 'coach-9', client_id: 'client-1',
  counterpart: { user_id: 'coach-9', display_name: NAME },
  last_message: { id: 'm1', sender_id: 'coach-9', is_mine: false, kind: 'text', preview: 'Yes, move it to Friday.', created_at: '2026-10-15T18:03:00.000Z', edited: false },
  unread_count: unread, muted: false, muted_until: null, pinned: false, blocked_by_me: false, last_activity_at: '2026-10-15T18:03:00.000Z',
});
type Node = { type?: string; props?: Record<string, unknown> & { style?: StyleProp<ViewStyle> }; children?: unknown };
const style = (n: Node) => (StyleSheet.flatten(n.props?.style) ?? {}) as Record<string, unknown>;
const textOf = (n: Node): string => (Array.isArray(n.children) ? n.children.map((c) => (typeof c === 'string' ? c : textOf(c as Node))).join('') : '');
function nodes(node: unknown, out: Node[] = []): Node[] {
  if (Array.isArray(node)) { node.forEach((n) => nodes(n, out)); return out; }
  if (node === null || typeof node !== 'object') return out;
  const n = node as Node;
  out.push(n);
  if (Array.isArray(n.children)) n.children.forEach((c) => nodes(c, out));
  return out;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRoman.mockReturnValue(true);
  mockList.mockResolvedValue({ ok: false, failure: { reason: 'offline' } });
});

const REAL = { window: Dimensions.get('window'), screen: Dimensions.get('screen') };
afterAll(() => Dimensions.set(REAL));

/** This head's face: em width in CormorantGaramond_500Medium.ttf, letterSpacing 0 (TextKit, LO-982R3). */
const EM_500 = 6.307;
/** main's face: the glyphs at 24 pt in CormorantGaramond_400Regular.ttf (TextKit, LO-982R3), before its 0.5 letterSpacing. */
const MAIN_GLYPHS_24 = 150.55;
const IOS_WIDTHS = [320, 360, 375, 390, 393, 402, 414, 428, 430, 440];
const IOS_STEPS = [0.823, 0.882, 0.941, 1, 1.118, 1.235, 1.24, 1.3, 1.353, 1.786, 2.143, 2.643, 3.143, 3.571];
const ANDROID_WIDTHS = [360, 384, 393, 411, 412];
const ANDROID_SCALES = [0.85, 1, 1.15, 1.3, 1.5, 1.8, 2];

type Os = 'ios' | 'android';
type Cell = readonly [Os, number, number];
const universe: Cell[] = [
  ...IOS_WIDTHS.flatMap((w) => IOS_STEPS.map((f) => ['ios', w, f] as const)),
  ...ANDROID_WIDTHS.flatMap((w) => ANDROID_SCALES.map((f) => ['android', w, f] as const)),
];
const room = ([, w]: Cell) => w - 144;
const mainDrawn = ([os, , f]: Cell) => MAIN_GLYPHS_24 * f + NAME.length * 0.5 * (os === 'android' ? f : 1);
const mainWhole = (c: Cell) => mainDrawn(c) <= room(c);
// PLAN H1's ruled bound (LO-982R3 C1, graded C, the operator's call): the 32 pt face is kept where window width / text size
// is at least 320 (320 pt at 100% is on the owner's approved sheet), and there a 6.3 em one-word name is wider than its room.
// Every one is narrower than 390 pt. Nothing else may break where main was whole.
const H1_BOUND = ['ios 320 0.882', 'ios 320 0.941', 'ios 320 1', 'ios 360 1.118'];
const key = ([os, w, f]: Cell) => `${os} ${w} ${f}`;
const inClass = universe.filter((c) => mainWhole(c) && !H1_BOUND.includes(key(c)));
const bound = universe.filter((c) => H1_BOUND.includes(key(c)));

async function nameStyle(width: number, fontScale: number) {
  mockGet.mockImplementation(async (u: string) => {
    if (u === '/messages/unread-count') return { data: { total: 2 } };
    if (u === '/v1/clients/me/coach') return { data: { id: 'coach-9', name: NAME } };
    throw Object.assign(new Error(`GET ${u} failed`), { response: { status: 503 } });
  });
  mockInbox.mockResolvedValue({ items: [thread(2)], next_cursor: null, total_unread: 2 });
  const d = { width, height: 844, scale: 3, fontScale };
  Dimensions.set({ window: d, screen: d });
  const u = await render(<MessagesInboxScreen navigation={{ navigate: jest.fn(), goBack: jest.fn() } as never} />);
  await act(async () => { await Promise.resolve(); });
  const name = nodes(u.toJSON()).find((n) => n.type === 'Text' && textOf(n) === NAME);
  expect(name).toBeDefined();
  const st = style(name!);
  u.unmount();
  return st;
}

it('the class holds ruling (2)\'s four B1 cells; H1\'s listed bound is four cells under 390 pt where main was whole', () => {
  for (const b1 of ['ios 390 1.235', 'ios 390 1.24', 'ios 393 1.235', 'ios 393 1.24']) expect(inClass.map(key)).toContain(b1);
  expect(bound.map(key)).toEqual(H1_BOUND);
  expect(bound.every(mainWhole)).toBe(true);
  expect(bound.every(([, w]) => w < 390)).toBe(true);
});

it.each(inClass)('class: "Mohammadreza" stays whole on the coach card wherever main kept it whole (%s, %s pt, text %s)', async (os, width, fontScale) => {
  const st = await nameStyle(width, fontScale);
  expect(st.fontFamily).toBe('CormorantGaramond_500Medium');
  expect(Number(st.letterSpacing ?? 0)).toBe(0);
  expect(EM_500 * Number(st.fontSize) * fontScale).toBeLessThanOrEqual(room([os, width, fontScale]));
});

it.each(bound)('PLAN H1\'s ruled bound, listed (LO-982R3 C1): the 32 pt face is kept (%s, %s pt, text %s)', async (os, width, fontScale) => {
  const st = await nameStyle(width, fontScale);
  expect(st).toMatchObject({ fontFamily: 'CormorantGaramond_500Medium', fontSize: 32 });
  expect(width / fontScale).toBeGreaterThanOrEqual(320);
  expect(os).toBe('ios');
});
