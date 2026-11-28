/**
 * FIX-DFH-1 (m#1021 fix round 1; LO-DFH-1 B1 = LS-DFH-1 B1). On Community Home no render, the first included, mounts her
 * former coach's card (so neither is it drawn nor her former community's DM list read) until, in that same render, the
 * signed-in person is read, her coach id is that person's, the block list saved on this phone for her is read and her
 * coach row's answer is in; when the person goes (a sign-out) the card goes in that render.
 * As the two B-TESTs beside this file: the real CommunityHomeScreen, SpaceTree, SpaceDrawer, FormerCoach parts, hooks,
 * useCurrentUser, userCache, block store, prefsStorage and react-query; the saved /community/me and space list are put
 * into the cache before mount through the real parsers (a cold start within a day of her last visit). Only the HTTP edge,
 * theme, icons, realtime, navigation and the Challenges page are stood in, and, where a case says so, her saved-user read
 * (held as the phone's storage read can be; the sync view is then empty, as the storage shim's is before its first read)
 * or her saved block list's read. Every boolean switch is on. Names and ids are fictional.
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
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
// The real userCache. Only while a case holds her saved-user read is readUserCache that held promise.
let mockHeld: Promise<unknown> | null = null;
jest.mock('../../../lib/userCache', () => {
  const actual = jest.requireActual('../../../lib/userCache');
  return {
    ...actual,
    readUserCache: () => mockHeld ?? actual.readUserCache(),
    readUserCacheSync: () => (mockHeld ? null : actual.readUserCacheSync()),
  };
});
const mockNav = { navigate: jest.fn(), goBack: jest.fn(), replace: jest.fn(), addListener: () => () => undefined, setOptions: () => undefined };
let mockParams: Record<string, unknown> = {};
jest.mock('@react-navigation/native', () => {
  const R = require('react');
  return {
    NavigationContext: R.createContext(undefined),
    useNavigation: () => mockNav,
    useRoute: () => ({ params: mockParams }),
    useFocusEffect: (cb: () => void | (() => void)) => R.useEffect(() => cb(), [cb]),
    useIsFocused: () => true,
  };
});
jest.mock('../CommunityChallengesScreen', () => {
  const { Text } = require('react-native');
  return () => <Text testID="challenges-list">Challenges list</Text>;
});

const CommunityHomeScreen = require('../CommunityHomeScreen').default;
const { SpaceListButton } = require('../../../components/community/SpaceDrawer');
const { useBlockedUsersStore, persistKeyFor } = require('../../../store/blockedUsersStore');
const { queryClient: appClient } = require('../../../services/queryClient');
const { prefsStorage } = require('../../../storage/mmkv');
const { setUserCache, clearUserCache } = require('../../../lib/userCache');
const { communityApi } = require('../../../api/communityApi');
const { communityKeys } = require('../../../hooks/useCommunity');
const { authEvents } = require('../../../utils/authEvents');

const uuid = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const WS = uuid(1); // her community now (Lee's)
const WS2 = uuid(2); // Maya's community, where she is a former client
const CLIENT = uuid(10); // Dana Cruz
const LEE = uuid(20); // her coach now
const MAYA = uuid(30); // her former coach
const EVERYONE = uuid(60);
const CARD = 'community-home-former-coach';
const COACH_CHAT = ['messaging', 'coach-chat-closed'];
const DANA = { id: CLIENT, email: '', role: 'student', name: 'Dana Cruz', firstName: 'Dana', coach_id: LEE };
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const formerItem = (ws: string, coach: string, name: string) => ({ workspace_id: ws, coach_user_id: coach, coach_display_name: name });
const OLD_ME = {
  feature_flag_state: 'enabled',
  workspace_id: WS,
  membership: { id: uuid(50), role: 'client', notify_level: 'live', dm_enabled_effective: true, last_read_message_at: null, joined_at: '2026-09-01T00:00:00Z' },
  unread: { cohort_messages: 0, dm_messages: 0, mentions: 0 },
  flags: { community_api: true, community_dm: true, community_realtime: false, community_push: true, community_telemetry: false },
};
const ME = { ...OLD_ME, former_coach_dms: [formerItem(WS2, MAYA, 'Maya Brooks')] };
// The saved /me listing her coach now first (the read before her move to Lee was saved, or the server's list lags).
const ME_NOW_FIRST = { ...OLD_ME, former_coach_dms: [formerItem(WS, LEE, 'Lee Tanaka'), formerItem(WS2, MAYA, 'Maya Brooks')] };
const thread = (ws: string, other: string, at: string) => ({ thread_id: `${ws}:${other}`, workspace_id: ws, other_user_id: other, created_at: null, last_message_at: at });
const HTTP: Record<string, unknown> = {
  '/community/me': ME,
  '/community/cohorts': { feature_flag_state: 'enabled', cohorts: [{ id: EVERYONE, workspace_id: WS, name: 'Everyone', is_default: true, kind: 'chat', member_count: 12, my_role: 'client' }] },
  [`/community/workspaces/${WS}`]: { name: "Lee's Studio" },
  '/v1/clients/me/coach': { id: LEE, name: 'Lee Tanaka' },
  '/messages/unread-count': { total: 2 },
  [`/community/workspaces/${WS}/dms`]: { threads: [thread(WS, LEE, ago(3))] },
  [`/community/workspaces/${WS2}/dms`]: { threads: [thread(WS2, MAYA, ago(12))] },
};
let http: Record<string, unknown> = HTTP;
let mockClosed = false; // the coaching-chat read's x-conversation-closed header (b#1141): either person's block
let mockCoachFails = false; // the coaching-chat read fails (offline)
const notFound = () => Object.assign(new Error('HTTP 404'), { isAxiosError: true, response: { status: 404, data: {} } });
const urls = () => mockGet.mock.calls.map((c) => String(c[0]));
const dmListReads = () => urls().filter((u) => u.endsWith('/dms'));
const settle = () => act(async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0));
});

type Node = { props?: Record<string, unknown>; children?: Array<Node | string> | null };
const idsIn = (n: unknown, out: string[] = []): string[] => {
  if (Array.isArray(n)) n.forEach((c) => idsIn(c, out));
  else if (n && typeof n === 'object') {
    const id = (n as Node).props?.testID;
    if (typeof id === 'string') out.push(id);
    ((n as Node).children ?? []).forEach((c) => idsIn(c, out));
  }
  return out;
};
const shown = (id: string) => id.startsWith('space-section-') || id === CARD || (id.startsWith('space-row-') && !id.endsWith('-badge'));
/** The headers, rows and card drawn inside one section of the tree (as formerCoachHome.test.tsx reads them). */
function sectionIds(key: string): string[] | null {
  let found: string[] | null = null;
  const oneSection = (ids: string[]) => ids[0]?.startsWith('space-section-') && ids.filter((i) => i.startsWith('space-section-')).length === 1;
  const visit = (n: unknown) => {
    if (found) return;
    if (Array.isArray(n)) return n.forEach(visit);
    if (!n || typeof n !== 'object') return;
    const kids = ((n as Node).children ?? []).filter((c): c is Node => typeof c === 'object');
    const each = kids.map((c) => idsIn(c));
    if (kids.length > 0 && each.every(oneSection)) {
      const at = each.findIndex((ids) => ids[0] === `space-section-${key}`);
      if (at >= 0) found = each[at].filter(shown);
      return;
    }
    kids.forEach(visit);
  };
  visit(screen.toJSON());
  return found;
}
const noCard = () => {
  expect(screen.queryByTestId(CARD)).toBeNull();
  expect(screen.queryByText('Maya Brooks')).toBeNull();
  expect(screen.queryByText('Former coach')).toBeNull();
};
const cardWithoutCoachRow = () => !!screen.queryByTestId(CARD) && !screen.queryByTestId('space-row-coach');

