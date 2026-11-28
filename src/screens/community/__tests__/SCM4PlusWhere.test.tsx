/**
 * SC-M4 (agent 203), case T1: where the space chat's "+" shows. The real screen, hook, outbox and rows (the stand-ins of
 * FIX945R4SpaceStates.test.tsx), the server answering by space. The "+" is found by its testID alone (space-chat-plus),
 * so this table imports nothing of SC-M4's and runs at the base. Owner 203-D34 op 1 and R1: iPhone only; A.1: only for a
 * person the server let in on this visit who may post in this space, never while a reply holds the box (R4), never in a
 * space only the coach posts in for a member, closed, loading, failed or restored from the saved cache.
 */
import React from 'react';
import { Alert, Platform } from 'react-native';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { authEvents } from '../../../utils/authEvents';

const mockDisk = new Map<string, string>();
jest.mock('../../../storage/mmkv', () => ({
  cacheStorage: {
    getString: () => undefined,
    getStringAsync: async (k: string) => mockDisk.get(k),
    set: async (k: string, v: string) => { mockDisk.set(k, v); },
    delete: async (k: string) => { mockDisk.delete(k); },
    getAllKeys: async () => [...mockDisk.keys()],
  },
}));
jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return { useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }) };
});
const mockFlags = { communitySpaceChat: true, communityVoiceNotes: true };
jest.mock('../../../config/featureFlags', () => ({ featureFlags: mockFlags }));
const mockParams: { current: { cohortId: string } } = { current: { cohortId: 'c-a' } };
const mockStack = { routes: ['CommunityTab', 'CommunitySpaceChat'] };
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), getState: () => ({ routeNames: mockStack.routes }) }),
  useRoute: () => ({ params: mockParams.current }),
  useIsFocused: () => true,
}));
jest.mock('../../../components/community/SpaceDrawer', () => {
  const { Text } = jest.requireActual('react-native');
  return { SpaceListButton: ({ label, testID = 'space-list-open' }: { label?: string; testID?: string }) => <Text testID={testID} accessibilityLabel={label ?? 'Open space list'}>{label ?? 'list'}</Text> };
});
let mockUser = { id: 'me-1', name: 'Dana Reyes', coach_id: 'coach-1' };
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('react-native-safe-area-context', () => {
  const { createContext, createElement } = require('react');
  const { View } = require('react-native');
  const insets = { top: 47, right: 0, bottom: 34, left: 0 };
  return {
    SafeAreaView: ({ children, style, testID }: { children?: unknown; style?: unknown; testID?: string }) => createElement(View, { style, testID }, children),
    SafeAreaInsetsContext: createContext(insets),
    useSafeAreaInsets: () => insets,
  };
});
jest.mock('../../../hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => ({ isOnline: true, isInternetReachable: null }),
  isEffectivelyOnline: jest.requireActual('../../../hooks/useNetworkStatus').isEffectivelyOnline,
}));
let mockRole = 'client';
jest.mock('../../../hooks/useCommunity', () => ({
  useCommunityCohorts: () => ({
    data: { feature_flag_state: 'on', cohorts: [
      { id: 'c-a', workspace_id: 'ws', name: 'Running', is_default: true, kind: 'default', member_count: 12, my_role: mockRole },
      { id: 'c-ann', workspace_id: 'ws', name: 'Announcements', is_default: false, kind: 'announcement', posting_policy: 'coach', member_count: 24, my_role: mockRole },
    ] },
    isLoading: false, isError: false, refetch: jest.fn(),
  }),
  useCommunityMe: () => ({ dataUpdatedAt: 0 }),
  communityKeys: { cohorts: () => ['community', 'cohorts'], me: () => ['community', 'me'] },
}));
jest.mock('../../../components/community/VoiceNotePlayer', () => {
  const { Text } = jest.requireActual('react-native');
  return (p: { testID: string }) => <Text testID={p.testID}>player</Text>;
});
jest.mock('../../../api/communityVoiceApi', () => ({ communityVoiceApi: { getOne: jest.fn(async () => ({ url: 'https://x/v.m4a' })), remove: jest.fn() } }));
const mockVoice = { items: [] as unknown[], online: true, send: jest.fn(), retry: jest.fn(), discard: jest.fn() };
jest.mock('../../../hooks/useVoiceOutbox', () => ({ useVoiceOutbox: () => mockVoice }));
jest.mock('../../../components/community/VoiceRecordSheet', () => {
  const { Text } = jest.requireActual('react-native');
  return { __esModule: true, default: (p: { visible: boolean; target: { cohortName: string } }) => (p.visible ? <Text testID="voice-sheet">{p.target.cohortName}</Text> : null) };
});
jest.mock('../../../components/community/SafetyMenu', () => {
  const { Text } = jest.requireActual('react-native');
  return (p: { testID: string }) => <Text testID={p.testID}>menu</Text>;
});
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));
const mockApi = { get: jest.fn(), post: jest.fn(), delete: jest.fn() };
jest.mock('../../../services/api', () => ({ __esModule: true, default: mockApi }));

