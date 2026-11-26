/**
 * B-TEST LO-985R2 B1 (review of m#985 at 22000de8): a client has her coach's community DM thread open and the coach
 * replies while no push can reach her phone. Every device push waits for 08:00 inside 21:00-08:00 in the recipient's
 * zone, for every user (backend push-quiet-hours.ts:6-8, :80; push-delivery.service.ts:74-75 at f47013f4, production),
 * and none goes under Mute all, with no token or with notifications declined. The server still pings her own topic for
 * every DM ("the recipient pings -> refetches the thread", community-dms.service.ts:212-227). At this head only a push
 * re-reads the open thread (dmRefresh.ts, pushNotifications.ts:124, pushTapRouter.ts:427); the ping re-reads
 * /community/me only (useCommunity.ts:443-461). So the reply is neither drawn nor announced while the thread is open.
 * The promise tested: a DM the phone learns of while its thread is open is drawn there.
 * The harness is LS985R1.openThreadNewDm.btest.test.tsx's (the real thread and hooks, the HTTP and realtime edges
 * mocked). Names and ids are fictional.
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

const uuid = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const WS = uuid(1);
const CLIENT = uuid(10);
const COACH = uuid(20);
const ME_URL = '/community/me';
const MSGS_URL = `/community/workspaces/${WS}/dms/${COACH}/messages`;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const ME = {
  feature_flag_state: 'enabled', workspace_id: WS,
  membership: { id: uuid(40), role: 'client', notify_level: 'live', dm_enabled_effective: true, last_read_message_at: null, joined_at: ago(86_400_000) },
  unread: { cohort_messages: 0, dm_messages: 0, mentions: 0 },
  flags: { community_api: true, community_dm: true, community_realtime: true, community_push: true, community_telemetry: false },
};
const msg = (n: number, body: string) => ({
  id: uuid(n), thread_id: `${WS}:${[CLIENT, COACH].sort().join(':')}`, sender_user_id: COACH, recipient_user_id: CLIENT, body, created_at: ago(60_000), deleted: false,
});
const FIRST = msg(900, 'See you Monday');
const REPLY = msg(901, 'Change of plan, Tuesday');

function Badge(): null {
  useCommunityBadge(CLIENT); // the one realtime subscription, as ClientNavigator.tsx:736 mounts it
  return null;
}

let replied = false;
beforeEach(() => {
  replied = false;
  mockParams = { recipientId: COACH };
  mockGet.mockReset().mockImplementation(async (url: string) => {
    const key = url.split('?')[0];
    if (key === ME_URL) return { data: ME, headers: {} };
    if (key === '/v1/clients/me/coach') return { data: { id: COACH, name: 'Alex Morgan' }, headers: {} };
    if (key === MSGS_URL) return { data: { messages: replied ? [REPLY, FIRST] : [FIRST] }, headers: {} };
    throw Object.assign(new Error('HTTP 404'), { isAxiosError: true, response: { status: 404, data: { error: 'not_found' } } });
  });
  mockPost.mockReset().mockResolvedValue({ data: {}, headers: {} });
  queryClient.clear();
});
afterEach(() => queryClient.clear());

it('LO-985R2 B1: a reply that reaches the phone only as the realtime ping (no push: quiet hours, Mute all, no token) is drawn in the open thread', async () => {
  const view = await render(
    <QueryClientProvider client={queryClient}>
      <Badge />
      <CommunityDmThreadScreen />
    </QueryClientProvider>,
  );
  try {
    await waitFor(() => expect(view.getByTestId(`dm-message-${FIRST.id}`)).toBeTruthy());
    expect(mockPings.size).toBeGreaterThan(0);
    const meReads = mockGet.mock.calls.filter((c) => String(c[0]).split('?')[0] === ME_URL).length;

    // 21:30 in her zone: the coach replies. The server writes the row and pings her topic; the push waits for 08:00.
    replied = true;
    await act(async () => { for (const ping of [...mockPings]) ping({ event: 'community.message.created' }); });
    // The ping reached the app (its re-read of /community/me went out) ...
    await waitFor(() => expect(mockGet.mock.calls.filter((c) => String(c[0]).split('?')[0] === ME_URL).length).toBeGreaterThan(meReads));
    // ... and the reply is drawn in the thread she has open.
    await waitFor(() => expect(view.queryByTestId(`dm-message-${REPLY.id}`)).not.toBeNull(), { timeout: 12_000 });
  } finally {
    await view.unmount();
  }
}, 30_000);
