/**
 * LO-DFH-1 B1 (B-TEST for m#1021). The real useCurrentUser: its first render is always null and the signed-in person
 * arrives only after the saved user is read (useCurrentUser.ts). While that read is out, useSpaceTree has no coach id,
 * so useCoachChatClosed answers { known: true } at once and starts no block-list hydration, and Home's useFormerCoach
 * gets no coach id of hers. With /me and the spaces restored from the phone's saved copy (the persisted query cache),
 * Home's tree draws at once, so the card must still wait: never a coach she blocked, never before the saved block
 * list is read. Her DM list waits for her and her coach id (CommunityDmListScreen.tsx `coachFirst`); Home must too.
 * Stand-ins as formerCoachHome.test.tsx, except the person: the real useCurrentUser over a held saved-user read.
 * Names and ids are fictional.
 */
import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

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
  coachApi: { getClients: jest.fn() },
}));
const mockFlags: Record<string, unknown> = {};
jest.mock('../../../config/featureFlags', () => {
  const actual = jest.requireActual('../../../config/featureFlags');
  for (const [k, v] of Object.entries(actual.featureFlags)) mockFlags[k] = typeof v === 'boolean' ? true : v;
  return { ...actual, featureFlags: mockFlags };
});
const mockTheme = () => {
  const tokens = jest.requireActual('../../../theme/tokens');
  return { colors: jest.requireActual('../../../constants/colors').default, tokens: tokens.default, semanticColors: tokens.lightTokens, colorScheme: 'light', isDark: false };
};
jest.mock('../../../theme/useTheme', () => ({ useTheme: () => mockTheme() }));
jest.mock('../../../theme/ThemeProvider', () => ({ useTheme: () => mockTheme(), LightTheme: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('@expo/vector-icons', () => {
  const R = require('react');
  const { Text: T } = require('react-native');
  const Icon = (p: { name: string }) => R.createElement(T, { testID: `icon-${p.name}` }, '');
  return { Ionicons: Icon, MaterialIcons: Icon, Feather: Icon };
});
jest.mock('../../../api/communityRealtime', () => new Proxy({ __esModule: true }, {
  get: (target, key) => (key in target ? target[key as keyof typeof target] : () => () => undefined),
}));
// The real useCurrentUser; only its saved-user read is held, as a phone's storage read can be.
let mockUserRead: Promise<unknown> = Promise.resolve(null);
jest.mock('../../../lib/userCache', () => ({
  ...jest.requireActual('../../../lib/userCache'),
  readUserCacheSync: () => null,
  readUserCache: () => mockUserRead,
}));
const mockNav = { navigate: jest.fn(), goBack: jest.fn(), replace: jest.fn(), addListener: () => () => undefined, setOptions: () => undefined };
jest.mock('@react-navigation/native', () => {
  const R = require('react');
  return {
    NavigationContext: R.createContext(undefined),
    useNavigation: () => mockNav,
    useRoute: () => ({ params: {} }),
    useFocusEffect: (cb: () => void | (() => void)) => R.useEffect(() => cb(), [cb]),
    useIsFocused: () => true,
  };
});
jest.mock('../CommunityChallengesScreen', () => {
  const { Text } = require('react-native');
  return () => <Text testID="challenges-list">Challenges list</Text>;
});

const CommunityHomeScreen = require('../CommunityHomeScreen').default;
const { useBlockedUsersStore, persistKeyFor } = require('../../../store/blockedUsersStore');
const { queryClient: appClient } = jest.requireActual('../../../services/queryClient');
const { prefsStorage } = jest.requireActual('../../../storage/mmkv');

const uuid = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const WS = uuid(1);
const WS2 = uuid(2);
const CLIENT = uuid(10);
const LEE = uuid(20);
const MAYA = uuid(30);
const EVERYONE = uuid(60);
const CARD = 'community-home-former-coach';
const USER = { id: CLIENT, role: 'student', name: 'Dana Cruz', firstName: 'Dana', coach_id: LEE };
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const FLAGS = { community_api: true, community_dm: true, community_realtime: false, community_push: true, community_telemetry: false };
const MEMBERSHIP = { id: uuid(50), role: 'client', notify_level: 'live', dm_enabled_effective: true, last_read_message_at: null, joined_at: '2026-09-01T00:00:00Z' };
const ME = {
  feature_flag_state: 'enabled', workspace_id: WS, membership: MEMBERSHIP, unread: { cohort_messages: 0, dm_messages: 0, mentions: 0 }, flags: FLAGS,
  former_coach_dms: [{ workspace_id: WS2, coach_user_id: MAYA, coach_display_name: 'Maya Brooks' }],
};
const COHORTS = { feature_flag_state: 'enabled', cohorts: [{ id: EVERYONE, workspace_id: WS, name: 'Everyone', is_default: true, kind: 'chat', member_count: 12, my_role: 'client' }] };
const thread = (ws: string, other: string, at: string) => ({ thread_id: `${ws}:${other}`, workspace_id: ws, other_user_id: other, created_at: null, last_message_at: at });
const HTTP: Record<string, unknown> = {
  '/community/me': ME,
  '/community/cohorts': COHORTS,
  [`/community/workspaces/${WS}`]: { name: "Lee's Studio" },
  '/v1/clients/me/coach': { id: LEE, name: 'Lee Tanaka' },
  '/messages/unread-count': { total: 2 },
  [`/community/workspaces/${WS2}/dms`]: { threads: [thread(WS2, MAYA, ago(12))] },
};
const notFound = () => Object.assign(new Error('HTTP 404'), { isAxiosError: true, response: { status: 404, data: {} } });
const urls = () => mockGet.mock.calls.map((c) => String(c[0]));
const settle = () => act(async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0));
});

