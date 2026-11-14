/**
 * LO-985R1 B1 (m#985 @ f9492cbd): a client sits in her coach's DM thread and the coach's reply arrives as a foreground
 * push. At this head pushTapLanding answers CommunityDmThread {recipientId} for a client, so the banner's open-screen
 * check (ForegroundNotificationBanner.tsx:89-107) hides the banner, and nothing makes the open thread read its messages
 * again (useDmMessages has no poll or ping; the foreground listener refreshes only a meal plan). The reply is shown
 * nowhere. At the base the banner showed it (the client's DM tap landed on the Community tab).
 * The requirement, fix-agnostic: the push is shown by the banner, or the open thread reads its messages again.
 * Real CommunityDmThreadScreen, react-query hooks, pushNotifications' foreground listener, foregroundBannerStore,
 * opensOpenScreen and pushTapRouter; the app's own query client; the HTTP edge and expo-notifications are mocked.
 * Ids and names are fictional.
 */
import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';

const mockAddReceived = jest.fn((_cb: unknown) => ({ remove: jest.fn() }));
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  addNotificationReceivedListener: (cb: unknown) => mockAddReceived(cb),
  addNotificationResponseReceivedListener: () => ({ remove: jest.fn() }),
  getLastNotificationResponseAsync: () => Promise.resolve(null),
  clearLastNotificationResponseAsync: () => Promise.resolve(),
  AndroidImportance: { MAX: 5 },
}));
const mockGet = jest.fn();
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: {
    get: (...a: unknown[]) => mockGet(...a),
    post: jest.fn(async () => ({ data: {}, headers: {} })),
    patch: jest.fn(async () => ({ data: {}, headers: {} })),
    put: jest.fn(async () => ({ data: {}, headers: {} })),
    delete: jest.fn(async () => ({ data: {}, headers: {} })),
  },
  coachApi: {},
}));
jest.mock('../../../services/secureStorage', () => ({ secureStorage: { getItem: jest.fn(async () => 'test-token') } }));
jest.mock('../../../services/sentry', () => ({ captureError: jest.fn(), setSentryUser: jest.fn() }));
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
jest.mock('../../../api/communityRealtime', () => new Proxy({ __esModule: true }, {
  get: (target, key) => (key in target ? target[key as keyof typeof target] : () => () => undefined),
}));
const uuid = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const WS = uuid(1);
const CLIENT = uuid(10);
const COACH = uuid(20);
jest.mock('../../../hooks/useCurrentUser', () => ({
  ...jest.requireActual('../../../hooks/useCurrentUser'),
  useCurrentUser: () => ({ id: '00000010-0000-4000-8000-000000000000', role: 'student', name: 'Dana Cruz', firstName: 'Dana', coach_id: '00000020-0000-4000-8000-000000000000' }),
}));
jest.mock('@react-navigation/native', () => {
  const R = require('react');
  return {
    useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), addListener: () => () => undefined, setOptions: () => undefined }),
    useRoute: () => ({ params: { recipientId: '00000020-0000-4000-8000-000000000000' } }),
    useFocusEffect: (cb: () => void | (() => void)) => R.useEffect(() => cb(), [cb]),
    useIsFocused: () => true,
  };
});
jest.mock('../../../components/community/SafetyMenu', () => () => null);

const CommunityDmThreadScreen = require('../CommunityDmThreadScreen').default;
const { opensOpenScreen } = require('../../../components/ForegroundNotificationBanner');
const { attachOpenScreenCheck, foregroundBannerStore } = require('../../../store/foregroundBannerStore');
const { installForegroundHandler } = require('../../../services/pushNotifications');
const { __resetPushTapRouterForTests, attachPushNavigator, setPushSession } = require('../../../services/pushTapRouter');
const { queryClient } = require('../../../services/queryClient');

