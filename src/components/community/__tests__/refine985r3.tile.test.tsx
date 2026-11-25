/**
 * REFINE-985R3 TILE-1 and FONT-1 (LO-985R2 C1, C2, C6 = LS-985R2 C1, N11): the coach's tile on the client's DM bar.
 * One letter, as C6CHAT-S-V2 c08 draws it; in a face App.tsx loads; its growth with the phone's text size capped so the
 * letter stays inside the 36 pt tile; hidden from screen readers, because the name beside it is read. No tile and no
 * "Your coach" for anyone but her own coach with a name the phone read. The coach's own Studio tile (the `studio`
 * arm) is as before. The thread, hooks and bar are real; the HTTP edge is a stand-in. Names and ids are fictional.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { StyleSheet } from 'react-native';
import { render, waitFor, within } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: {
    get: (...a: unknown[]) => mockGet(...a),
    post: (...a: unknown[]) => mockPost(...a),
    patch: (...a: unknown[]) => mockPost(...a),
    put: (...a: unknown[]) => mockPost(...a),
    delete: (...a: unknown[]) => mockPost(...a),
  },
  coachApi: {},
}));
jest.mock('../../../config/featureFlags', () => {
  const actual = jest.requireActual('../../../config/featureFlags');
  const on: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(actual.featureFlags)) on[k] = typeof v === 'boolean' ? true : v;
  return { ...actual, featureFlags: on };
});
const mockTheme = () => {
  const tokens = jest.requireActual('../../../theme/tokens');
  return { colors: jest.requireActual('../../../constants/colors').default, tokens: tokens.default, semanticColors: tokens.lightTokens, colorScheme: 'light', isDark: false };
};
jest.mock('../../../theme/useTheme', () => ({ useTheme: () => mockTheme() }));
jest.mock('../../../theme/ThemeProvider', () => ({ useTheme: () => mockTheme() }));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('@expo/vector-icons', () => {
  const Icon = () => null;
  return { Ionicons: Icon, MaterialIcons: Icon, Feather: Icon };
});
const mockDisk = new Map<string, string>();
jest.mock('../../../storage/mmkv', () => ({
  cacheStorage: {
    getString: (k: string) => mockDisk.get(k),
    getStringAsync: async (k: string) => mockDisk.get(k),
    set: async (k: string, v: string) => { mockDisk.set(k, v); },
    delete: async (k: string) => { mockDisk.delete(k); },
    getAllKeys: async () => [...mockDisk.keys()],
  },
  prefsStorage: { getString: () => undefined },
}));
const mockPings = new Set<(ping?: { event?: string }) => void>();
jest.mock('../../../api/communityRealtime', () => {
  const real: Record<string, unknown> = {
    __esModule: true,
    COMMUNITY_BROADCAST_EVENTS: {
      messageCreated: 'community.message.created', messageUpdated: 'community.message.updated',
      postCreated: 'community.post.created', postUpdated: 'community.post.updated',
      reactionChanged: 'community.reaction.changed', membershipChanged: 'community.membership.changed',
    },
    subscribeToCommunityUser: (_userId: string, cb: (ping?: { event?: string }) => void) => {
      mockPings.add(cb);
      return () => { mockPings.delete(cb); };
    },
  };
  return new Proxy(real, { get: (target, key) => (key in target ? target[key as string] : () => () => undefined) });
});
let mockUser: Record<string, unknown> = { id: '00000010-0000-4000-8000-000000000000', role: 'student', name: 'Dana Cruz', firstName: 'Dana', coach_id: '00000020-0000-4000-8000-000000000000' };
jest.mock('../../../hooks/useCurrentUser', () => ({
  ...jest.requireActual('../../../hooks/useCurrentUser'),
  useCurrentUser: () => mockUser,
}));
let mockParams: Record<string, unknown> = {};
jest.mock('@react-navigation/native', () => {
  const R = require('react');
  return {
    useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), addListener: () => () => undefined, setOptions: () => undefined }),
    useRoute: () => ({ params: mockParams }),
    useFocusEffect: (cb: () => void | (() => void)) => R.useEffect(() => cb(), [cb]),
    useIsFocused: () => true,
  };
});
jest.mock('../../../components/community/SafetyMenu', () => (p: { authorName?: string; testID?: string }) =>
  require('react').createElement(require('react-native').Text, { testID: p.testID }, `menu:${p.authorName}`));


const CommunityDmThreadScreen = require('../../../screens/community/CommunityDmThreadScreen').default;
const ThreadHeader = require('../ThreadHeader').default;
const { queryClient } = require('../../../services/queryClient');

const uuid = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const WS = uuid(1);
const CLIENT = uuid(10);
const COACH = uuid(20);
const FORMER = uuid(21);
const MEMBER = uuid(30);
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const ME = {
  feature_flag_state: 'enabled', workspace_id: WS,
  membership: { id: uuid(40), role: 'client', notify_level: 'live', dm_enabled_effective: true, last_read_message_at: null, joined_at: ago(86_400_000) },
  unread: { cohort_messages: 0, dm_messages: 0, mentions: 0 },
  flags: { community_api: true, community_dm: true, community_realtime: false, community_push: true, community_telemetry: false },
};
const msgsUrl = (other: string) => `/community/workspaces/${WS}/dms/${other}/messages`;
const msg = (n: number, from: string, other: string) => ({
  id: uuid(n), thread_id: `${WS}:${[CLIENT, other].sort().join(':')}`, sender_user_id: from, recipient_user_id: from === CLIENT ? other : CLIENT, body: 'See you Monday', created_at: ago(60_000), deleted: false,
});
const css = (el: { props: { style?: unknown } }) => (StyleSheet.flatten(el.props.style as never) ?? {}) as Record<string, unknown>;
const TILE = 'community-dmthread-header-tile';
const BAR = 'community-dmthread-header';

/** The faces App.tsx hands to useFonts (read from the file, as fontsLoaded.guard.test.ts does). */
const loaded = (/useFonts\(\{([\s\S]*?)\}\)/.exec(fs.readFileSync(path.resolve(__dirname, '../../../../App.tsx'), 'utf8'))?.[1] ?? '')
  .split(/[\s,]+/).filter(Boolean);

