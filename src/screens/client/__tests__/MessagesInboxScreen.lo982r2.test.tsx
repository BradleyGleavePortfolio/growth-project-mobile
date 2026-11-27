/**
 * LO-982R2 B-TEST B1 (Opus lens, agent 204): m#982 @ 96e847c7, the coached coach card on the phone. The PR lets the unread
 * ring move under a long coach name (PLAN H1/H2: the name keeps whole) by putting the identity group and the ring in one
 * wrapping row. On iOS and Android that row is laid out by Yoga (React Native 0.85, ReactCommon/yoga), not by a browser:
 * - Yoga's single-flex-child shortcut (yoga/algorithm/CalculateLayout.cpp:553-571): in a row of exact width, when exactly one
 *   child is flexible and it has both flexGrow and flexShrink, its flex basis is set to 0. The identity group
 *   (s.top + s.coachWho: grow 1, shrink 1) is that child, so the row never wraps: the ring always sits beside the name and
 *   the name gets what is left (190 pt at 390, 160 at 360, 120 at 320).
 * - React Native lays out with YGErrataAll (react/renderer/components/view/YogaLayoutableShadowNode.cpp:604), which includes
 *   StretchFlexBasis (CalculateLayout.cpp:1534-1552): a row measured for its basis stretches a growing child to the full
 *   width, so a growing who column (flex: 1) inside the identity row would put the ring under even "Sam".
 * With the drawn 32 pt name and the 44 pt ring, names main kept whole break mid-word on the phone, e.g. "Christopher" at
 * 390/393 pt with larger text and "Massimiliano" (the PLAN's own fixture) at 360 pt. Web previews (react-native-web in
 * Chromium) do wrap the ring, so the renders do not show it. Both rules below are Yoga's, read from the shipped source.
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
jest.mock('../../../components/ai/useOpenSupport', () => ({ useOpenSupport: () => jest.fn() }));
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

const cases = [['Massimiliano', 360, 1], ['Christopher', 390, 1.3], ['Mohammadreza', 390, 1], [null, 360, 1]] as const;

it.each(cases)('on the phone the unread ring can move under a long coach name so the name stays whole (name %s, %s pt, text %s)', async (name, width, fontScale) => {
  mockGet.mockImplementation(async (u: string) => {
    if (u === '/messages/unread-count') return { data: { total: 2 } };
    if (u === '/v1/clients/me/coach' && name) return { data: { id: 'coach-9', name } };
    throw Object.assign(new Error(`GET ${u} failed`), { response: { status: 503 } });
  });
  mockInbox.mockResolvedValue({ items: [thread(2)], next_cursor: null, total_unread: 2 });
  const d = { width, height: 844, scale: 3, fontScale };
  Dimensions.set({ window: d, screen: d });
  const u = await render(<MessagesInboxScreen navigation={{ navigate: jest.fn(), goBack: jest.fn() } as never} />);
  await act(async () => { await Promise.resolve(); });
  const label = name ?? 'Message your coach';
  const all = chains(u.toJSON());
  const ring = all.find((c) => c.node.props?.testID === 'inbox-unread')!;
  expect(ring).toBeDefined();
  const wrapRow = ring.up[ring.up.length - 1];
  expect(style(wrapRow)).toMatchObject({ flexDirection: 'row', flexWrap: 'wrap' });
  const kids = (wrapRow.children as Node[]).filter((k) => k && typeof k === 'object');
  // Rule 1 (CalculateLayout.cpp:553-571): no lone grow-and-shrink child, or its basis is 0 and the row never wraps.
  const flexible = kids.filter((k) => grow(style(k)) !== 0 || shrink(style(k)) !== 0);
  const lone = flexible.length === 1 && grow(style(flexible[0])) !== 0 && shrink(style(flexible[0])) !== 0;
  expect(lone).toBe(false);
  // Rule 2 (StretchFlexBasis, CalculateLayout.cpp:1534-1552): inside the identity group no row has a growing child.
  const identity = kids.find((k) => textOf(k).includes(label))!;
  expect(identity).toBeDefined();
  const growingInRow = chains(identity).filter(({ node, up }) => up.length > 0 && style(up[up.length - 1]).flexDirection === 'row' && grow(style(node)) !== 0);
  expect(growingInRow.map(({ node }) => textOf(node))).toEqual([]);
});
