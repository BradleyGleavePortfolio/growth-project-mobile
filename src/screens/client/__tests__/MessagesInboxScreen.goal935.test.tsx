/**
 * GOAL-935-M (agent 203, 203-D20 op 1): one round toward the picked C3 Style B drawings on client Messages. Each case
 * quotes the drawn CSS line it pins (handoffs/op-144/ops144/shots/MOCK-C3/html/B_inbox.html and B_coachless.html at
 * tgp-agent-context a9434a53) or the PNG rows where the PNG wins. Mounted with the same mocks as
 * MessagesInboxScreen.test.tsx, at 390 x 844 with fontScale 1 and at 320 x 568 with fontScale 1.3.
 */
import React from 'react';
import * as fs from 'fs';
import * as path from 'path';
import { act, render } from '@testing-library/react-native';
import { Dimensions, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { COMMUNITY_REPORT_CRISIS_LINE } from '../../../api/communitySafetyApi';
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

const tokens = jest.requireActual('../../../theme/tokens') as typeof import('../../../theme/tokens');
const OFFLINE = { ok: false, failure: { reason: 'offline' } };
const thread = (name: string, unread: number): InboxThread => ({
  thread_id: 't1', kind: 'coach_client', coach_id: 'coach-9', client_id: 'client-1',
  counterpart: { user_id: 'coach-9', display_name: name },
  last_message: { id: 'm1', sender_id: 'coach-9', is_mine: false, kind: 'text', preview: 'Yes, move it to Friday.', created_at: '2026-10-15T18:03:00.000Z', edited: false },
  unread_count: unread, muted: false, muted_until: null, pinned: false, blocked_by_me: false, last_activity_at: '2026-10-15T18:03:00.000Z',
});
const USAGE = { used: { messages: 64 }, limits: { messages: 100 } };
function serve(name = 'Sam Carter', unread = 2) {
  const routes: Record<string, unknown> = { '/v1/clients/me/coach': { id: 'coach-9', name }, '/messages/unread-count': { total: unread }, '/me/roman/usage': USAGE };
  mockGet.mockImplementation(async (u: string) => {
    if (!(u in routes)) throw Object.assign(new Error(`GET ${u} failed`), { response: { status: 404 } });
    return { data: routes[u] };
  });
  mockInbox.mockResolvedValue({ items: [thread(name, unread)], next_cursor: null, total_unread: unread });
}
type Style = Record<string, unknown>;
const flat = (el: { props: object }) => (StyleSheet.flatten((el.props as { style?: StyleProp<ViewStyle> }).style) ?? {}) as unknown as Style;
type Node = { props?: Record<string, unknown> & { style?: StyleProp<ViewStyle> }; children?: unknown };
const walk = (node: unknown, keep: (n: Node) => boolean, out: Node[] = []): Node[] => {
  if (Array.isArray(node)) { node.forEach((n) => walk(n, keep, out)); return out; }
  if (node === null || typeof node !== 'object') return out;
  const n = node as Node;
  if (keep(n)) out.push(n);
  walk(n.children, keep, out);
  return out;
};
const style = (n: Node) => (StyleSheet.flatten(n.props?.style) ?? {}) as Style;
const isRing = (n: Node) => style(n).borderWidth === 2 && style(n).padding === 2;

const REAL = { window: Dimensions.get('window'), screen: Dimensions.get('screen') };
const at = (width: number, height: number, fontScale: number) => {
  const d = { width, height, scale: 2, fontScale };
  Dimensions.set({ window: d, screen: d });
};
async function show(width = 390, height = 844, fontScale = 1) {
  at(width, height, fontScale);
  const u = await render(<MessagesInboxScreen navigation={{ navigate: jest.fn(), goBack: jest.fn() } as never} />);
  await act(async () => { await Promise.resolve(); });
  return u;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRoman.mockReturnValue(true);
  mockNeedsCoach.mockReturnValue(false);
  mockList.mockResolvedValue(OFFLINE);
  serve();
});
afterAll(() => Dimensions.set(REAL));

