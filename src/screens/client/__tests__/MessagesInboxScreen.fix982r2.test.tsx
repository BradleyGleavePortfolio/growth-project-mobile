/**
 * FIX-982R2 class test (agent 203): every row client Messages draws with flexWrap 'wrap', in every state, against the two
 * rules the phone's layout engine (Yoga, React Native 0.85.3) applies and a browser does not. LO-982R2 B1: the coach
 * card's wrapping row held one child that both grew and shrank, so on the phone the unread ring never moved under a long
 * coach name and the name broke inside the word.
 * - Rule 1 (ReactCommon/yoga/yoga/algorithm/CalculateLayout.cpp:553-571): in a row of exact width, a lone flexible child
 *   with both grow and shrink gets a flex basis of 0, so the row never wraps.
 * - Rule 2 (the same file :1534-1552 with React Native's YGErrataAll, YogaLayoutableShadowNode.cpp:604): a row measured for
 *   its basis stretches a growing child to the full width, so anything growing inside the coach's identity group would
 *   push the ring under even a short name.
 * Grow and shrink are resolved as Yoga does (yoga/node/Node.cpp:426-453). These assertions pin the structure Yoga needs;
 * they do not lay anything out. The mocks are the LO-982R2 B-TEST's (MessagesInboxScreen.lo982r2.test.tsx), with Contact
 * support made switchable.
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
const mockNeedsCoach = jest.fn(() => false);
jest.mock('../../../components/coachless/JoinCoachState', () => ({
  JOIN_A_COACH: 'Join a coach',
  ROMAN_LOCK_TITLE: 'Roman works with a coach',
  ROMAN_LOCK_BODY: "Roman reads your plan and a coach's guidance, so he is available once you join a coach. Your own logging stays open.",
  useClientNeedsCoach: () => mockNeedsCoach(),
}));
jest.mock('../../../entitlements/EntitlementProvider', () => ({ useEntitlement: () => ({ messageCoach: jest.fn() }) }));
const mockSupport = jest.fn((): (() => void) | null => jest.fn());
jest.mock('../../../components/ai/useOpenSupport', () => ({ useOpenSupport: () => mockSupport() }));
jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => require('react').createElement(require('react-native').Text, { testID: `icon-${name}` }),
}));
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useFocusEffect: (cb: () => void | (() => void)) => jest.requireActual('react').useEffect(() => cb(), [cb]),
}));

import MessagesInboxScreen from '../MessagesInboxScreen';


const OFFLINE = { ok: false, failure: { reason: 'offline' } };
const thread = (unread: number): InboxThread => ({
  thread_id: 't1', kind: 'coach_client', coach_id: 'coach-9', client_id: 'client-1',
  counterpart: { user_id: 'coach-9', display_name: 'Sam Carter' },
  last_message: { id: 'm1', sender_id: 'coach-9', is_mine: false, kind: 'text', preview: 'Yes, move it to Friday.', created_at: '2026-10-15T18:03:00.000Z', edited: false },
  unread_count: unread, muted: false, muted_until: null, pinned: false, blocked_by_me: false, last_activity_at: '2026-10-15T18:03:00.000Z',
});
type Node = { type?: string; props?: Record<string, unknown> & { style?: StyleProp<ViewStyle> }; children?: unknown };
const style = (n: Node) => (StyleSheet.flatten(n.props?.style) ?? {}) as Record<string, unknown>;
const textOf = (n: Node): string => (Array.isArray(n.children) ? n.children.map((c) => (typeof c === 'string' ? c : textOf(c as Node))).join('') : '');
/** Every node with its parent chain (root first). */
function chains(node: unknown, up: Node[] = [], out: { node: Node; up: Node[] }[] = []) {
  if (Array.isArray(node)) { node.forEach((n) => chains(n, up, out)); return out; }
  if (node === null || typeof node !== 'object') return out;
  const n = node as Node;
  out.push({ node: n, up });
  if (Array.isArray(n.children)) n.children.forEach((c) => chains(c, [...up, n], out));
  return out;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRoman.mockReturnValue(true);
  mockNeedsCoach.mockReturnValue(false);
  mockList.mockResolvedValue(OFFLINE);
});

const REAL = { window: Dimensions.get('window'), screen: Dimensions.get('screen') };
afterAll(() => Dimensions.set(REAL));

/** Yoga's resolved flex factors (yoga/node/Node.cpp:426-453, React Native's non-web defaults). */
const num = (v: unknown) => (typeof v === 'number' ? v : undefined);
const grow = (st: Record<string, unknown>) => num(st.flexGrow) ?? ((num(st.flex) ?? 0) > 0 ? (num(st.flex) as number) : 0);
const shrink = (st: Record<string, unknown>) => num(st.flexShrink) ?? ((num(st.flex) ?? 0) < 0 ? -(num(st.flex) as number) : 0);

