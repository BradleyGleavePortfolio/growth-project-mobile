/**
 * B-TEST LS-985R1 B1 (review of m#985 at f9492cbd): a client has her coach's community DM thread open and the coach
 * sends a message. The server tells her phone twice (community-dms.service.ts:216-239 at backend f47013f4): a realtime
 * ping on her own topic and a push. At this head the push draws no banner, because its own tap would open the thread
 * that is already open (pushTapLanding now answers CommunityDmThread {recipientId} for a client, pushTapRouter.ts:394-398;
 * foregroundBannerStore.ts:60), and nothing reads the open thread again (useDmMessages has no poll and no focus read;
 * the ping re-reads /community/me only, useCommunity.ts:443-461). So the new message is neither drawn nor announced
 * until she leaves the thread or sends. At the base 989be4bb the banner showed over the thread.
 * The promise tested: the message is drawn in the open thread, or the banner tells her. Either passes.
 * The harness is CommunityDmClientM.test.tsx's (the real thread and hooks, the HTTP edge mocked) with
 * clientDmPushTap.test.tsx's expo-notifications edge. Names and ids are fictional.
 */
import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
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
// The realtime edge: the one subscription the app makes (useCommunityBadge, as ClientNavigator.tsx:736 mounts it).
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
// The push edge.
const mockAddReceived = jest.fn((_cb: unknown) => ({ remove: jest.fn() }));
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  addNotificationReceivedListener: (cb: unknown) => mockAddReceived(cb),
  addNotificationResponseReceivedListener: () => ({ remove: jest.fn() }),
  getLastNotificationResponseAsync: () => Promise.resolve(null),
  clearLastNotificationResponseAsync: () => Promise.resolve(),
  AndroidImportance: { MAX: 5 },
}));
const mockUser = { id: '00000010-0000-4000-8000-000000000000', role: 'student', name: 'Dana Cruz', firstName: 'Dana', coach_id: '00000020-0000-4000-8000-000000000000' };
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

const CommunityDmThreadScreen = require('../CommunityDmThreadScreen').default;
const { useCommunityBadge } = require('../../../hooks/useCommunity');
const { queryClient } = require('../../../services/queryClient');
const { attachOpenScreenCheck, foregroundBannerStore } = require('../../../store/foregroundBannerStore');
const { opensOpenScreen } = require('../../../components/ForegroundNotificationBanner');
const { installForegroundHandler } = require('../../../services/pushNotifications');
const { __resetPushTapRouterForTests, setPushSession } = require('../../../services/pushTapRouter');

const uuid = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const WS = uuid(1);
const CLIENT = uuid(10);
const COACH = uuid(20);
const CLIENT_TABS = ['Home', 'WorkoutTab', 'CommunityTab', 'MoreTab'];
const ME_URL = '/community/me';
const MSGS_URL = `/community/workspaces/${WS}/dms/${COACH}/messages`;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
/** GET /community/me for a member client (community.service.ts:110-183). */
const ME = {
  feature_flag_state: 'enabled', workspace_id: WS,
  membership: { id: uuid(40), role: 'client', notify_level: 'live', dm_enabled_effective: true, last_read_message_at: null, joined_at: ago(86_400_000) },
  unread: { cohort_messages: 0, dm_messages: 0, mentions: 0 },
  flags: { community_api: true, community_dm: true, community_realtime: true, community_push: true, community_telemetry: false },
};
/** A DM message (community-dms.service.ts messageView). */
const msg = (n: number, body: string) => ({
  id: uuid(n), thread_id: `${WS}:${[CLIENT, COACH].sort().join(':')}`, sender_user_id: COACH, recipient_user_id: CLIENT, body, created_at: ago(60_000), deleted: false,
});
const FIRST = msg(900, 'See you Monday');
const REPLY = msg(901, 'Change of plan, Tuesday');
/** The coach's DM push as the device hands it over (community-notifications.service.ts:262-274). */
const dmPush = (id: string) => ({
  request: { identifier: id, content: { title: 'Direct message', body: 'You have a new direct message.',
    data: { kind: 'community_dm_received', category: 'community', target_type: 'dm', target_id: REPLY.id, deepLink: `tgp://community/dm/${COACH}` } } },
});
const reads = (url: string) => mockGet.mock.calls.filter((c) => String(c[0]).split('?')[0] === url).length;