// The drawn faces (B_inbox.html, B_coachless.html at a9434a53). Serif line heights keep the app's B15 floor of 1.25 x the
// size (tokens.ts SERIF_MIN_LINE_RATIO, serifLineHeight.test.ts): 40 for 32 pt and 30 for 24 pt (drawn 36.8 and 28.8: KEPT).
const MEDIUM = { fontFamily: 'CormorantGaramond_500Medium', fontWeight: '500', letterSpacing: 0 };
const BIG_NAME = { ...MEDIUM, fontSize: 32, lineHeight: 40 };
const SMALL_NAME = { ...MEDIUM, fontSize: 24, lineHeight: 30 };

describe('GOAL-935-M M1 and H1: the coach name in the drawn face', () => {
  // B_inbox.html:77 `.b-hero .big{font:500 2rem/1.15 'Cormorant',serif;margin:4px 0}`; B_inbox_ios390_100.png rows 390-432
  // ("Sam" caps 21 pt tall = 32 pt Cormorant). H1 (REC): 32 pt wherever a 12-letter one-word name keeps whole (window
  // width / font scale >= 300), else typography.h2's 24/30 in the same 500 face; never numberOfLines or adjustsFontSizeToFit.
  it.each([
    [390, 844, 1, BIG_NAME],
    [360, 800, 1, BIG_NAME],
    [320, 568, 1, BIG_NAME],
    [390, 844, 1.3, BIG_NAME],
    [360, 800, 1.3, SMALL_NAME],
    [320, 568, 1.3, SMALL_NAME],
  ] as Array<[number, number, number, Style]>)('at %d x %d pt and fontScale %d the name is set %j', async (w, h, fs, want) => {
    const u = await show(w, h, fs);
    expect(await u.findByText('Sam')).toBeTruthy();
    expect(flat(u.getByText('Sam'))).toMatchObject(want);
  });

  it('H1: a 12-letter one-word name keeps the same face; the ring row may wrap so the name never needs to split', async () => {
    serve('Massimiliano Rossi', 2);
    const u = await show(320, 568, 1.3);
    expect(await u.findByText('Massimiliano')).toBeTruthy();
    expect(flat(u.getByText('Massimiliano'))).toMatchObject(SMALL_NAME);
    expect(flat(u.getByText('Massimiliano')).numberOfLines).toBeUndefined();
    const src = fs.readFileSync(path.join(__dirname, '..', 'MessagesInboxScreen.tsx'), 'utf8');
    expect(src).not.toMatch(/adjustsFontSizeToFit/);
  });

  it('negative: Roman\'s title does not take the coach name\'s size; it is the drawn 500 24 (B_inbox.html:113 "font:500 1.5rem/1.2 Cormorant")', async () => {
    const u = await show();
    expect(await u.findByText('Roman')).toBeTruthy();
    expect(flat(u.getByText('Roman'))).toMatchObject(SMALL_NAME);
    expect(flat(u.getByText('Sam')).fontSize).toBe(32);
  });

  it('"Message your coach" (no first name) takes the name face and wraps between words', async () => {
    mockGet.mockImplementation(async (url: string) => {
      if (url === '/messages/unread-count') return { data: { total: 2 } };
      throw new Error('offline');
    });
    mockInbox.mockRejectedValue(new Error('offline'));
    const u = await show();
    expect(await u.findByText('Message your coach')).toBeTruthy();
    expect(flat(u.getByText('Message your coach'))).toMatchObject(BIG_NAME);
  });
});