let coachName: string | null = 'Sam Carter';
beforeEach(() => {
  coachName = 'Sam Carter';
  mockUser = { id: CLIENT, role: 'student', name: 'Dana Cruz', firstName: 'Dana', coach_id: COACH };
  mockParams = { recipientId: COACH };
  mockGet.mockReset().mockImplementation(async (url: string) => {
    const key = url.split('?')[0];
    if (key === '/community/me') return { data: ME, headers: {} };
    if (key === '/v1/clients/me/coach' && coachName) return { data: { id: COACH, name: coachName }, headers: {} };
    for (const other of [COACH, FORMER, MEMBER]) if (key === msgsUrl(other)) return { data: { messages: [msg(900, other, other)] }, headers: {} };
    throw Object.assign(new Error('HTTP 404'), { isAxiosError: true, response: { status: 404, data: { error: 'not_found' } } });
  });
  mockPost.mockReset().mockResolvedValue({ data: {}, headers: {} });
  queryClient.clear();
});
afterEach(() => queryClient.clear());

const open = async () => {
  const view = await render(<QueryClientProvider client={queryClient}><CommunityDmThreadScreen /></QueryClientProvider>);
  await waitFor(() => expect(view.getByTestId(`dm-message-${uuid(900)}`)).toBeTruthy());
  return view;
};

