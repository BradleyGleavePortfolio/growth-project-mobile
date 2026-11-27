/**
 * DM-FORMER-HOME-M (OPERATOR RULING 7213408207 item 5; owner ALM-P1, #ALM-E12: Style 3 "Coaches first", capped at her
 * one most recent former coach; row 1b). With Community Home on, a client who has a coach now and was another coach's
 * client before finds her former coach's card (m#1002's FormerCoachEntry, as on her messages list) at the end of Home's
 * Direct messages section, under her coach's row. It waits for her coach row's answer (useCoachChatClosed `known`, so
 * the block list saved on the phone is read first), follows featureFlags.communityDm, folds with the section, and the
 * space-list drawer never draws it.
 * The real CommunityHomeScreen, SpaceTree, SpaceDrawer, FormerCoach parts, hooks, communityApi and react-query; only the
 * HTTP edge, theme, icons, realtime, navigation, the signed-in person and the Challenges page are stood in. Every
 * boolean switch is on. Names and ids are fictional.
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
// Every boolean switch on (as formerCoachReach.test.tsx); SWITCH turns communityDm off and beforeEach turns it on again.
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
let mockUser: { id: string; role: string; name: string; firstName: string; coach_id?: string } | null = null;
jest.mock('../../../hooks/useCurrentUser', () => ({ ...jest.requireActual('../../../hooks/useCurrentUser'), useCurrentUser: () => mockUser }));
jest.mock('../../../lib/userCache', () => ({ ...jest.requireActual('../../../lib/userCache'), readUserCacheSync: () => null }));
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
// CommunityHomeScreen.test.tsx's Challenges stand-in (the page is its own suite).
jest.mock('../CommunityChallengesScreen', () => {
  const { Text } = require('react-native');
  return () => <Text testID="challenges-list">Challenges list</Text>;
});

const CommunityHomeScreen = require('../CommunityHomeScreen').default;
const { SpaceListButton } = require('../../../components/community/SpaceDrawer');
const { useBlockedUsersStore, persistKeyFor } = require('../../../store/blockedUsersStore');
const { queryClient: appClient } = jest.requireActual('../../../services/queryClient');
const { prefsStorage } = jest.requireActual('../../../storage/mmkv');

const uuid = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const WS = uuid(1); // her community now (Lee's)
const WS2 = uuid(2); // Maya's community, where she is a former client
const WS3 = uuid(3); // a second former community the server lists (never drawn)
const CLIENT = uuid(10); // Dana Cruz
const LEE = uuid(20); // her coach now
const MAYA = uuid(30); // her former coach
const RILEY = uuid(31); // a second former coach
const EVERYONE = uuid(60);
const CARD = 'community-home-former-coach';
const COACH_CHAT = ['messaging', 'coach-chat-closed'];
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const FLAGS = { community_api: true, community_dm: true, community_realtime: false, community_push: true, community_telemetry: false };
const MEMBERSHIP = { id: uuid(50), role: 'client', notify_level: 'live', dm_enabled_effective: true, last_read_message_at: null, joined_at: '2026-09-01T00:00:00Z' };
const OLD_ME = { feature_flag_state: 'enabled', workspace_id: WS, membership: MEMBERSHIP, unread: { cohort_messages: 0, dm_messages: 0, mentions: 0 }, flags: FLAGS };
const formerItem = (ws: string, coach: string, name?: string | null) => ({ workspace_id: ws, coach_user_id: coach, ...(name !== undefined ? { coach_display_name: name } : {}) });
const ME = { ...OLD_ME, former_coach_dms: [formerItem(WS2, MAYA, 'Maya Brooks'), formerItem(WS3, RILEY, 'Riley Shah')] };
const thread = (ws: string, other: string, at: string) => ({ thread_id: `${ws}:${other}`, workspace_id: ws, other_user_id: other, created_at: null, last_message_at: at });
// Trap (ii): the real parser (CommunityCohortListResponseSchema) must pass, or Home draws its failed page.
const COHORTS = { feature_flag_state: 'enabled', cohorts: [{ id: EVERYONE, workspace_id: WS, name: 'Everyone', is_default: true, kind: 'chat', member_count: 12, my_role: 'client' }] };
const base = (): Record<string, unknown> => ({
  '/community/me': ME,
  '/community/cohorts': COHORTS,
  [`/community/workspaces/${WS}`]: { name: "Lee's Studio" },
  '/v1/clients/me/coach': { id: LEE, name: 'Lee Tanaka' },
  '/messages/unread-count': { total: 2 },
  [`/community/workspaces/${WS}/dms`]: { threads: [thread(WS, LEE, ago(3))] },
  [`/community/workspaces/${WS2}/dms`]: { threads: [thread(WS2, MAYA, ago(12))] },
  [`/community/workspaces/${WS3}/dms`]: { threads: [thread(WS3, RILEY, ago(1))] },
});
const notFound = () => Object.assign(new Error('HTTP 404'), { isAxiosError: true, response: { status: 404, data: {} } });

let mockClosed = false; // the coaching-chat read's x-conversation-closed header (b#1141): either person's block
let mockCoachFails = false; // the coaching-chat read fails (offline)
let mockHold: Promise<void> | null = null; // the coaching-chat read is still out
function serve(http: Record<string, unknown>) {
  mockGet.mockImplementation(async (url: string) => {
    // Trap (i): the coaching-chat read keeps its query string and answers with its own header.
    if (url === '/messages?limit=1') {
      if (mockHold) await mockHold;
      if (mockCoachFails) throw new Error('offline');
      return { data: [], headers: mockClosed ? { 'x-conversation-closed': 'blocked_by_them' } : {} };
    }
    const key = url.split('?')[0];
    if (!(key in http)) throw notFound();
    const v = http[key];
    if (typeof v === 'function') return (v as () => unknown)();
    return { data: v, headers: {} };
  });
  mockPost.mockImplementation(async () => ({ data: {}, headers: {} }));
}
const urls = () => mockGet.mock.calls.map((c) => String(c[0]));
const otherCommunityReads = () => urls().filter((u) => u.startsWith('/community/workspaces/') && !u.startsWith(`/community/workspaces/${WS}`));

let qc: QueryClient;
const home = () => render(<QueryClientProvider client={qc}><CommunityHomeScreen /></QueryClientProvider>);
const drawer = () => render(<QueryClientProvider client={qc}><SpaceListButton /></QueryClientProvider>);
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
/** The headers, rows and card drawn inside one section of the tree: the tree's root holds one view per section, each
 * starting with its own header and holding no other. */
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

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  Object.values(mockNav).forEach((f) => (typeof f === 'function' && 'mockReset' in f ? (f as jest.Mock).mockReset() : undefined));
  mockFlags.communityDm = true;
  mockUser = { id: CLIENT, role: 'student', name: 'Dana Cruz', firstName: 'Dana', coach_id: LEE };
  mockParams = {};
  mockClosed = false;
  mockCoachFails = false;
  mockHold = null;
  useBlockedUsersStore.setState({ blocked: [], hydrated: false, userId: null });
  appClient.clear();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: Infinity } } });
});
afterEach(() => {
  useBlockedUsersStore.setState({ blocked: [], hydrated: false, userId: null });
  appClient.clear();
  qc.clear();
});