const Screen = require('../CommunitySpaceChatScreen').default;

type Who = { id: string; name: string; is_coach?: boolean };
const COACH: Who = { id: 'coach-1', name: 'Sam Okafor', is_coach: true };
const JO: Who = { id: 'u-2', name: 'jo b.' };
const msg = (id: string, at: string, who: Who, cohort: string) => ({
  id, cohort_id: cohort, sender_user_id: who.id, body: `body ${id}`, kind: 'text', created_at: at, updated_at: at,
  edited: false, deleted: false, parent_message_id: null, voice_note: null,
  sender: { id: who.id, name: who.name, avatar_url: null, is_coach: !!who.is_coach },
});
const fail = (status: number, data: Record<string, unknown> = {}) =>
  Object.assign(new Error(`HTTP ${status}`), { isAxiosError: true, response: { status, data } });

type Space = { page: unknown[]; refuse?: number; hold?: boolean };
let spaces: Record<string, Space> = {};
let sendAnswer: (() => Promise<unknown>) | null = null;
const realOS = Platform.OS;
const setOS = (os: string) => Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });

beforeEach(() => {
  authEvents.emit('logout');
  mockDisk.clear();
  (jest.requireMock('expo-secure-store') as { __store: Map<string, string> }).__store.set('supabase_token', 'tok-me-1');
  mockStack.routes = ['CommunityTab', 'CommunitySpaceChat'];
  mockRole = 'client';
  mockUser = { id: 'me-1', name: 'Dana Reyes', coach_id: 'coach-1' };
  mockParams.current = { cohortId: 'c-a' };
  mockFlags.communityVoiceNotes = true;
  sendAnswer = null;
  spaces = {
    'c-a': { page: [msg('a2', '2026-10-22T09:30:00.000Z', JO, 'c-a'), msg('a1', '2026-10-22T08:00:00.000Z', COACH, 'c-a')] },
    'c-ann': { page: [msg('n1', '2026-10-22T08:00:00.000Z', COACH, 'c-ann')] },
  };
  mockApi.get.mockReset().mockImplementation(async (url: string) => {
    const [, id, what] = /^\/community\/cohorts\/([^/]+)\/(messages|read|members)$/.exec(url) ?? [];
    const space = spaces[id];
    if (!space) throw fail(404);
    if (what === 'members') return { data: { members: [], next_cursor: null } };
    if (what === 'read') return { data: { last_read_at: null, last_read_message_id: null } };
    if (space.refuse) throw fail(space.refuse);
    if (space.hold) return new Promise(() => undefined);
    return { data: { messages: space.page, next_before: null } };
  });
  mockApi.post.mockReset().mockImplementation(async (url: string) => {
    if (url.endsWith('/read')) return { data: { ok: true } };
    if (sendAnswer) return sendAnswer();
    return { data: { message: msg('sent-1', new Date().toISOString(), { id: 'me-1', name: 'Dana Reyes' }, 'c-a') } };
  });
  mockApi.delete.mockReset().mockResolvedValue({ data: {} });
});