function Badge(): null {
  useCommunityBadge(CLIENT);
  return null;
}

let replied = false;
let focused: { name: string; params?: Record<string, unknown> } = { name: 'CommunityTab' };
let stopReceived: () => void;
let detachCheck: () => void;
let receive: (n: unknown) => void;

beforeEach(() => {
  replied = false;
  mockGet.mockReset().mockImplementation(async (url: string) => {
    const key = url.split('?')[0];
    if (key === ME_URL) return { data: ME, headers: {} };
    if (key === '/v1/clients/me/coach') return { data: { id: COACH, name: 'Alex Morgan' }, headers: {} };
    if (key === MSGS_URL) return { data: { messages: replied ? [REPLY, FIRST] : [FIRST] }, headers: {} };
    throw Object.assign(new Error('HTTP 404'), { isAxiosError: true, response: { status: 404, data: { error: 'not_found' } } });
  });
  mockPost.mockReset().mockResolvedValue({ data: {}, headers: {} });
  queryClient.clear();
  __resetPushTapRouterForTests();
  setPushSession({ kind: 'app', userId: CLIENT, role: 'student' });
  // The mounted banner's own read of the open screen (ForegroundNotificationBanner.tsx:112), over a stand-in container.
  detachCheck = attachOpenScreenCheck((p: unknown) => opensOpenScreen({
    isReady: () => true, getCurrentRoute: () => focused, getRootState: () => ({ routeNames: CLIENT_TABS }),
  } as never, p as never));
  stopReceived = installForegroundHandler();
  receive = mockAddReceived.mock.calls[mockAddReceived.mock.calls.length - 1][0] as (n: unknown) => void;
});
afterEach(async () => {
  stopReceived();
  detachCheck();
  await act(async () => foregroundBannerStore.getState().reset());
  queryClient.clear();
});

describe('LS-985R1 B1: a DM that arrives while the client has that thread open', () => {
  it('control: with the Community tab\'s root open, the same push shows its banner', async () => {
    focused = { name: 'CommunityTab' };
    await act(async () => receive(dmPush('push-open-0')));
    expect(foregroundBannerStore.getState().banner?.title).toBe('Direct message');
  });

  it('the new message is drawn in the open thread, or the banner tells her', async () => {
    mockParams = { recipientId: COACH };
    focused = { name: 'CommunityDmThread', params: { recipientId: COACH } };
    const view = await render(
      <QueryClientProvider client={queryClient}>
        <Badge />
        <CommunityDmThreadScreen />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(view.getByTestId(`dm-message-${FIRST.id}`)).toBeTruthy());
    expect(mockPings.size).toBeGreaterThan(0);
    const meReads = reads(ME_URL);

    // The coach sends: the server writes the row, pings her topic and pushes her phone.
    replied = true;
    await act(async () => {
      for (const ping of [...mockPings]) ping({ event: 'community.message.created' });
      receive(dmPush('push-open-1'));
    });
    // The ping reached the app: its own re-read of /community/me went out.
    await waitFor(() => expect(reads(ME_URL)).toBeGreaterThan(meReads));

    let drawn = false;
    let told = false;
    try {
      await waitFor(() => {
        drawn = view.queryByTestId(`dm-message-${REPLY.id}`) !== null;
        told = foregroundBannerStore.getState().banner !== null;
        expect(drawn || told).toBe(true);
      }, { timeout: 12_000 }); // long enough for a fix that polls the open thread
    } finally {
      await view.unmount();
    }
    expect({ drawn, told }).not.toEqual({ drawn: false, told: false });
  }, 30_000);
});