type Case = { state: 'coached' | 'closed' | 'coachless' | 'loading'; name: string | null; unread: number; width: number; fontScale: number; support: boolean };
const SIZES = [320, 360, 375, 390, 393].flatMap((width) => [1, 1.3].map((fontScale) => ({ width, fontScale })));
const table: Case[] = [
  // coached, the coach card open: the name read failed (null), a short name, the lens's long names; read and unread 2, 12, 99+
  ...[null, 'Sam', 'Christopher', 'Massimiliano', 'Mohammadreza'].flatMap((name) =>
    SIZES.flatMap((sz) => [0, 2, 12, 120].map((unread): Case => ({ state: 'coached', name, unread, support: true, ...sz })))),
  // the other states that draw (or do not draw) a wrapping row
  ...SIZES.flatMap((sz): Case[] => [
    { state: 'closed', name: 'Sam', unread: 2, support: true, ...sz },
    { state: 'coachless', name: null, unread: 0, support: true, ...sz },
    { state: 'coachless', name: null, unread: 0, support: false, ...sz },
    { state: 'loading', name: null, unread: 0, support: true, ...sz },
  ]),
];
/** How many rows wrap in each state: the coach row and Roman's; Roman's; the two no-coach buttons; none. */
const WRAP_ROWS = { coached: 2, closed: 1, coachless: 1, loading: 0 };

it.each(table)('every wrapping row can wrap on the phone, and the coach row keeps the name whole ($state, name $name, $width pt, text $fontScale, unread $unread, support $support)', async ({ state, name, unread, width, fontScale, support }) => {
  mockNeedsCoach.mockReturnValue(state === 'coachless');
  mockSupport.mockReturnValue(support ? jest.fn() : null);
  mockGet.mockImplementation((u: string) => {
    if (state === 'loading') return new Promise(() => undefined); // no read answers yet
    if (u === '/messages/unread-count') return Promise.resolve({ data: { total: unread } });
    if (u === '/me/roman/usage') return Promise.resolve({ data: { used: { messages: 64 }, limits: { messages: 100 } } });
    if (u === '/v1/clients/me/coach' && name) return Promise.resolve({ data: { id: 'coach-9', name } });
    return Promise.reject(Object.assign(new Error(`GET ${u} failed`), { response: { status: 503 } }));
  });
  mockInbox.mockImplementation(() => (state === 'loading' ? new Promise(() => undefined)
    : Promise.resolve({ items: [{ ...thread(unread), closed: state === 'closed' }], next_cursor: null, total_unread: unread })));
  const d = { width, height: 844, scale: 3, fontScale };
  Dimensions.set({ window: d, screen: d });
  const u = await render(<MessagesInboxScreen navigation={{ navigate: jest.fn(), goBack: jest.fn() } as never} />);
  await act(async () => { await Promise.resolve(); });
  const all = chains(u.toJSON());
  const kidsOf = (n: Node) => (Array.isArray(n.children) ? (n.children as Node[]).filter((k) => k && typeof k === 'object') : []);

  // The class: every row drawn with flexWrap 'wrap'. Rule 1: none holds a lone child that both grows and shrinks.
  const wrapRows = all.filter((c) => style(c.node).flexWrap === 'wrap').map((c) => c.node);
  expect(wrapRows).toHaveLength(WRAP_ROWS[state]);
  for (const row of wrapRows) {
    expect(style(row).flexDirection).toBe('row');
    const flexible = kidsOf(row).filter((k) => grow(style(k)) !== 0 || shrink(style(k)) !== 0);
    const lone = flexible.length === 1 && grow(style(flexible[0])) !== 0 && shrink(style(flexible[0])) !== 0;
    expect({ row: textOf(row), lone }).toEqual({ row: textOf(row), lone: false });
  }
  expect(u.queryByTestId('inbox-coach') !== null).toBe(state === 'coached' || state === 'coachless');
  if (state !== 'coached') return;

  // The coach row: the identity group and the ring are its only children.
  const label = name ?? 'Message your coach';
  const title = all.find((c) => c.node.type === 'Text' && textOf(c.node) === label)!;
  expect(title).toBeDefined();
  const who = title.up[title.up.length - 1];
  const group = title.up[title.up.length - 2];
  const coachRow = title.up[title.up.length - 3];
  expect(wrapRows).toContain(coachRow);
  expect(kidsOf(coachRow)).toHaveLength(unread > 0 ? 2 : 1);
  // Rule 2: the group and everything in it resolve to grow 0, so the group measures as wide as the monogram and the name.
  expect(chains(group).filter(({ node }) => grow(style(node)) !== 0).map(({ node }) => textOf(node))).toEqual([]);
  // The group and the name column may shrink, so a label wider than the card wraps inside it instead of running off it.
  expect([shrink(style(group)), shrink(style(who))]).toEqual([1, 1]);
  // Round 1, kept: the monogram and the name share a row that does not wrap.
  expect(style(group).flexDirection).toBe('row');
  expect(style(group).flexWrap).not.toBe('wrap');
  expect(style(kidsOf(group)[0])).toMatchObject({ width: 48, height: 48 });
  expect(kidsOf(group)[1]).toBe(who);
  // The ring is outside the group, a child of the wrapping row, and keeps marginLeft 'auto' (at the right, beside or under).
  const ring = all.find((c) => c.node.props?.testID === 'inbox-unread');
  expect(ring !== undefined).toBe(unread > 0);
  if (ring) {
    expect(ring.up[ring.up.length - 1]).toBe(coachRow);
    expect(chains(group).some(({ node }) => node === ring.node)).toBe(false);
    expect(style(ring.node)).toMatchObject({ marginLeft: 'auto', minWidth: 44 });
  }
});