let client: QueryClient;
let alert: jest.SpyInstance;
beforeEach(() => { alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined); });
afterEach(() => {
  client?.clear();
  alert.mockRestore();
  setOS(realOS);
});
const tree = () => <QueryClientProvider client={client}><Screen /></QueryClientProvider>;
const open = async (before?: (c: QueryClient) => void) => {
  client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
  before?.(client);
  const r = await render(tree());
  await waitFor(() => expect(mockApi.get).toHaveBeenCalled());
  return r;
};
type R = Awaited<ReturnType<typeof open>>;
const wait = (ms: number) => act(async () => { await new Promise((res) => setTimeout(res, ms)); });
const asCoach = () => {
  mockRole = 'owner';
  mockUser = { id: 'coach-1', name: 'Sam Okafor', coach_id: '' };
  mockStack.routes = ['CoachCommunityCohorts', 'CoachCommunityCohortDetail', 'CommunitySpaceChat'];
  (jest.requireMock('expo-secure-store') as { __store: Map<string, string> }).__store.set('supabase_token', 'tok-coach-1');
};
const replyTo = async (r: R, id: string) => {
  await fireEvent(await r.findByTestId(`space-chat-row-${id}`), 'longPress');
  let node = r.getByTestId('space-chat-sheet') as unknown as { props: Record<string, unknown>; parent: unknown } | null;
  while (node && typeof node.props.onDismiss !== 'function') node = node.parent as typeof node;
  await fireEvent.press(r.getByTestId('space-chat-sheet-reply'));
  await act(async () => { (node?.props.onDismiss as (() => void) | undefined)?.(); });
  await r.findByLabelText(/^Replying to /);
};
const plusIn = (r: R) => {
  const bar = r.queryByTestId('space-chat-composer');
  return bar ? within(bar).queryByTestId('space-chat-plus') : null;
};