let qc: QueryClient;
beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockGet.mockImplementation(async (url: string) => {
    if (url === '/messages?limit=1') return { data: [], headers: {} };
    const key = url.split('?')[0];
    if (!(key in HTTP)) throw notFound();
    return { data: HTTP[key], headers: {} };
  });
  mockPost.mockImplementation(async () => ({ data: {}, headers: {} }));
  useBlockedUsersStore.setState({ blocked: [], hydrated: false, userId: null });
  appClient.clear();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: Infinity } } });
});
afterEach(() => {
  useBlockedUsersStore.setState({ blocked: [], hydrated: false, userId: null });
  appClient.clear();
  qc.clear();
});

it('LO-DFH-1 B1: while her saved user is still being read, Home draws no former-coach card (never one she blocked, never before the saved block list is read)', async () => {
  const key = persistKeyFor(CLIENT);
  await prefsStorage.set(key, JSON.stringify([{ id: MAYA, displayName: 'Maya Brooks', role: 'coach', blockedAt: '2026-11-20T00:00:00Z' }]));
  // A cold start: /me (still listing Maya, KT-13) and the spaces come back from the phone's saved copy before Home mounts.
  qc.setQueryData(['community', 'me'], ME);
  qc.setQueryData(['community', 'cohorts'], COHORTS);
  let release: (() => void) | undefined;
  mockUserRead = new Promise((r) => { release = () => r(USER); });
  try {
    await render(<QueryClientProvider client={qc}><CommunityHomeScreen /></QueryClientProvider>);
    expect(await screen.findByLabelText('Everyone')).toBeTruthy(); // the tree drew
    await settle();
    expect(screen.queryByTestId(CARD)).toBeNull();
    expect(screen.queryByText('Maya Brooks')).toBeNull();
    await act(async () => { release?.(); });
    await waitFor(() => expect(useBlockedUsersStore.getState().hydrated).toBe(true));
    expect(await screen.findByTestId('space-row-coach')).toBeTruthy(); // her coach row's answer is in
    await settle();
    expect(screen.queryByTestId(CARD)).toBeNull();
    expect(urls()).not.toContain(`/community/workspaces/${WS2}/dms`); // the card never mounted at any step
  } finally {
    mockUserRead = Promise.resolve(null);
    await prefsStorage.delete(key);
  }
});
