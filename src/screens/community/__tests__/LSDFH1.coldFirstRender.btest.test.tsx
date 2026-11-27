/**
 * LS-DFH-1 B1 (review of m#1021 @ 93ee6ed8c8cf39a79328225ac9ef3322ddef9a9b; DM-FORMER-HOME-M's promise: the card is
 * "never [drawn] before the saved block list is read", and it waits for her coach row's answer, R3).
 *
 * The signed-in person is read for real here: useCurrentUser's first render is always null (useCurrentUser.ts:57-58,
 * :68) and the value arrives after a storage read. On a cold start the saved /community/me and space list are back in
 * the cache before Home mounts (PersistedQueryCacheGate restores the user's saved copy before her screens mount), so
 * Home draws its tree on that first render. With no coach id yet, useCoachChatClosed answers `known: true`
 * (useCoachChatClosed.ts:47) and reads no saved block list (:34), so `former && tree.coachKnown`
 * (CommunityHomeScreen.tsx:115) is true before the person, her coach row's answer or her saved block list is known.
 *
 * As formerCoachHome.test.tsx's COLD row, but with the real useCurrentUser and userCache (that file stands the person in
 * with a synchronous value, :52-54) and the saved copy of /community/me and the space list already in the cache. The
 * card's own read (her former community's DM list, FormerCoach.tsx:120) is the trace COLD uses for "never drawn".
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
const { queryClient: appClient } = require('../../../services/queryClient');
const { prefsStorage } = require('../../../storage/mmkv');
const { setUserCache, clearUserCache } = require('../../../lib/userCache');
const { communityApi } = require('../../../api/communityApi');
const { communityKeys } = require('../../../hooks/useCommunity');

const uuid = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const WS = uuid(1); // her community now (Lee's)
const WS2 = uuid(2); // Maya's community, where she is a former client
const CLIENT = uuid(10); // Dana Cruz
const LEE = uuid(20); // her coach now
const MAYA = uuid(30); // her former coach, whom she blocked on this phone
const EVERYONE = uuid(60);
const CARD = 'community-home-former-coach';
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const ME = {
  feature_flag_state: 'enabled',
  workspace_id: WS,
  membership: { id: uuid(50), role: 'client', notify_level: 'live', dm_enabled_effective: true, last_read_message_at: null, joined_at: '2026-09-01T00:00:00Z' },
  unread: { cohort_messages: 0, dm_messages: 0, mentions: 0 },
  flags: { community_api: true, community_dm: true, community_realtime: false, community_push: true, community_telemetry: false },
  // The copy saved before her block was read back: it still lists Maya.
  former_coach_dms: [{ workspace_id: WS2, coach_user_id: MAYA, coach_display_name: 'Maya Brooks' }],
};
const HTTP: Record<string, unknown> = {
  '/community/me': ME,
  '/community/cohorts': { feature_flag_state: 'enabled', cohorts: [{ id: EVERYONE, workspace_id: WS, name: 'Everyone', is_default: true, kind: 'chat', member_count: 12, my_role: 'client' }] },
  [`/community/workspaces/${WS}`]: { name: "Lee's Studio" },
  '/v1/clients/me/coach': { id: LEE, name: 'Lee Tanaka' },
  '/messages/unread-count': { total: 0 },
  [`/community/workspaces/${WS2}/dms`]: { threads: [{ thread_id: `${WS2}:${MAYA}`, workspace_id: WS2, other_user_id: MAYA, created_at: null, last_message_at: ago(12) }] },
};
const urls = () => mockGet.mock.calls.map((c) => String(c[0]));
const settle = () => act(async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0));
});

describe('LS-DFH-1 B1: a cold start with the saved copy restored', () => {
  const key = persistKeyFor(CLIENT);
  let qc: QueryClient;

  beforeEach(() => {
    mockGet.mockReset();
    mockGet.mockImplementation(async (url: string) => {
      if (url === '/messages?limit=1') return { data: [], headers: {} }; // her coaching chat is open
      const path = url.split('?')[0];
      if (!(path in HTTP)) throw Object.assign(new Error('HTTP 404'), { isAxiosError: true, response: { status: 404, data: {} } });
      return { data: HTTP[path], headers: {} };
    });
    mockPost.mockReset();
    mockFlags.communityDm = true;
    appClient.clear();
    qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: Infinity } } });
  });
  afterEach(async () => {
    await prefsStorage.delete(key);
    await clearUserCache();
    useBlockedUsersStore.setState({ blocked: [], hydrated: false, userId: null });
    appClient.clear();
    qc.clear();
  });

  it('her block of Maya saved on the phone: no render of Home draws the card, the first (before the signed-in person is read) included', async () => {
    // The phone as a cold start finds it: the person saved, her block of Maya saved, the saved copy of /community/me
    // and the space list back in the cache (the real communityApi parsers), no block list read yet.
    await setUserCache({ id: CLIENT, email: '', role: 'student', name: 'Dana Cruz', firstName: 'Dana', coach_id: LEE });
    await prefsStorage.set(key, JSON.stringify([{ id: MAYA, displayName: 'Maya Brooks', role: 'coach', blockedAt: '2026-11-20T00:00:00Z' }]));
    await qc.prefetchQuery({ queryKey: communityKeys.me(), queryFn: () => communityApi.getMe() });
    await qc.prefetchQuery({ queryKey: communityKeys.cohorts(), queryFn: () => communityApi.getCohorts() });
    expect(qc.getQueryData<{ former_coach_dms?: unknown[] }>(communityKeys.me())?.former_coach_dms).toHaveLength(1);
    expect(qc.getQueryData(communityKeys.cohorts())).toBeTruthy();
    useBlockedUsersStore.setState({ blocked: [], hydrated: false, userId: null });
    mockGet.mockClear();

    const view = await render(<QueryClientProvider client={qc}><CommunityHomeScreen /></QueryClientProvider>);
    try {
      expect(await screen.findByLabelText('Everyone')).toBeTruthy(); // the tree drew from the saved copy
      await waitFor(() => expect(useBlockedUsersStore.getState().hydrated).toBe(true));
      expect(useBlockedUsersStore.getState().blocked.map((b: { id: string }) => b.id)).toEqual([MAYA]);
      expect(await screen.findByTestId('space-row-coach')).toBeTruthy(); // her coach row's answer is in
      await settle();
      expect(screen.queryByTestId(CARD)).toBeNull();
      // No render mounted the card: its own read of her former community (FormerCoach.tsx:120) never went out.
      expect(urls()).not.toContain(`/community/workspaces/${WS2}/dms`);
    } finally {
      await view.unmount();
    }
  });
});