let qc: QueryClient;
const blockKey = persistKeyFor(CLIENT) as string;
/** The phone as a cold start finds it: the person and her block list saved, /me and the spaces back in the cache. */
async function coldPhone(me: unknown, blocked: string[]) {
  await setUserCache(DANA);
  await prefsStorage.set(blockKey, JSON.stringify(blocked.map((id) => ({ id, displayName: 'Maya Brooks', role: 'coach', blockedAt: '2026-11-20T00:00:00Z' }))));
  http = { ...HTTP, '/community/me': me };
  await qc.prefetchQuery({ queryKey: communityKeys.me(), queryFn: () => communityApi.getMe() });
  await qc.prefetchQuery({ queryKey: communityKeys.cohorts(), queryFn: () => communityApi.getCohorts() });
  expect(qc.getQueryData(communityKeys.me())).toBeTruthy();
  expect(qc.getQueryData(communityKeys.cohorts())).toBeTruthy();
  useBlockedUsersStore.setState({ blocked: [], hydrated: false, userId: null }); // nothing read yet in this launch
  mockGet.mockClear();
}
/** Holds her saved-user read; the returned function lets it answer with Dana. */
function holdPerson(): () => Promise<void> {
  let answer: ((v: unknown) => void) | undefined;
  mockHeld = new Promise((r) => { answer = r; });
  return async () => {
    await act(async () => {
      mockHeld = null;
      answer?.(DANA);
    });
  };
}
const home = () => render(<QueryClientProvider client={qc}><CommunityHomeScreen /></QueryClientProvider>);
/** After the person is read: settle step by step until her coach row's answer is in, checking each step. */
async function stepUntilCoachRow(check: () => void) {
  check();
  for (let i = 0; i < 40 && !screen.queryByTestId('space-row-coach'); i += 1) {
    await settle();
    check();
  }
}

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  Object.values(mockNav).forEach((f) => (typeof f === 'function' && 'mockReset' in f ? (f as jest.Mock).mockReset() : undefined));
  mockFlags.communityDm = true;
  mockParams = {};
  mockHeld = null;
  mockClosed = false;
  mockCoachFails = false;
  http = HTTP;
  mockGet.mockImplementation(async (url: string) => {
    if (url === '/messages?limit=1') {
      if (mockCoachFails) throw new Error('offline');
      return { data: [], headers: mockClosed ? { 'x-conversation-closed': 'blocked_by_them' } : {} };
    }
    const path = url.split('?')[0];
    if (!(path in http)) throw notFound();
    return { data: http[path], headers: {} };
  });
  mockPost.mockImplementation(async () => ({ data: {}, headers: {} }));
  useBlockedUsersStore.setState({ blocked: [], hydrated: false, userId: null });
  appClient.clear();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: Infinity } } });
});
afterEach(async () => {
  mockHeld = null;
  await prefsStorage.delete(blockKey);
  await clearUserCache();
  useBlockedUsersStore.setState({ blocked: [], hydrated: false, userId: null });
  appClient.clear();
  qc.clear();
});

