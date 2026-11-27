/**
 * LO-982R3 B-TEST B1 (Opus lens, agent 203): m#982 @ 63dcd41d, operator ruling (2) (FIX-982R2's text :50): the one-word coach
 * name that breaks inside the word at 124% text on a 390 or 393 pt iPhone. iOS's xxLarge Larger Text step is 1.235
 * (react-native React/CoreModules/RCTAccessibilityManager.mm:265); the builder's and round 2's 124% rows read 1.24.
 * The name's room beside the monogram is window - 144: 48 for the Screen gutters (src/ui/layout/Screen.tsx:164, tokens.ts:307),
 * 36 for the card's padding (MessagesInboxScreen.tsx:328) and 60 for the 48 pt monogram and its 12 pt gap (:331, :345). The
 * shipped Yoga gives the name column exactly that room at this head with or without the ring (LO-982R3's run of
 * node_modules/react-native/ReactCommon/yoga), and iOS breaks a word that is wider than its line (RCTTextLayoutManager.mm:227-236).
 * "Mohammadreza" (PLAN H1's own example) is 6.307 em in the app's CormorantGaramond_500Medium.ttf with letterSpacing 0, as the name
 * draws (:341), measured with TextKit from that file. At 32 pt and 1.235 that is 249.25 pt: wider than 246 and 249, so the phone
 * draws "Mohammadrez / a". main (8efe38e0) drew the name in the 24 pt face and kept it whole in all eight rows below.
 * The rule is on the size :187 picks for the window width and text size; it never measures a name (PLAN H1).
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

const thread = (unread: number): InboxThread => ({
  thread_id: 't1', kind: 'coach_client', coach_id: 'coach-9', client_id: 'client-1',
  counterpart: { user_id: 'coach-9', display_name: 'Mohammadreza' },
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

/** em width in the shipped CormorantGaramond_500Medium.ttf, letterSpacing 0 (TextKit, LO-982R3). */
const EM_500 = 6.307;
const cases = [390, 393].flatMap((w) => [1.235, 1.24].flatMap((f) => [0, 2].map((u) => [w, f, u] as const)));

it.each(cases)('ruling (2): the name size keeps "Mohammadreza" whole beside the monogram (%s pt, text %s, unread %s)', async (width, fontScale, unread) => {
  mockGet.mockImplementation(async (u: string) => {
    if (u === '/messages/unread-count') return { data: { total: unread } };
    if (u === '/v1/clients/me/coach') return { data: { id: 'coach-9', name: 'Mohammadreza' } };
    throw Object.assign(new Error(`GET ${u} failed`), { response: { status: 503 } });
  });
  mockInbox.mockResolvedValue({ items: [thread(unread)], next_cursor: null, total_unread: unread });
  const d = { width, height: 844, scale: 3, fontScale };
  Dimensions.set({ window: d, screen: d });
  const u = await render(<MessagesInboxScreen navigation={{ navigate: jest.fn(), goBack: jest.fn() } as never} />);
  await act(async () => { await Promise.resolve(); });
  const name = nodes(u.toJSON()).find((n) => n.type === 'Text' && textOf(n) === 'Mohammadreza');
  expect(name).toBeDefined();
  const st = style(name!);
  expect(st.fontFamily).toBe('CormorantGaramond_500Medium');
  expect(Number(st.letterSpacing ?? 0)).toBe(0);
  const drawn = EM_500 * Number(st.fontSize) * fontScale;
  expect(drawn).toBeLessThanOrEqual(width - 144);
});
