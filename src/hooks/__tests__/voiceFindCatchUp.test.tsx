/**
 * VOICE-FIND-CATCHUP (LO-881R7's two Cs).
 *
 * Find: a removal ping missed while the phone was locked or the socket was down heals on the way back. An open
 * Find search re-reads once on the first foreground or focus return at least 15 s after its last read, only while
 * the phone is online, and Find then shows only the states it already draws.
 *
 * Badge: one community ping is handled once per query client, however many components call useCommunityBadge
 * (the tab library draws the tab icon twice, and the Community root calls it too while communityHomeV2 is off).
 *
 * Driven on the real seams: the real CommunityFindScreen and useVoiceCatchUp, and the real communityRealtime fan-out
 * over a faked Supabase Realtime client (as communityRealtime.test.ts does); only the REST reads are counted mocks.
 */
import React, { useEffect } from 'react';
import { AccessibilityInfo, AppState, Text, View, type AppStateStatus } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NavigationContainer, NavigationContext } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import NetInfo from '@react-native-community/netinfo';

const mockFlags = { communityVoiceNotes: true, communitySearch: true };
jest.mock('../../config/featureFlags', () => ({
  featureFlags: {
    get communityVoiceNotes() {
      return mockFlags.communityVoiceNotes;
    },
    get communitySearch() {
      return mockFlags.communitySearch;
    },
  },
}));
const mockRuntime = { flags: { community_search: true }, isLoading: false, isError: false };
jest.mock('../useFeatureFlags', () => ({ useFeatureFlags: () => mockRuntime }));
jest.mock('../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../theme/tokens');
  return { useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }) };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../components/HapticPressable', () => {
  const React = require('react');
  const { Pressable } = require('react-native');
  return {
    __esModule: true,
    default: (p: { children: React.ReactNode; onPress?: () => void; testID?: string }) =>
      React.createElement(Pressable, { onPress: p.onPress, testID: p.testID }, p.children),
  };
});
jest.mock('../../components/community', () => ({ ThreadHeader: () => null }));
jest.mock('../../services/sentry', () => ({ captureError: jest.fn() }));
const mockTrack = jest.fn();
jest.mock('../../analytics/posthog.service', () => ({ track: (...a: unknown[]) => mockTrack(...a) }));

// The one Realtime client, faked as communityRealtime.test.ts does: the real fan-out runs on top of it.
jest.mock('../../services/secureStorage', () => ({
  secureStorage: { getItem: jest.fn(async () => 'token-a'), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined) },
}));
type Handler = (msg?: unknown) => void;
interface MockChannel {
  topic: string;
  handlers: Record<string, Handler>;
  on: (type: string, filter: { event: string }, cb: Handler) => MockChannel;
  subscribe: (cb?: (s: string) => void) => MockChannel;
}
const mockChannels: MockChannel[] = [];
const mockRemoveChannel = jest.fn(async (_c: MockChannel) => 'ok');
jest.mock('@supabase/supabase-js', () => {
  const realtime = {
    accessTokenValue: null as string | null,
    accessToken: null as null | (() => Promise<string | null>),
    setAuth: async () => {
      realtime.accessTokenValue = realtime.accessToken ? await realtime.accessToken() : null;
    },
  };
  return {
    createClient: (_u: string, _k: string, opts: { realtime?: { accessToken?: () => Promise<string | null> } }) => {
      realtime.accessToken = opts?.realtime?.accessToken ?? null;
      return {
        realtime,
        removeChannel: (c: MockChannel) => mockRemoveChannel(c),
        channel: (topic: string) => {
          const ch: MockChannel = {
            topic,
            handlers: {},
            on: (_type, filter, cb) => {
              ch.handlers[filter.event] = cb;
              return ch;
            },
            subscribe: (cb) => {
              cb?.('SUBSCRIBED');
              return ch;
            },
          };
          mockChannels.push(ch);
          return ch;
        },
      };
    },
  };
});