/** Each state: how to reach it, and whether the box is drawn there. */
type Case = { name: string; plus: boolean; box: boolean; reach: () => Promise<R> };
const CASES: Case[] = [
  { name: 'a member in an open space', plus: true, box: true, reach: async () => {
    const r = await open();
    await r.findByTestId('space-chat-composer-field');
    return r;
  } },
  { name: 'the coach in an open space', plus: true, box: true, reach: async () => {
    asCoach();
    const r = await open();
    await r.findByTestId('space-chat-composer-field');
    return r;
  } },
  { name: 'the coach in a space only the coach posts in', plus: true, box: true, reach: async () => {
    asCoach();
    mockParams.current = { cohortId: 'c-ann' };
    const r = await open();
    await r.findByTestId('space-chat-composer-field');
    return r;
  } },
  { name: 'a member in a space only the coach posts in (the band)', plus: false, box: false, reach: async () => {
    mockParams.current = { cohortId: 'c-ann' };
    const r = await open();
    await r.findByTestId('space-chat-hint');
    return r;
  } },
  { name: "that member answering the coach's post (her reply's box)", plus: false, box: true, reach: async () => {
    mockParams.current = { cohortId: 'c-ann' };
    const r = await open();
    await r.findByTestId('space-chat-hint');
    await replyTo(r, 'n1');
    await r.findByTestId('space-chat-composer-field');
    return r;
  } },
  { name: 'that member with her reply refused for its words (taken back into the box)', plus: false, box: true, reach: async () => {
    mockParams.current = { cohortId: 'c-ann' };
    const r = await open();
    await r.findByTestId('space-chat-hint');
    await replyTo(r, 'n1');
    sendAnswer = async () => { throw fail(422, { code: 'community.content.rejected' }); };
    await fireEvent.changeText(r.getByTestId('space-chat-composer-field'), 'Count me in');
    await fireEvent.press(r.getByTestId('space-chat-composer-send'));
    await waitFor(() => expect(alert).toHaveBeenCalled());
    await waitFor(() => expect(r.getByTestId('space-chat-composer-field').props.value).toBe('Count me in'));
    return r;
  } },
  { name: 'a member with a reply set in an open space (empty slot, no "+")', plus: false, box: true, reach: async () => {
    const r = await open();
    await r.findByTestId('space-chat-composer-field');
    await replyTo(r, 'a2');
    return r;
  } },
  { name: 'the coach with a reply set', plus: false, box: true, reach: async () => {
    asCoach();
    const r = await open();
    await r.findByTestId('space-chat-composer-field');
    await replyTo(r, 'a2');
    return r;
  } },
  { name: 'a space closed on arrival (403)', plus: false, box: false, reach: async () => {
    spaces['c-a'].refuse = 403;
    const r = await open();
    await r.findByTestId('space-chat-no-access');
    return r;
  } },
  { name: 'a space closed on arrival (404)', plus: false, box: false, reach: async () => {
    spaces['c-a'].refuse = 404;
    const r = await open();
    await r.findByTestId('space-chat-no-access');
    return r;
  } },
  { name: 'an open space that closes (its next read refused, 403)', plus: false, box: false, reach: async () => {
    const r = await open();
    await r.findByTestId('space-chat-composer-field');
    spaces['c-a'].refuse = 403;
    await act(async () => { await client.refetchQueries(); });
    await r.findByTestId('space-chat-no-access');
    return r;
  } },
  { name: 'an open space that closes (a send refused, 404)', plus: false, box: false, reach: async () => {
    const r = await open();
    await r.findByTestId('space-chat-composer-field');
    sendAnswer = async () => { throw fail(404); };
    await fireEvent.changeText(r.getByTestId('space-chat-composer-field'), 'Still here?');
    await fireEvent.press(r.getByTestId('space-chat-composer-send'));
    await r.findByTestId('space-chat-no-access');
    return r;
  } },
  { name: 'loading (the first read not answered)', plus: false, box: false, reach: async () => {
    spaces['c-a'].hold = true;
    const r = await open();
    await r.findByTestId('space-chat-loading');
    await wait(30);
    return r;
  } },
  { name: 'a failed read (500)', plus: false, box: false, reach: async () => {
    spaces['c-a'].refuse = 500;
    const r = await open();
    await r.findByTestId('space-chat-error', {}, { timeout: 4000 });
    return r;
  } },
  { name: 'a cold start from the saved cache, before the server answers', plus: false, box: false, reach: async () => {
    spaces['c-a'].hold = true;
    const r = await open((c) => c.setQueryData(['community', 'space-chat', 'me-1', 'c-a'], { pages: [{ messages: spaces['c-a'].page, next_before: null }], pageParams: [null] }));
    await r.findByTestId('space-chat-row-a2');
    await wait(30);
    return r;
  } },
  { name: 'a member in an open space with communityVoiceNotes off (no mic)', plus: true, box: true, reach: async () => {
    mockFlags.communityVoiceNotes = false;
    const r = await open();
    await r.findByTestId('space-chat-composer-field');
    expect(r.queryByTestId('space-chat-mic')).toBeNull();
    return r;
  } },
];

describe.each(['ios', 'android'])('SCM4PlusWhere (T1): Platform.OS %s', (os) => {
  it.each(CASES.map((c) => [c.name, c] as const))('%s', async (_n, c) => {
    setOS(os);
    const r = await c.reach();
    expect(!!r.queryByTestId('space-chat-composer-field')).toBe(c.box);
    const shows = os === 'ios' && c.plus;
    if (shows) {
      expect(plusIn(r)).toBeTruthy();
      expect(r.getAllByTestId('space-chat-plus')).toHaveLength(1);
    } else {
      expect(r.queryByTestId('space-chat-plus')).toBeNull();
    }
  });
});
