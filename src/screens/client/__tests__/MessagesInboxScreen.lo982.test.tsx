/**
 * LO-982 B-TEST (Opus lens, agent 204): the coached coach card at m#982 @ 5144cc73. When the coach-name read
 * (/v1/clients/me/coach) fails, as it does on a cold offline open, the card says "Message your coach". At the head the
 * monogram, the who column and the ring share one wrapping row (s.top + s.wrapTop, who flexBasis auto), so a who column
 * wider than the space beside the monogram drops under it (renders: 320/360 at 100%, 390 at 130%). Only the ring may
 * wrap: the monogram and the who column must sit in a row that does not wrap.
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

it.each([[2], [0]])('the coach card keeps the monogram and "Message your coach" on one row when the name read fails (unread %s)', async (unread) => {
  mockGet.mockImplementation(async (u: string) => {
    if (u === '/messages/unread-count') return { data: { total: unread } };
    if (u === '/me/roman/usage') return { data: { used: { messages: 64 }, limits: { messages: 100 } } };
    throw Object.assign(new Error(`GET ${u} failed`), { response: { status: 503 } }); // the coach-name read fails
  });
  mockInbox.mockResolvedValue({ items: [thread(unread)], next_cursor: null, total_unread: unread });
  const d = { width: 360, height: 800, scale: 2, fontScale: 1 };
  Dimensions.set({ window: d, screen: d });
  const u = await render(<MessagesInboxScreen navigation={{ navigate: jest.fn(), goBack: jest.fn() } as never} />);
  await act(async () => { await Promise.resolve(); });
  expect(u.getByText('Message your coach')).toBeTruthy();
  const all = chains(u.toJSON());
  const name = all.find((c) => c.node.type === 'Text' && textOf(c.node) === 'Message your coach');
  expect(name).toBeDefined();
  // The who column is the name's parent; the row that holds it beside the monogram is the who column's parent.
  const row = name!.up[name!.up.length - 2];
  expect(style(row).flexDirection).toBe('row');
  expect(textOf(row)).not.toContain('Yes, move it to Friday.'); // the row, not the card
  expect(style(row).flexWrap).not.toBe('wrap');
});