// The REST reads, counted.
const mockGetMe = jest.fn();
jest.mock('../../api/communityApi', () => {
  const actual = jest.requireActual('../../api/communityApi');
  return { ...actual, communityApi: { ...actual.communityApi, getMe: (...a: unknown[]) => mockGetMe(...a) } };
});
const mockSearch = jest.fn();
jest.mock('../../api/communitySearchApi', () => {
  const actual = jest.requireActual('../../api/communitySearchApi');
  return { ...actual, communitySearchApi: { search: (...a: unknown[]) => mockSearch(...a) } };
});

import CommunityFindScreen from '../../screens/community/CommunityFindScreen';
import { resetReportedVoiceNotes } from '../../components/community/VoiceReportedFold';
import { communityKeys, useCommunityBadge } from '../useCommunity';
import { VOICE_CATCH_UP_MS } from '../useVoiceFeed';

const BOUND = 15_000; // VOICE_CATCH_UP_MS
const E = {
  created: 'community.message.created',
  updated: 'community.message.updated',
  postUpdated: 'community.post.updated',
  reaction: 'community.reaction.changed',
  membership: 'community.membership.changed',
} as const;

// Fictional, neutral fixtures: a voice note's transcript words and a post, both found by "press".
const SPOKEN = 'slow the bar down on the press';
const POSTED = 'Press day plan for the week';
const hit = (id: string, kind: string, excerpt: string) => ({
  id: `res-${id}`,
  kind,
  targetId: id,
  cohortId: null,
  authorId: 'u-alex',
  excerpt,
  createdAt: new Date(Date.now() - 3_600_000).toISOString(),
});
const VOICE_HIT = hit('vn-1', 'voice_note_transcript', SPOKEN);
const POST_HIT = hit('p-1', 'post', POSTED);
const results = (...rows: unknown[]) => ({ version: 1, query: 'press', results: rows, nextCursor: null, tookMs: 3 });
const ME = { workspace_id: 'ws-1', membership: { role: 'client' }, unread: { cohort_messages: 0, dm_messages: 0, mentions: 0 } };

function newClient(retry: false | ((n: number) => boolean) = false) {
  return new QueryClient({ defaultOptions: { queries: { retry, retryDelay: 0 } } });
}

// The navigation the screen sits in: Back from the voice note page fires 'focus' on Find.
let focusListeners: Array<() => void> = [];
const navigation = {
  navigate: jest.fn(),
  goBack: jest.fn(),
  addListener: (name: string, cb: () => void) => {
    if (name === 'focus') focusListeners.push(cb);
    return () => {
      focusListeners = focusListeners.filter((x) => x !== cb);
    };
  },
};
let appListeners: Array<(s: AppStateStatus) => void> = [];
const realAdd = AppState.addEventListener;
const app = async (s: AppStateStatus) => act(async () => appListeners.forEach((cb) => cb(s)));
const focus = async () => act(async () => focusListeners.forEach((cb) => cb()));
const settle = async () => {
  for (let i = 0; i < 5; i++) await act(async () => new Promise((r) => setTimeout(r, 10)));
};

// The private channel and a ping through the real fan-out.
const userChannels = (userId = 'u-me') => mockChannels.filter((c) => c.topic === `community:user:${userId}`);
const channel = (userId = 'u-me') => userChannels(userId)[userChannels(userId).length - 1];
async function joined(userId = 'u-me') {
  await waitFor(() => expect(channel(userId)).toBeDefined());
}
async function ping(event: string, userId = 'u-me') {
  await act(async () => {
    channel(userId).handlers[event]({ event, payload: { id: 'vn-1' } });
  });
}

/** A component that calls useCommunityBadge as the tab icon and the Community root do. */
let hostMounts = 0;
function Host({ userId = 'u-me', testID }: { userId?: string | null; testID?: string }) {
  const badge = useCommunityBadge(userId);
  useEffect(() => {
    hostMounts += 1;
    return () => {
      hostMounts -= 1;
    };
  }, []);
  return testID ? <Text testID={testID}>{String(badge.total)}</Text> : null;
}
const hosts = (n: number) => Array.from({ length: n }, (_, i) => <Host key={`h${i}`} />);