describe('TILE-1: the coach\'s tile on the client\'s DM bar', () => {
  it.each([
    ['two words', 'Sam Carter', 'S'],
    ['one word', 'Morgan', 'M'],
    ['a hyphenated last name', 'Alex Reyes-Whitfield', 'A'],
    ['lower case', 'sam carter', 'S'],
    ['a 40-character name', 'Maximilian Bartholomew Featherstonehaugh', 'M'],
    ['a script with no spaces', '山田太郎', '山'],
    ['a first character outside the basic plane', '𝒮am Carter', '𝒮'],
  ])('one letter for %s (%s -> %s)', async (_what, name, letter) => {
    if (_what === 'a 40-character name') expect(name.length).toBe(40);
    coachName = name;
    const view = await open();
    await waitFor(() => expect(view.queryByTestId(TILE)).not.toBeNull());
    const drawn = within(view.getByTestId(TILE)).getAllByText(/[\s\S]*/, { includeHiddenElements: true }).map((n) => String(n.props.children));
    expect(drawn).toEqual([letter]);
    expect(Array.from(drawn[0]).length).toBe(1);
    await view.unmount();
  });

  it('its face is one App.tsx loads, its growth is capped, and the tile is hidden from screen readers while the name is read', async () => {
    const view = await open();
    await waitFor(() => expect(view.queryByTestId(TILE)).not.toBeNull());
    const tile = view.getByTestId(TILE);
    const letter = within(tile).getByText('S', { includeHiddenElements: true });
    expect(loaded).toContain(css(letter).fontFamily);
    expect(css(letter)).toMatchObject({ fontSize: 21 });
    // 21 pt may grow to 27.3 pt (130%, the largest text size the renders name) and no further: the widest capital in
    // this face is under one em, so one letter stays inside the tile's 34 pt (36 less its 1 pt line each side).
    expect(letter.props.maxFontSizeMultiplier).toBe(1.3);
    expect(21 * 1.3).toBeLessThan(34);
    expect(css(tile)).toMatchObject({ width: 36, height: 36 });
    expect(tile.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(tile.props.accessibilityElementsHidden).toBe(true);
    expect(within(view.getByTestId(BAR)).queryByText('S')).toBeNull(); // not read aloud
    expect(within(view.getByTestId(BAR)).getByRole('header', { name: 'Sam Carter' })).toBeTruthy(); // the name is
    expect(within(view.getByTestId(BAR)).getByText('Your coach')).toBeTruthy();
    await view.unmount();
  });

  it.each([
    ['a member', () => { mockParams = { recipientId: MEMBER }; }],
    ['a former coach', () => { mockParams = { recipientId: FORMER }; }],
    ['her coach under a given label', () => { mockParams = { recipientId: COACH, participantLabel: 'Sam Carter' }; }],
    ['her coach, the name not known', () => { coachName = null; }],
  ])('no tile and no "Your coach" for %s', async (_who, arrange) => {
    arrange();
    const view = await open();
    await waitFor(() => expect(mockGet.mock.calls.some((c) => String(c[0]).startsWith('/community/workspaces/'))).toBe(true));
    expect(view.queryByTestId(TILE)).toBeNull();
    expect(view.queryByText('Your coach')).toBeNull();
    await view.unmount();
  });
});

describe('the coach app\'s Studio tile (ThreadHeader `studio`) draws as before', () => {
  it('two letters in Inter, no growth cap, read as before', async () => {
    const view = await render(<ThreadHeader tone="deep" studio title="Dana Cruz" subtitle="Client" initials="DC" testID="bar" />);
    const tile = view.getByTestId('bar-tile');
    const letters = within(tile).getByText('DC');
    expect(css(letters)).toMatchObject({ fontFamily: 'Inter_600SemiBold', fontSize: 14 });
    expect(letters.props.maxFontSizeMultiplier).toBeUndefined();
    expect(tile.props.importantForAccessibility).toBeUndefined();
    expect(tile.props.accessibilityElementsHidden).toBeUndefined();
    expect(css(tile)).toMatchObject({ width: 44, height: 44 });
  });
});