const CLIENT_TABS = ['Home', 'WorkoutTab', 'Log', 'MoreTab', 'CalendarTab', 'CommunityTab'];
const ME = {
  feature_flag_state: 'enabled', workspace_id: WS,
  membership: { id: uuid(40), role: 'client', notify_level: 'live', dm_enabled_effective: true, last_read_message_at: null, joined_at: new Date(Date.now() - 86_400_000).toISOString() },
  unread: { cohort_messages: 0, dm_messages: 0, mentions: 0 },
  flags: { community_api: true, community_dm: true, community_realtime: false, community_push: true, community_telemetry: false },
};
const MSGS_URL = `/community/workspaces/${WS}/dms/${COACH}/messages`;
const msg = (n: number, from: string, to: string, body: string) => ({
  id: uuid(n), thread_id: `${WS}:${[from, to].sort().join(':')}`, sender_user_id: from, recipient_user_id: to, body,
  created_at: new Date(Date.now() - n * 1000).toISOString(), deleted: false,
});
const messagesReads = () => mockGet.mock.calls.filter((c) => String(c[0]).split('?')[0] === MSGS_URL).length;

it('LO-985R1 B1: a DM that arrives while its thread is open is shown (the banner, or the thread reads its messages again)', async () => {
  let messages = [msg(2, CLIENT, COACH, 'Quick question about Monday')];
  mockGet.mockImplementation(async (url: string) => {
    const key = url.split('?')[0];
    if (key === '/community/me') return { data: ME, headers: {} };
    if (key === '/v1/clients/me/coach') return { data: { id: COACH, name: 'Alex Morgan' }, headers: {} };
    if (key === MSGS_URL) return { data: { messages }, headers: {} };
    throw Object.assign(new Error('HTTP 404'), { isAxiosError: true, response: { status: 404, data: { error: 'not_found' } } });
  });
  __resetPushTapRouterForTests();
  attachPushNavigator({ isReady: () => true, navigate: jest.fn(), getRootState: () => ({ routeNames: CLIENT_TABS, routes: [] }) });
  setPushSession({ kind: 'app', userId: CLIENT, role: 'student' });
  // The banner's own open-screen check, as ForegroundNotificationBanner.tsx:112 attaches it: the client's focused route
  // is her coach's thread (CommunityTab > CommunityDmThread {recipientId}, as her list row or a DM tap opens it).
  const navRoot = {
    isReady: () => true,
    getCurrentRoute: () => ({ name: 'CommunityDmThread', params: { recipientId: COACH } }),
    getRootState: () => ({ routeNames: CLIENT_TABS }),
  };
  const detach = attachOpenScreenCheck((p: unknown) => opensOpenScreen(navRoot, p));
  const stopReceived = installForegroundHandler();
  const receive = mockAddReceived.mock.calls[mockAddReceived.mock.calls.length - 1][0] as (n: unknown) => void;

  const view = await render(<QueryClientProvider client={queryClient}><CommunityDmThreadScreen /></QueryClientProvider>);
  await waitFor(() => expect(view.getByText('Quick question about Monday')).toBeTruthy());
  const before = messagesReads();

  // The coach replies: the server's DM push (community-dms.service.ts:236, kind community_dm_received, no actionScreen).
  messages = [msg(1, COACH, CLIENT, 'Yes, 9am works'), ...messages];
  await act(async () => {
    receive({
      request: {
        identifier: 'dm-reply-1',
        content: {
          title: 'Direct message', body: 'You have a new direct message.',
          data: { kind: 'community_dm_received', category: 'community', target_type: 'dm', target_id: COACH, deepLink: `tgp://community/dm/${COACH}` },
        },
      },
    });
  });
  await act(async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); });

  // Shown: the banner holds it, or the open thread read its messages again and draws the reply.
  await waitFor(() => {
    const bannerShown = foregroundBannerStore.getState().banner !== null;
    const replyInThread = messagesReads() > before && view.queryByText('Yes, 9am works') !== null;
    expect({ bannerShown, replyInThread }).not.toEqual({ bannerShown: false, replyInThread: false });
  }, { timeout: 2000 });

  stopReceived();
  detach();
  await view.unmount();
  queryClient.clear();
});