function Find({ qc, children }: { qc: QueryClient; children?: React.ReactNode }) {
  return (
    <QueryClientProvider client={qc}>
      {children}
      <NavigationContext.Provider value={navigation as never}>
        <CommunityFindScreen />
      </NavigationContext.Provider>
    </QueryClientProvider>
  );
}

const spies: jest.SpyInstance[] = [];
let clock: jest.SpyInstance;
let start = 0;
/** Moves the clock the catch-up and React Query read. */
const at = (ms: number) => clock.mockReturnValue(start + ms);

beforeEach(() => {
  resetReportedVoiceNotes();
  (NetInfo as unknown as { __reset: () => void }).__reset();
  mockRuntime.flags.community_search = true;
  mockFlags.communitySearch = true;
  mockGetMe.mockReset().mockResolvedValue(ME);
  mockSearch.mockReset();
  mockTrack.mockReset();
  mockRemoveChannel.mockClear();
  mockChannels.length = 0; // each test's own joins (every earlier one left with its last host)
  focusListeners = [];
  appListeners = [];
  hostMounts = 0;
  AppState.addEventListener = ((type: string, cb: (s: AppStateStatus) => void) => {
    if (type === 'change') appListeners.push(cb);
    return { remove: () => (appListeners = appListeners.filter((x) => x !== cb)) };
  }) as never;
});
afterEach(() => {
  AppState.addEventListener = realAdd;
  spies.splice(0).forEach((s) => s.mockRestore());
});

/** Find open on "press" with a voice hit and a post hit; the clock is then held where the test puts it. */
async function openFind(qc = newClient(), extra?: React.ReactNode) {
  const view = await render(<Find qc={qc}>{extra}</Find>);
  await fireEvent.changeText(await view.findByTestId('community-search-input'), 'press');
  expect(await view.findByText(SPOKEN, {}, { timeout: 2_000 })).toBeTruthy();
  expect(view.getByText(POSTED)).toBeTruthy();
  expect(mockSearch).toHaveBeenCalledTimes(1);
  start = Date.now();
  clock = jest.spyOn(Date, 'now').mockReturnValue(start);
  spies.push(clock);
  return { ...view, qc };
}

describe('Find catches up after a missed ping', () => {
  beforeEach(() => {
    // The first read finds both; the server now answers without the note a coach removed (its ping was missed).
    mockSearch.mockResolvedValueOnce(results(VOICE_HIT, POST_HIT)).mockResolvedValue(results(POST_HIT));
  });

  it('F1 the app back in front: one search read, the removed note and its spoken label gone, the post kept', async () => {
    const v = await openFind();
    at(BOUND + 1_000);
    await app('background');
    await app('active');
    await waitFor(() => expect(v.queryByText(SPOKEN)).toBeNull());
    expect(v.queryByLabelText(`Voice note. ${SPOKEN}`)).toBeNull();
    expect(v.queryByTestId('community-search-result-res-vn-1')).toBeNull();
    expect(v.getByTestId('community-search-result-res-p-1')).toBeTruthy();
    await settle();
    expect(mockSearch).toHaveBeenCalledTimes(2);
    expect(mockSearch.mock.calls[1][1]).toMatchObject({ q: 'press' });
    expect(VOICE_CATCH_UP_MS).toBe(BOUND);
  });

  it('F2 Back from the voice note page (Find refocused): the same, one read', async () => {
    const v = await openFind();
    at(BOUND + 1_000);
    await focus();
    await waitFor(() => expect(v.queryByText(SPOKEN)).toBeNull());
    expect(v.queryByLabelText(`Voice note. ${SPOKEN}`)).toBeNull();
    expect(v.getByTestId('community-search-result-res-p-1')).toBeTruthy();
    await settle();
    expect(mockSearch).toHaveBeenCalledTimes(2);
    expect(mockSearch.mock.calls[1][1]).toMatchObject({ q: 'press' });
  });

  it('F3 a post removed meanwhile (its post.updated missed): the post hit leaves on return', async () => {
    mockSearch.mockReset().mockResolvedValueOnce(results(VOICE_HIT, POST_HIT)).mockResolvedValue(results(VOICE_HIT));
    const v = await openFind();
    at(BOUND + 1_000);
    await app('active');
    await waitFor(() => expect(v.queryByText(POSTED)).toBeNull());
    expect(v.queryByTestId('community-search-result-res-p-1')).toBeNull();
    expect(v.getByText(SPOKEN)).toBeTruthy();
    await settle();
    expect(mockSearch).toHaveBeenCalledTimes(2);
  });

  it("F4 'active' and focus in one burst read once; again inside 15 s nothing; past another 15 s, once more", async () => {
    await openFind();
    at(BOUND + 1_000);
    await app('inactive');
    await app('active');
    await focus();
    await waitFor(() => expect(mockSearch).toHaveBeenCalledTimes(2));
    await settle();
    expect(mockSearch).toHaveBeenCalledTimes(2);
    at(BOUND + 6_000);
    await app('active');
    await focus();
    await settle();
    expect(mockSearch).toHaveBeenCalledTimes(2);
    at(2 * BOUND + 2_000);
    await focus();
    await app('active');
    await waitFor(() => expect(mockSearch).toHaveBeenCalledTimes(3));
    await settle();
    expect(mockSearch).toHaveBeenCalledTimes(3);
  });
});