describe('GOAL-935-M M2 and H2: the unread ring as drawn', () => {
  // B_inbox.html:113 `width:44px;height:44px;border-radius:999px;box-shadow:inset 0 0 0 2px var(--gold);...;font:500 1.5rem/1
  // Cormorant` with --gold #C9A961 (B_inbox.html:12); B_inbox_ios390_100.png rows 354-442 (88 px = 44 pt).
  it('M2: 44 x 44, 2 pt colors.romanAccent (#C9A961), the figure Cormorant 500 24 in old-style figures', async () => {
    const u = await show();
    const ring = await u.findByTestId('inbox-unread');
    expect(flat(ring)).toMatchObject({ minWidth: 44, minHeight: 44, borderWidth: 2, borderColor: '#C9A961' });
    expect(tokens.colors.romanAccent).toBe('#C9A961');
    const two = u.getByText('2');
    expect(flat(two)).toMatchObject({ fontFamily: 'CormorantGaramond_500Medium', fontSize: 24, letterSpacing: 0 });
    expect(flat(two).fontVariant ?? []).not.toContain('lining-nums');
  });

  it.each([[12, '12'], [120, '99+']] as Array<[number, string]>)('H2: %d unread draws "%s" inside the ring; the card stays one tap target', async (n, shown) => {
    serve('Sam Carter', n);
    const u = await show(320, 568, 1.3);
    const ring = await u.findByTestId('inbox-unread');
    expect(walk(ring, (x) => x.props?.children === shown)).not.toHaveLength(0);
    expect(flat(ring)).toMatchObject({ minWidth: 44, minHeight: 44, marginLeft: 'auto' });
    expect(walk(ring, (x) => x.props?.onPress !== undefined || x.props?.accessibilityRole !== undefined)).toEqual([]);
    expect(u.getByLabelText(`Sam, your coach, ${shown} unread. Yes, move it to Friday.`)).toBeTruthy();
  });

  it('H2: the coach card\'s top row wraps (the ring moves under the name rather than splitting it)', async () => {
    const u = await show();
    const card = await u.findByTestId('inbox-coach');
    const rows = walk(card, (x) => style(x).flexDirection === 'row');
    expect(style(rows[0])).toMatchObject({ flexDirection: 'row', flexWrap: 'wrap' });
  });

  it('negative: Roman\'s portrait ring is still #C9A961, 2 pt with 2 pt padding; the coach card holds no isRing ring', async () => {
    const u = await show();
    const rings = walk(await u.findByTestId('inbox-roman'), isRing);
    expect(rings.map((r) => style(r).borderColor)).toEqual(['#C9A961']);
    expect(walk(u.getByTestId('inbox-coach'), isRing)).toEqual([]);
  });
});

describe('GOAL-935-M M3: the eyebrows in the drawn weight, line and tracking', () => {
  // B_inbox.html:76 `.b-hero .ovl{font:600 .6875rem/1.3 'Inter';letter-spacing:1.6px;text-transform:uppercase;color:#D9CDB0}`
  // and :80 `.b-ovl{font:600 .6875rem/1.3 'Inter';letter-spacing:1.6px;...;color:var(--muted)}`. #D9CDB0 is not a token:
  // the coach eyebrow keeps gold[200] (KEPT, ΔE76 19.1); Roman's keeps sc.textMuted.
  const DRAWN = { fontFamily: 'Inter_600SemiBold', fontWeight: '600', fontSize: 11, lineHeight: 14.3, letterSpacing: 1.6, textTransform: 'uppercase' };
  it.each([false, true])('needs a coach: %s; "Your coach" and "Your assistant" are Inter 600 11/14.3, tracking 1.6', async (noCoach) => {
    mockNeedsCoach.mockReturnValue(noCoach);
    const u = await show();
    const coach = await u.findByText('Your coach');
    expect(flat(coach)).toMatchObject({ ...DRAWN, color: tokens.gold[200] });
    expect(flat(u.getByText('Your assistant'))).toMatchObject({ ...DRAWN, color: tokens.lightTokens.textMuted });
  });
});

