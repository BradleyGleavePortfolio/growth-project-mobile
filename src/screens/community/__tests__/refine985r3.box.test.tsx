/**
 * REFINE-985R3 WORDS-1: the message box in the client's DM thread reads "Type a message..." (three full stops, as
 * GOAL 05b's source writes it and as the coaching chat's box already reads, MessagesScreen.tsx), and its spoken label
 * follows it, in a thread with her coach and in any other thread. The thread and its box are real; the HTTP edge is a
 * stand-in. Names and ids are fictional.
 */
import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
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



const CommunityDmThreadScreen = require('../CommunityDmThreadScreen').default;
const { queryClient } = require('../../../services/queryClient');

const uuid = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const WS = uuid(1);
const CLIENT = uuid(10);
const COACH = uuid(20);
const MEMBER = uuid(30);
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const ME = {
  feature_flag_state: 'enabled', workspace_id: WS,
  membership: { id: uuid(40), role: 'client', notify_level: 'live', dm_enabled_effective: true, last_read_message_at: null, joined_at: ago(86_400_000) },
  unread: { cohort_messages: 0, dm_messages: 0, mentions: 0 },
  flags: { community_api: true, community_dm: true, community_realtime: false, community_push: true, community_telemetry: false },
};
const FIELD = 'community-dmthread-composer-field';
const WORDS = 'Type a message...';

let messages: unknown[];
beforeEach(() => {
  messages = [{ id: uuid(900), thread_id: `${WS}:t`, sender_user_id: COACH, recipient_user_id: CLIENT, body: 'See you Monday', created_at: ago(60_000), deleted: false }];
  mockUser = { id: CLIENT, role: 'student', name: 'Dana Cruz', firstName: 'Dana', coach_id: COACH };
  mockGet.mockReset().mockImplementation(async (url: string) => {
    const key = url.split('?')[0];
    if (key === '/community/me') return { data: ME, headers: {} };
    if (key === '/v1/clients/me/coach') return { data: { id: COACH, name: 'Sam Carter' }, headers: {} };
    if (/\/dms\/[^/]+\/messages$/.test(key)) return { data: { messages }, headers: {} };
    throw Object.assign(new Error('HTTP 404'), { isAxiosError: true, response: { status: 404, data: { error: 'not_found' } } });
  });
  mockPost.mockReset().mockResolvedValue({ data: {}, headers: {} });
  queryClient.clear();
});
afterEach(() => queryClient.clear());

describe('WORDS-1: the DM thread\'s message box', () => {
  it.each([
    ['her coach, a conversation', COACH, false],
    ['her coach, an empty thread', COACH, true],
    ['a member', MEMBER, false],
    ['a member, an empty thread', MEMBER, true],
  ])('reads and is spoken as "Type a message..." (%s)', async (_what, other, empty) => {
    if (empty) messages = [];
    mockParams = { recipientId: other };
    const view = await render(<QueryClientProvider client={queryClient}><CommunityDmThreadScreen /></QueryClientProvider>);
    await waitFor(() => expect(view.queryByTestId(FIELD)).not.toBeNull());
    const field = view.getByTestId(FIELD);
    expect(field.props.placeholder).toBe(WORDS);
    expect(field.props.accessibilityLabel).toBe(WORDS);
    expect(view.getByLabelText(WORDS)).toBe(field);
    expect(view.getByPlaceholderText(WORDS)).toBe(field);
    expect(view.queryByPlaceholderText('Message')).toBeNull();
    expect(view.queryByLabelText('Message')).toBeNull();
    await view.unmount();
  });
});