describe('her former coach on Community Home (Direct messages, Style 3 card)', () => {
  it('H1: the card sits in Direct messages under her coach\'s row, before Community safety: overline, serif name, the time; no badge', async () => {
    serve(base());
    await home();
    const card = await screen.findByTestId(CARD);
    await waitFor(() => expect(within(card).getByText('Active 12m ago')).toBeTruthy());
    expect(within(card).getByText('Former coach')).toBeTruthy();
    expect(within(card).getByText('Maya Brooks')).toBeTruthy();
    expect(within(card).getByText('M', { includeHiddenElements: true })).toBeTruthy();
    expect(card.props.accessibilityLabel).toBe('Open conversation with Maya Brooks, former coach');
    expect(card.props.accessibilityValue).toEqual({ text: 'active 12m ago' });
    expect(within(card).queryByTestId(/badge/)).toBeNull();
    expect(within(card).queryByText(/^\d+\+?$/)).toBeNull(); // row 1b: no count, though her coach's row has its C3 count
    expect(screen.getByLabelText('Lee, Your coach, 2 new')).toBeTruthy();
    expect(sectionIds('dms')).toEqual(['space-section-dms', 'space-row-coach', CARD]);
    const all = idsIn(screen.toJSON());
    expect(all.indexOf(CARD)).toBeLessThan(all.indexOf('community-home-safety'));
  });

  it('H2: with no coach_display_name the title is "Former coach" once, with no overline, a blank tile and the plain spoken label', async () => {
    serve({ ...base(), '/community/me': { ...OLD_ME, former_coach_dms: [formerItem(WS2, MAYA)] } });
    await home();
    const card = await screen.findByTestId(CARD);
    expect(within(card).getAllByText('Former coach')).toHaveLength(1);
    const tile = screen.getByTestId(`${CARD}-tile`, { includeHiddenElements: true });
    expect(within(tile).queryByText(/./, { includeHiddenElements: true })).toBeNull();
    expect(card.props.accessibilityLabel).toBe('Open conversation with your former coach');
  });

  it('ONE: a second listed former coach is never drawn or read; her coach now listed first draws no card', async () => {
    serve(base());
    const view = await home();
    await screen.findByTestId('space-row-coach');
    await settle();
    expect(screen.queryByText('Riley Shah')).toBeNull();
    expect(urls()).not.toContain(`/community/workspaces/${WS3}/dms`);
    await view.unmount();
    qc.clear();
    mockGet.mockClear();
    serve({ ...base(), '/community/me': { ...OLD_ME, former_coach_dms: [formerItem(WS, LEE, 'Lee Tanaka'), formerItem(WS2, MAYA, 'Maya Brooks')] } });
    await home();
    await screen.findByTestId('space-row-coach');
    await settle();
    noCard();
    expect(otherCommunityReads()).toEqual([]);
  });

  it('TAP: one press opens that conversation (the tap her messages list makes); nothing is replaced', async () => {
    serve(base());
    await home();
    await fireEvent.press(await screen.findByTestId(CARD));
    expect(mockNav.navigate).toHaveBeenCalledTimes(1);
    expect(mockNav.navigate).toHaveBeenCalledWith('CommunityDmThread', { recipientId: MAYA });
    expect(mockNav.replace).not.toHaveBeenCalled();
  });

  it('H3: her coach\'s chat closed: no coach row; the Direct messages header with the card alone', async () => {
    mockClosed = true;
    serve(base());
    await home();
    await screen.findByTestId(CARD);
    expect(screen.queryByTestId('space-row-coach')).toBeNull();
    expect(screen.queryByText(/Your coach/)).toBeNull();
    expect(screen.getByTestId('space-section-dms').props.accessibilityLabel).toBe('Direct messages');
    expect(sectionIds('dms')).toEqual(['space-section-dms', CARD]);
  });

  it('H4: folding Direct messages by its header takes the card with it; unfolding brings it back', async () => {
    serve(base());
    await home();
    await screen.findByTestId('space-row-coach');
    await settle();
    await fireEvent.press(screen.getByTestId('space-section-dms'));
    expect(screen.getByTestId('space-section-dms').props.accessibilityState).toEqual({ expanded: false });
    expect(sectionIds('dms')).toEqual(['space-section-dms']);
    expect(screen.queryByTestId(CARD)).toBeNull();
    await fireEvent.press(screen.getByTestId('space-section-dms'));
    expect(sectionIds('dms')).toEqual(['space-section-dms', 'space-row-coach', CARD]);
  });

  it('WAIT: while her coach row\'s answer is out neither her coach\'s row nor the card is drawn; both appear together', async () => {
    let release: (() => void) | undefined;
    mockHold = new Promise<void>((r) => { release = () => r(); });
    serve(base());
    await home();
    expect(await screen.findByLabelText('Everyone')).toBeTruthy(); // the tree drew
    await settle();
    expect(screen.queryByTestId('space-row-coach')).toBeNull();
    expect(screen.queryByTestId(CARD)).toBeNull();
    expect(screen.queryByTestId('space-section-dms')).toBeNull();
    await act(async () => { release?.(); });
    expect(await screen.findByTestId('space-row-coach')).toBeTruthy();
    expect(screen.getByTestId(CARD)).toBeTruthy();
    expect(sectionIds('dms')).toEqual(['space-section-dms', 'space-row-coach', CARD]);
  });

  // FR-880R3's pattern (CommunityHomeScreen.test.tsx): a fresh launch reads the block list saved on this phone first.
  it('COLD: cold start, her block of Maya saved on the phone and the coaching-chat read failing: the card is never drawn', async () => {
    const key = persistKeyFor(CLIENT);
    await prefsStorage.set(key, JSON.stringify([{ id: MAYA, displayName: 'Maya Brooks', role: 'coach', blockedAt: '2026-11-20T00:00:00Z' }]));
    useBlockedUsersStore.setState({ blocked: [], hydrated: false, userId: null }); // nothing read yet, as on a cold start
    mockCoachFails = true;
    try {
      serve(base());
      await home();
      expect(await screen.findByLabelText('Everyone')).toBeTruthy(); // the tree drew
      noCard();
      await waitFor(() => expect(appClient.getQueryState([...COACH_CHAT, LEE])?.status).toBe('error'));
      noCard();
      await waitFor(() => expect(useBlockedUsersStore.getState().hydrated).toBe(true));
      expect(useBlockedUsersStore.getState().blocked.map((b: { id: string }) => b.id)).toEqual([MAYA]);
      expect(await screen.findByTestId('space-row-coach')).toBeTruthy(); // her coach row's answer is in
      await settle();
      noCard();
      expect(urls()).not.toContain(`/community/workspaces/${WS2}/dms`);
    } finally {
      mockCoachFails = false;
      await prefsStorage.delete(key);
    }
  });

  it('BLOCK: her block of Maya in the block store takes the card off at once', async () => {
    serve(base());
    await home();
    await screen.findByTestId(CARD);
    await act(async () => {
      useBlockedUsersStore.setState({ blocked: [{ id: MAYA, displayName: 'Maya Brooks', blockedAt: '2026-11-27T00:00:00Z' }] });
    });
    noCard();
    expect(screen.getByTestId('space-row-coach')).toBeTruthy();
  });

  it('BLOCK: the server leaving Maya out of the next /me read takes the card off on that read', async () => {
    serve(base());
    await home();
    await screen.findByTestId(CARD);
    serve({ ...base(), '/community/me': { ...ME, former_coach_dms: [] } });
    await act(async () => { await qc.invalidateQueries({ queryKey: ['community', 'me'] }); });
    await waitFor(() => expect(screen.queryByTestId(CARD)).toBeNull());
    noCard();
    expect(screen.getByTestId('space-row-coach')).toBeTruthy();
  });

  it('SWITCH: with communityDm off there is no card and no read of her former community\'s DM list', async () => {
    mockFlags.communityDm = false;
    serve(base());
    await home();
    await screen.findByTestId('space-row-coach');
    await settle();
    noCard();
    expect(urls()).not.toContain(`/community/workspaces/${WS2}/dms`);
  });

  it('OLD: /me with no former_coach_dms field: Home as before, no read of another community', async () => {
    serve({ ...base(), '/community/me': OLD_ME });
    await home();
    expect(await screen.findByLabelText('Lee, Your coach, 2 new')).toBeTruthy();
    await settle();
    noCard();
    expect(sectionIds('dms')).toEqual(['space-section-dms', 'space-row-coach']);
    expect(otherCommunityReads()).toEqual([]);
  });

  it('OTHER: the loading skeleton draws no card', async () => {
    serve({ ...base(), '/community/cohorts': () => new Promise(() => undefined) });
    await home();
    expect(await screen.findByTestId('community-home-loading')).toBeTruthy();
    await settle();
    noCard();
  });

  it('OTHER: a failed read with Try again draws no card', async () => {
    serve({ ...base(), '/community/cohorts': () => { throw notFound(); } });
    await home();
    expect(await screen.findByTestId('community-home-error')).toBeTruthy();
    expect(screen.getByTestId('community-home-retry')).toBeTruthy();
    await settle();
    noCard();
  });

  it('OTHER: the Challenges page draws no card', async () => {
    serve(base());
    await home();
    await screen.findByTestId('space-row-coach');
    await fireEvent.press(screen.getByTestId('community-home-tab-challenges'));
    expect(screen.getByTestId('challenges-list')).toBeTruthy();
    await settle();
    noCard();
  });
});

describe('the space-list drawer (R2: never the card)', () => {
  it('DRAWER: with Maya listed, her coach\'s row as before and no card, also when filtered by "maya"', async () => {
    mockParams = { cohortId: EVERYONE };
    serve(base());
    await drawer();
    await fireEvent.press(screen.getByLabelText('Open space list'));
    expect(await screen.findByLabelText('Lee, Your coach, 2 new')).toBeTruthy();
    await settle();
    noCard();
    expect(sectionIds('dms')).toEqual(['space-section-dms', 'space-row-coach']);
    await fireEvent.changeText(screen.getByLabelText('Jump to a space or person'), 'maya');
    await settle();
    noCard();
    expect(screen.queryByTestId('space-section-dms')).toBeNull();
    await fireEvent.changeText(screen.getByLabelText('Jump to a space or person'), 'lee');
    expect(sectionIds('dms')).toEqual(['space-section-dms', 'space-row-coach']);
    noCard();
  });
});