describe('GOAL-935-M M4, M5, M6 and M7: the no-coach cards', () => {
  beforeEach(() => mockNeedsCoach.mockReturnValue(true));
  // B_coachless.html:113 `<p class="meta" style="margin:8px 0 0;color:var(--charcoal)">` with B_inbox.html:49
  // `.meta{font:400 .875rem/1.43 'Inter'}`: Inter 14/20 #3D3D3A = colors.charcoal (the card is palette.cream in both themes).
  it('M4: Roman\'s body is Inter 14/20 in colors.charcoal', async () => {
    const u = await show();
    const body = await u.findByText(/^Roman reads your plan and a coach's guidance/);
    expect(flat(body)).toMatchObject({ fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20, color: tokens.colors.charcoal });
    expect(tokens.colors.charcoal).toBe('#3D3D3A');
  });

  // B_coachless.html:113, the same paragraph: "...Your own logging stays open. Wearable insights come from Roman too, so they
  // start when you join a coach." (C3-S-90; GOAL935-W1, approved by the operator under #203-E15).
  it('M5: the drawn wearable sentence follows Roman\'s body in the same paragraph style', async () => {
    const u = await show();
    const line = await u.findByText(/Wearable insights come from Roman too, so they start when you join a coach\.$/);
    expect(flat(line)).toMatchObject({ fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20, color: tokens.colors.charcoal });
    expect(u.queryAllByText(/Wearable insights/)).toHaveLength(1);
    mockNeedsCoach.mockReturnValue(false);
    const coached = await show();
    expect(coached.queryByText(/Wearable insights/)).toBeNull();
  });

  it('M6 (KEPT): the crisis line keeps its words and the app\'s body-small size', async () => {
    const u = await show();
    const crisis = await u.findByTestId('inbox-crisis');
    expect(crisis.props.children).toBe(COMMUNITY_REPORT_CRISIS_LINE);
    expect(flat(crisis)).toMatchObject({ fontSize: 14, lineHeight: 22 });
  });

  // B_coachless.html:113 `<div class="big">No coach connected</div><p>...` with B_inbox.html:77 `.big{font:500 2rem/1.15 ...;
  // margin:4px 0}`, :78 `.b-hero p{font:400 .9375rem/1.5 'Inter';margin:6px 0 0}`, :75 `.b-hero{...;padding:18px 18px 16px}`,
  // and the buttons row `margin-top:14px`. B_coachless_ios390_100.png: the card is 206 pt tall.
  it('M7: "No coach connected" Cormorant 500 32, the body Inter 15/22.5, the card spaced as drawn', async () => {
    const u = await show();
    const title = await u.findByRole('header', { name: 'No coach connected' });
    expect(flat(title)).toMatchObject({ ...BIG_NAME, marginTop: 4 });
    const body = u.getByText('Messages open once you join a coach. Need help finding one? Contact support.');
    expect(flat(body)).toMatchObject({ fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 22.5, letterSpacing: 0, marginTop: 10 });
    expect(flat(u.getByTestId('inbox-coach'))).toMatchObject({ padding: 18, paddingBottom: 16, gap: 0 });
    const actions = walk(u.getByTestId('inbox-coach'), (x) => style(x).flexWrap === 'wrap' && style(x).gap === 10);
    expect(style(actions[0])).toMatchObject({ marginTop: 14 });
  });
});

describe('GOAL-935-M: what stays as it was', () => {
  it('no reply-window line anywhere (C3-S-50 is v1.1, owner #198-E9)', async () => {
    const u = await show();
    await u.findByText('Sam');
    expect(u.queryByText(/replies within/)).toBeNull();
    mockNeedsCoach.mockReturnValue(true);
    const none = await show();
    expect(none.queryByText(/replies within/)).toBeNull();
  });

  it('the coached card spacing follows B_inbox.html:75 and :78 (16 pt under, the message 6 pt below the name row)', async () => {
    const u = await show();
    const card = await u.findByTestId('inbox-coach');
    expect(flat(card)).toMatchObject({ padding: 18, paddingBottom: 16, gap: 0 });
    expect(flat(u.getByTestId('inbox-preview'))).toMatchObject({ fontSize: 17, marginTop: 6 });
  });

  // The five product files hold no colour literal but Google's four brand fills, inside GoogleMark (a new token, hex, rgb or
  // named colour in a product file is a promotion trigger).
  it('guard: no hex or rgb colour literal in the five files beyond GoogleMark\'s four fills', () => {
    const files = ['screens/client/MessagesInboxScreen.tsx', 'screens/auth/LoginScreen.tsx', 'screens/auth/CreateAccountScreen.tsx', 'screens/auth/ForgotPasswordScreen.tsx', 'screens/auth/AuthStyleB.tsx'];
    // A colour literal is a quoted #rgb, #rrggbb or #rrggbbaa, or an rgb()/rgba() call (issue numbers in comments are not).
    const literal = /['"`]#(?:[0-9A-Fa-f]{8}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})['"`]|\brgba?\(/g;
    const found = files.flatMap((f) => fs.readFileSync(path.join(__dirname, '..', '..', '..', f), 'utf8').match(literal) ?? []);
    expect(found.sort()).toEqual(['"#34A853"', '"#4285F4"', '"#EA4335"', '"#FBBC05"']);
  });
});