describe('FIX-DFH-1: Community Home waits for the person, her coach id, her saved block list and her coach row', () => {
  it('FIRST: no block; while her saved user is being read no card, no Direct messages header for it and no read of her former community; then the card comes under her coach\'s row, never before it', async () => {
    await coldPhone(ME, []);
    const release = holdPerson();
    const view = await home();
    try {
      expect(await screen.findByLabelText('Everyone')).toBeTruthy(); // the tree drew from the saved copy
      await settle();
      noCard();
      expect(screen.queryByTestId('space-section-dms')).toBeNull();
      expect(dmListReads()).toEqual([]);
      await release();
      await stepUntilCoachRow(() => expect(cardWithoutCoachRow()).toBe(false));
      expect(screen.getByTestId('space-row-coach')).toBeTruthy(); // her coach row's answer is in
      const card = await screen.findByTestId(CARD);
      expect(within(card).getByText('Maya Brooks')).toBeTruthy();
      expect(sectionIds('dms')).toEqual(['space-section-dms', 'space-row-coach', CARD]);
    } finally {
      await view.unmount();
    }
  });

  it('COACH-NOW: the saved /me lists her coach now first; no card and no "Former coach" at any step, before or after her saved user is read', async () => {
    await coldPhone(ME_NOW_FIRST, []);
    const release = holdPerson();
    const view = await home();
    try {
      expect(await screen.findByLabelText('Everyone')).toBeTruthy();
      await settle();
      noCard();
      expect(screen.queryByText('Lee Tanaka')).toBeNull();
      await release();
      await stepUntilCoachRow(noCard);
      expect(screen.getByTestId('space-row-coach')).toBeTruthy();
      await settle();
      noCard();
      expect(dmListReads()).toEqual([]); // neither Lee's community's list nor Maya's: no card ever mounted
    } finally {
      await view.unmount();
    }
  });

  it('CLOSED: her coaching chat closed; while her saved user is being read no header and no card; then the Direct messages header with the card alone', async () => {
    mockClosed = true;
    await coldPhone(ME, []);
    const release = holdPerson();
    const view = await home();
    try {
      expect(await screen.findByLabelText('Everyone')).toBeTruthy();
      await settle();
      noCard();
      expect(screen.queryByTestId('space-section-dms')).toBeNull();
      expect(dmListReads()).toEqual([]);
      await release();
      expect(await screen.findByTestId(CARD)).toBeTruthy();
      expect(screen.queryByTestId('space-row-coach')).toBeNull();
      expect(sectionIds('dms')).toEqual(['space-section-dms', CARD]);
    } finally {
      await view.unmount();
    }
  });

  it('FAILED READ: the coaching-chat read failing and her block of Maya saved, the person read for real: no card at any step', async () => {
    mockCoachFails = true;
    await coldPhone(ME, [MAYA]);
    const view = await home();
    try {
      expect(await screen.findByLabelText('Everyone')).toBeTruthy();
      noCard();
      await waitFor(() => expect(appClient.getQueryState([...COACH_CHAT, LEE])?.status).toBe('error'));
      noCard();
      await waitFor(() => expect(useBlockedUsersStore.getState().hydrated).toBe(true));
      expect(useBlockedUsersStore.getState().blocked.map((b: { id: string }) => b.id)).toEqual([MAYA]);
      expect(await screen.findByTestId('space-row-coach')).toBeTruthy(); // the failed read settled her coach row
      await settle();
      noCard();
      expect(urls()).not.toContain(`/community/workspaces/${WS2}/dms`);
    } finally {
      await view.unmount();
    }
  });

  it('LIST-HELD: her block of Maya saved and its read still out while her coach row\'s read has answered: no card; once it is read, none', async () => {
    await coldPhone(ME, [MAYA]);
    let listAnswer: (() => void) | undefined;
    const listRead = new Promise<void>((r) => { listAnswer = r; });
    const realRead = prefsStorage.getStringAsync.bind(prefsStorage);
    const spy = jest.spyOn(prefsStorage, 'getStringAsync').mockImplementation(async (...a: unknown[]) => {
      if (a[0] === blockKey) await listRead;
      return realRead(...a);
    });
    const view = await home();
    try {
      expect(await screen.findByLabelText('Everyone')).toBeTruthy();
      await waitFor(() => expect(appClient.getQueryState([...COACH_CHAT, LEE])?.status).toBe('success'));
      await settle();
      expect(useBlockedUsersStore.getState().hydrated).toBe(false);
      noCard();
      await act(async () => { listAnswer?.(); });
      await waitFor(() => expect(useBlockedUsersStore.getState().hydrated).toBe(true));
      expect(await screen.findByTestId('space-row-coach')).toBeTruthy();
      await settle();
      noCard();
      expect(urls()).not.toContain(`/community/workspaces/${WS2}/dms`);
    } finally {
      spy.mockRestore();
      await view.unmount();
    }
  });

  it('SIGN-OUT: with the card drawn, signing out takes it off in that render', async () => {
    await coldPhone(ME, []);
    await useBlockedUsersStore.getState().hydrate(CLIENT);
    const view = await home();
    try {
      expect(await screen.findByTestId(CARD)).toBeTruthy();
      expect(sectionIds('dms')).toEqual(['space-section-dms', 'space-row-coach', CARD]);
      await act(async () => { authEvents.emit('logout'); });
      noCard();
      expect(screen.queryByTestId('space-row-coach')).toBeNull();
    } finally {
      await view.unmount();
    }
  });
});