describe('F5 when Find does not catch up', () => {
  it('inside 15 s of its last read', async () => {
    mockSearch.mockResolvedValue(results(VOICE_HIT, POST_HIT));
    await openFind();
    at(5_000);
    await app('active');
    await focus();
    await settle();
    expect(mockSearch).toHaveBeenCalledTimes(1);
  });

  it('inside 15 s of a ping re-read (the ping re-read counts as a read)', async () => {
    mockSearch.mockResolvedValueOnce(results(VOICE_HIT, POST_HIT)).mockResolvedValue(results(POST_HIT));
    const v = await openFind(newClient(), <Host />);
    await joined();
    at(BOUND + 1_000);
    await ping(E.updated);
    await waitFor(() => expect(v.queryByText(SPOKEN)).toBeNull());
    expect(mockSearch).toHaveBeenCalledTimes(2);
    at(BOUND + 6_000);
    await app('active');
    await focus();
    await settle();
    expect(mockSearch).toHaveBeenCalledTimes(2);
  });

  it('no term yet (idle): nothing to read', async () => {
    const v = await render(<Find qc={newClient()} />);
    expect(await v.findByTestId('community-find-idle')).toBeTruthy();
    start = Date.now();
    spies.push((clock = jest.spyOn(Date, 'now').mockReturnValue(start + BOUND + 1_000)));
    await app('active');
    await focus();
    await settle();
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('runtime gate off: nothing to read', async () => {
    mockRuntime.flags.community_search = false;
    const v = await render(<Find qc={newClient()} />);
    expect(v.getByText('Search is not available right now.')).toBeTruthy();
    spies.push((clock = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + BOUND + 1_000)));
    await app('active');
    await focus();
    await settle();
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('no workspace: nothing to read', async () => {
    mockGetMe.mockResolvedValue({ ...ME, workspace_id: null });
    const v = await render(<Find qc={newClient()} />);
    await fireEvent.changeText(await v.findByTestId('community-search-input'), 'press');
    await settle();
    spies.push((clock = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + BOUND + 1_000)));
    await app('active');
    await focus();
    await settle();
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('unmount removes both listeners', async () => {
    mockSearch.mockResolvedValue(results(VOICE_HIT, POST_HIT));
    const v = await openFind();
    await v.unmount();
    expect(appListeners).toHaveLength(0);
    expect(focusListeners).toHaveLength(0);
  });
});

describe('F6 offline (KT-11)', () => {
  beforeEach(() => {
    mockSearch.mockResolvedValueOnce(results(VOICE_HIT, POST_HIT)).mockResolvedValue(results(POST_HIT));
  });
  const net = async (isConnected: boolean) =>
    act(async () => (NetInfo as unknown as { __setState: (s: object) => void }).__setState({ isConnected, isInternetReachable: isConnected }));

  it("offline, then 'active': no read, the list stays, no failed state", async () => {
    const v = await openFind();
    await net(false);
    at(BOUND + 1_000);
    await app('background');
    await app('active');
    await focus();
    await settle();
    expect(mockSearch).toHaveBeenCalledTimes(1);
    expect(v.getByText(SPOKEN)).toBeTruthy();
    expect(v.getByText(POSTED)).toBeTruthy();
    expect(v.queryByTestId('community-find-error')).toBeNull();
  });

  it('back online, the next return reads once', async () => {
    const v = await openFind();
    await net(false);
    at(BOUND + 1_000);
    await app('active');
    await settle();
    expect(mockSearch).toHaveBeenCalledTimes(1);
    await net(true);
    at(BOUND + 2_000);
    await app('active');
    await focus();
    await waitFor(() => expect(v.queryByText(SPOKEN)).toBeNull());
    await settle();
    expect(mockSearch).toHaveBeenCalledTimes(2);
  });
});

describe('F7 online, the catch-up read fails with a server error', () => {
  const serverError = () => Object.assign(new Error('Request failed with status code 503'), { response: { status: 503 } });
  // The app's own client (src/services/queryClient.ts): a server error is retried while failureCount < 2.
  const appRetry = (n: number) => n < 2;

  it('ends where a failed ping re-read ends at main: the failed state with Try again, after 3 tries', async () => {
    mockSearch.mockResolvedValueOnce(results(VOICE_HIT, POST_HIT)).mockRejectedValue(serverError());
    const v = await openFind(newClient(appRetry));
    at(BOUND + 1_000);
    await app('active');
    expect(await v.findByTestId('community-find-error')).toBeTruthy();
    expect(v.getByTestId('community-find-retry')).toBeTruthy();
    expect(v.queryByText(SPOKEN)).toBeNull();
    await settle();
    expect(mockSearch).toHaveBeenCalledTimes(4); // the first read, then 3 tries
  });

  it('the same failure on a ping re-read (main): the same failed state after 3 tries', async () => {
    mockSearch.mockResolvedValueOnce(results(VOICE_HIT, POST_HIT)).mockRejectedValue(serverError());
    const v = await openFind(newClient(appRetry), <Host />);
    await joined();
    await ping(E.updated);
    expect(await v.findByTestId('community-find-error')).toBeTruthy();
    await settle();
    expect(mockSearch).toHaveBeenCalledTimes(4);
  });
});

describe('F8 a catch-up that changes the count announces and tracks as a ping re-read does', () => {
  it('catch-up: "1 result" and one COMMUNITY_SEARCH_SUBMITTED with the new count', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
    spies.push(announce);
    mockSearch.mockResolvedValueOnce(results(VOICE_HIT, POST_HIT)).mockResolvedValue(results(POST_HIT));
    const v = await openFind();
    expect(announce).toHaveBeenLastCalledWith('2 results');
    at(BOUND + 1_000);
    await app('active');
    await waitFor(() => expect(v.queryByText(SPOKEN)).toBeNull());
    await settle();
    expect(announce).toHaveBeenLastCalledWith('1 result');
    const submitted = mockTrack.mock.calls.filter((c) => c[0] === 'community_search_submitted');
    expect(submitted.map((c) => c[1])).toEqual([
      { query_length: 5, result_count: 2 },
      { query_length: 5, result_count: 1 },
    ]);
  });

  it('ping re-read (main): the same announcement and event', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
    spies.push(announce);
    mockSearch.mockResolvedValueOnce(results(VOICE_HIT, POST_HIT)).mockResolvedValue(results(POST_HIT));
    const v = await openFind(newClient(), <Host />);
    await joined();
    await ping(E.updated);
    await waitFor(() => expect(v.queryByText(SPOKEN)).toBeNull());
    await settle();
    expect(announce).toHaveBeenLastCalledWith('1 result');
    const submitted = mockTrack.mock.calls.filter((c) => c[0] === 'community_search_submitted');
    expect(submitted.map((c) => c[1])).toEqual([
      { query_length: 5, result_count: 2 },
      { query_length: 5, result_count: 1 },
    ]);
  });
});

describe('one community ping is handled once', () => {
  const meCalls = () => mockGetMe.mock.calls.length;
  const searchCalls = () => mockSearch.mock.calls.length;
  beforeEach(() => {
    mockSearch.mockResolvedValue(results(VOICE_HIT, POST_HIT));
  });

  it('B1 two hosts (communityHomeV2 on: the icon drawn twice), Find open: one community/me read and one search read', async () => {
    await openFind(newClient(), hosts(2));
    await joined();
    await settle();
    const me = meCalls();
    const found = searchCalls();
    await ping(E.updated);
    await waitFor(() => expect(searchCalls()).toBeGreaterThan(found));
    await settle();
    expect(meCalls() - me).toBe(1);
    expect(searchCalls() - found).toBe(1);
  });

  it('B2 three hosts (communityHomeV2 off: the icon twice and the Community root): one each', async () => {
    await openFind(newClient(), hosts(3));
    await joined();
    await settle();
    const me = meCalls();
    const found = searchCalls();
    await ping(E.updated);
    await waitFor(() => expect(searchCalls()).toBeGreaterThan(found));
    await settle();
    expect(meCalls() - me).toBe(1);
    expect(searchCalls() - found).toBe(1);
  });

  it('B2 the real tab library: the tab icon mounts twice, the Community root once more; a ping is still read once', async () => {
    const Tab = createBottomTabNavigator();
    const Empty = () => <View />;
    const CommunityRoot = () => <Host testID="root-badge" />;
    const qc = newClient();
    const v = await render(
      <QueryClientProvider client={qc}>
        <NavigationContainer>
          <Tab.Navigator screenOptions={{ headerShown: false }}>
            <Tab.Screen name="Home" component={Empty} />
            <Tab.Screen name="CommunityTab" component={CommunityRoot} options={{ tabBarIcon: () => <Host />, title: 'Community' }} />
          </Tab.Navigator>
        </NavigationContainer>
      </QueryClientProvider>,
    );
    await joined();
    await settle();
    expect(hostMounts).toBe(2); // B7's state: the Community tab not opened yet, only its icon (two layers)
    await fireEvent.press(v.getByLabelText(/Community/));
    expect(await v.findByTestId('root-badge')).toBeTruthy();
    await settle();
    expect(hostMounts).toBe(3);
    const me = meCalls();
    await ping(E.updated);
    await waitFor(() => expect(meCalls()).toBeGreaterThan(me));
    await settle();
    expect(meCalls() - me).toBe(1);
  });

  it('B3 post.updated refreshes the posts once; created, reaction and membership read community/me once and no search', async () => {
    await openFind(newClient(), hosts(3));
    await joined();
    await settle();
    let me = meCalls();
    let found = searchCalls();
    await ping(E.postUpdated);
    await waitFor(() => expect(searchCalls()).toBeGreaterThan(found));
    await settle();
    expect(meCalls() - me).toBe(1);
    expect(searchCalls() - found).toBe(1);
    for (const event of [E.created, E.reaction, E.membership]) {
      me = meCalls();
      found = searchCalls();
      await ping(event);
      await waitFor(() => expect(meCalls()).toBeGreaterThan(me));
      await settle();
      expect([event, meCalls() - me]).toEqual([event, 1]);
      expect([event, searchCalls() - found]).toEqual([event, 0]);
    }
  });

  it('B4 hosts leave one at a time: handled once while any is mounted; after the last, the channel is left', async () => {
    const qc = newClient();
    const tree = (n: number) => <QueryClientProvider client={qc}>{hosts(n)}</QueryClientProvider>;
    const v = await render(tree(3));
    await joined();
    await settle();
    const ch = channel();
    for (const n of [2, 1]) {
      await v.rerender(tree(n));
      await settle();
      const me = meCalls();
      await ping(E.created);
      await waitFor(() => expect(meCalls()).toBeGreaterThan(me));
      await settle();
      expect([n, meCalls() - me]).toEqual([n, 1]);
    }
    expect(mockRemoveChannel).not.toHaveBeenCalledWith(ch);
    await v.rerender(tree(0));
    await settle();
    expect(mockRemoveChannel).toHaveBeenCalledWith(ch);
    const me = meCalls();
    await act(async () => ch.handlers[E.created]({ event: E.created }));
    await settle();
    expect(meCalls()).toBe(me);
  });

  it('B5 sign-out handles nothing; the next person signs in: only their topic, handled once (KT-13)', async () => {
    const qc = newClient();
    const tree = (userId: string | null) => (
      <QueryClientProvider client={qc}>
        <Host userId={userId} />
        <Host userId={userId} />
        <Host userId={userId} testID="badge" />
      </QueryClientProvider>
    );
    const v = await render(tree('u-me'));
    await joined();
    await settle();
    const mine = channel();
    await v.rerender(tree(null));
    await settle();
    expect(mockRemoveChannel).toHaveBeenCalledWith(mine);
    let me = meCalls();
    await act(async () => mine.handlers[E.created]({ event: E.created }));
    await settle();
    expect(meCalls()).toBe(me);

    await v.rerender(tree('u-two'));
    await joined('u-two');
    await settle();
    me = meCalls();
    await ping(E.created, 'u-two');
    await waitFor(() => expect(meCalls()).toBeGreaterThan(me));
    await settle();
    expect(meCalls() - me).toBe(1);
    // The first person's topic was left and is not joined again (a removed channel delivers nothing).
    expect(userChannels('u-me')).toHaveLength(1);
    expect(userChannels('u-two')).toHaveLength(1);
  });

  it('B6 two query clients: a ping refreshes each client its hosts render under, never a finished one', async () => {
    const qcA = newClient();
    const qcB = newClient();
    const meState = (qc: QueryClient) => qc.getQueryState(communityKeys.me());
    const tree = (withA: boolean) => (
      <>
        {withA ? <QueryClientProvider client={qcA}>{hosts(2)}</QueryClientProvider> : null}
        <QueryClientProvider client={qcB}>{hosts(2)}</QueryClientProvider>
      </>
    );
    const v = await render(tree(true));
    await joined();
    await waitFor(() => expect(meState(qcA)?.status).toBe('success'));
    await waitFor(() => expect(meState(qcB)?.status).toBe('success'));
    await settle();
    const a = meState(qcA)!.dataUpdateCount;
    const b = meState(qcB)!.dataUpdateCount;
    await ping(E.created);
    await waitFor(() => expect(meState(qcB)!.dataUpdateCount).toBeGreaterThan(b));
    await waitFor(() => expect(meState(qcA)!.dataUpdateCount).toBeGreaterThan(a));
    await settle();
    expect(meState(qcA)!.dataUpdateCount - a).toBe(1);
    expect(meState(qcB)!.dataUpdateCount - b).toBe(1);

    await v.rerender(tree(false)); // the first client's screens are gone
    await settle();
    const me = meCalls();
    await ping(E.created);
    await waitFor(() => expect(meCalls()).toBeGreaterThan(me));
    await settle();
    expect(meCalls() - me).toBe(1);
    expect(meState(qcA)!.isInvalidated).toBe(false);
  });

  it('B7 only the tab icon mounted (Community never opened): a ping still refreshes the badge', async () => {
    const qc = newClient();
    const v = await render(
      <QueryClientProvider client={qc}>
        <Host />
        <Host testID="badge" />
      </QueryClientProvider>,
    );
    await joined();
    await waitFor(() => expect(v.getByTestId('badge').props.children).toBe('0'));
    mockGetMe.mockResolvedValue({ ...ME, unread: { cohort_messages: 2, dm_messages: 1, mentions: 0 } });
    const me = meCalls();
    await ping(E.created);
    await waitFor(() => expect(v.getByTestId('badge').props.children).toBe('3'));
    expect(meCalls()).toBeGreaterThan(me);
  });
});