describe('FIX-DFH-1 guards (as at the build once the person is known)', () => {
  it('WARM: the person in userCache\'s mirror and her block list already read: the card under her coach\'s row, as formerCoachHome\'s H1', async () => {
    await coldPhone(ME, []);
    await useBlockedUsersStore.getState().hydrate(CLIENT);
    const view = await home();
    try {
      const card = await screen.findByTestId(CARD);
      await waitFor(() => expect(within(card).getByText('Active 12m ago')).toBeTruthy());
      expect(within(card).getByText('Former coach')).toBeTruthy();
      expect(card.props.accessibilityLabel).toBe('Open conversation with Maya Brooks, former coach');
      expect(screen.getByLabelText('Lee, Your coach, 2 new')).toBeTruthy();
      expect(sectionIds('dms')).toEqual(['space-section-dms', 'space-row-coach', CARD]);
      await fireEvent.press(card);
      expect(mockNav.navigate).toHaveBeenCalledWith('CommunityDmThread', { recipientId: MAYA });
    } finally {
      await view.unmount();
    }
  });

  it('SWITCH: communityDm off, the person read for real: no card and no read of her former community\'s DM list', async () => {
    mockFlags.communityDm = false;
    await coldPhone(ME, []);
    const view = await home();
    try {
      expect(await screen.findByTestId('space-row-coach')).toBeTruthy();
      await settle();
      noCard();
      expect(urls()).not.toContain(`/community/workspaces/${WS2}/dms`);
    } finally {
      await view.unmount();
    }
  });

  it('DRAWER: the space-list drawer with Maya listed, the person read for real: her coach\'s row and no card', async () => {
    mockParams = { cohortId: EVERYONE };
    await coldPhone(ME, []);
    const view = await render(<QueryClientProvider client={qc}><SpaceListButton /></QueryClientProvider>);
    try {
      await fireEvent.press(screen.getByLabelText('Open space list'));
      expect(await screen.findByLabelText('Lee, Your coach, 2 new')).toBeTruthy();
      await settle();
      noCard();
      expect(sectionIds('dms')).toEqual(['space-section-dms', 'space-row-coach']);
    } finally {
      await view.unmount();
    }
  });
});
