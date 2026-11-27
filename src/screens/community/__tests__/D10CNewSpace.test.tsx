/**
 * D10-BUILD-COMMUNITY N1 to N4 and B1 through the page: New space (C6CHAT-S-V2 v1 to v3), opened from the S v2 Home's
 * "+ New space" in the real coach Community stack with every switch on ([R27]). The create goes through the real
 * useCreateCohort and coachCommunityApi.createCohort, so each case reads the exact POST body the server gets.
 *
 * Stubbed as in D10CCoachHome.test.tsx: the HTTP edge, the theme, icons, the device store, the signed-in coach, haptics,
 * the terms gate and the stack's other pages. Package names, ids and counts are made up.
 */
import React from 'react';
import { Alert } from 'react-native';
import { NavigationContainer, createNavigationContainerRef, type ParamListBase } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
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
  coachApi: { getClients: async () => ({ data: [] }) },
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
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => mockTheme(),
  LightTheme: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('@expo/vector-icons', () => {
  const R = require('react');
  const Icon = (p: Record<string, unknown>) => R.createElement('Icon', p);
  return { Ionicons: Icon, MaterialIcons: Icon, Feather: Icon };
});
jest.mock('../../../storage/mmkv', () => {
  const disk = new Map<string, string>();
  return {
    cacheStorage: {
      getString: (k: string) => disk.get(k), getStringAsync: async (k: string) => disk.get(k),
      set: async (k: string, v: string) => { disk.set(k, v); }, delete: async (k: string) => { disk.delete(k); },
      getAllKeys: async () => [...disk.keys()],
    },
    prefsStorage: { getString: () => undefined },
  };
});
jest.mock('../../../hooks/useCurrentUser', () => ({
  ...jest.requireActual('../../../hooks/useCurrentUser'),
  useCurrentUser: () => ({ id: 'coach-sam', role: 'coach', name: 'Sam Rivera', firstName: 'Sam', coach_id: null }),
}));
const mockHaptics = { selection: jest.fn(), success: jest.fn(), error: jest.fn(), warning: jest.fn(), softImpact: jest.fn(), mediumImpact: jest.fn(), heavyImpact: jest.fn(), lightImpact: jest.fn() };
jest.mock('../../../ui/haptics/haptics.service', () => ({ HapticService: mockHaptics }));
jest.mock('../../../components/community/CommunityTermsGate', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => children,
}));
{
  const fs = jest.requireActual('fs');
  const path = jest.requireActual('path');
  const source: string = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'navigation', 'CoachCommunityNavigator.tsx'), 'utf8');
  for (const match of source.matchAll(/^import (?!type\b)[^;]*? from '\.\.\/(screens\/[^']+)'/gm)) {
    const modulePath = match[1] as string;
    if (modulePath.endsWith('/CoachSpacesHomeScreen') || modulePath.endsWith('/CoachNewSpaceScreen')) continue;
    const label = modulePath.split('/').pop() as string;
    const keep = modulePath.endsWith('/CoachCommunityInboxScreen') ? `../../../${modulePath}` : null;
    jest.doMock(`../../../${modulePath}`, () => ({
      ...(keep ? jest.requireActual(keep) : {}),
      __esModule: true,
      default: () => require('react').createElement(require('react-native').Text, null, label),
    }));
  }
}

/* eslint-disable @typescript-eslint/no-var-requires */
const CoachCommunityNavigator = require('../../../navigation/CoachCommunityNavigator').default;
const { forestPop: fp, schemeCard } = require('../../../theme/tokens');
/* eslint-enable @typescript-eslint/no-var-requires */

const uuid = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const WS = uuid(1);
const ME = { feature_flag_state: 'enabled', workspace_id: WS, membership: null,
  unread: { cohort_messages: 0, dm_messages: 0, mentions: 0 },
  flags: { community_api: true, community_dm: true, community_realtime: false, community_push: true, community_telemetry: false } };
const SPACES = [
  { id: uuid(11), workspace_id: WS, name: 'Announcements', member_count: 12, kind: 'announcement', visibility: 'clients', unread_count: 0 },
  { id: uuid(12), workspace_id: WS, name: 'Everyone', member_count: 12, kind: 'chat', visibility: 'clients', unread_count: 0 },
];
const pkg = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id, name, status: 'active', archived_at: null, published_at: '2026-10-01T00:00:00.000Z', amount_cents: 9900, currency: 'usd',
  billing_interval: 'month', billing_interval_count: 1, subscriber_count: 24, monthly_revenue_cents: 237600, ...extra,
});
const PACKAGES = [
  pkg('pkg-spring', 'Spring 8-week plan'),
  pkg('pkg-strength', 'Strength 1:1', { subscriber_count: 1 }),
  pkg('pkg-checkin', 'Check-in coaching', { subscriber_count: undefined, monthly_revenue_cents: undefined }),
  pkg('pkg-old', 'Old plan', { status: 'archived', archived_at: '2026-09-01T00:00:00.000Z' }),
  pkg('pkg-draft', 'Draft plan', { published_at: null, status: undefined }),
];
const axiosErr = (status: number) => Object.assign(new Error(`HTTP ${status}`), { isAxiosError: true, response: { status, data: {} } });
const PENDING = Symbol('pending');
type Answer = unknown | (() => unknown);
let http: Record<string, Answer> = {};
function serve(extra: Record<string, Answer> = {}) {
  http = { '/community/me': ME, [`/community/workspaces/${WS}/dms`]: { threads: [] }, '/community/cohorts': { cohorts: SPACES },
    '/v1/coach/packages': { packages: PACKAGES }, ...extra };
  mockGet.mockImplementation(async (url: string) => {
    const key = url.split('?')[0];
    if (!(key in http)) throw axiosErr(404);
    const a = http[key];
    const value = typeof a === 'function' ? (a as () => unknown)() : a;
    if (value instanceof Error) throw value;
    if (value === PENDING) return new Promise(() => undefined);
    return { data: value, headers: {} };
  });
}
const created = (name: string) => ({ data: { cohort: { id: uuid(40), workspace_id: WS, name, created_at: '2026-11-27T00:00:00.000Z' } } });
const packageReads = () => mockGet.mock.calls.filter(([url]) => url === '/v1/coach/packages').length;

const Root = createNativeStackNavigator();
const ref = createNavigationContainerRef<ParamListBase>();
type View = Awaited<ReturnType<typeof render>>;
async function openNewSpace(): Promise<View> {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: Infinity }, mutations: { retry: false } } });
  const view = await render(
    <QueryClientProvider client={qc}>
      <NavigationContainer ref={ref}>
        <Root.Navigator screenOptions={{ headerShown: false }}>
          <Root.Screen name="CommunityStack" component={CoachCommunityNavigator} />
        </Root.Navigator>
      </NavigationContainer>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(view.getByTestId('coach-home-new-space')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('coach-home-new-space')); });
  await waitFor(() => expect(ref.getCurrentRoute()?.name).toBe('CoachCommunityNewSpace'));
  return view;
}
const press = (view: View, id: string) => act(async () => { fireEvent.press(view.getByTestId(id)); });
const type = (view: View, text: string) => act(async () => { fireEvent.changeText(view.getByTestId('new-space-name'), text); });
const disabled = (view: View, id: string) => view.getByTestId(id).props.accessibilityState?.disabled === true;
const title = (view: View) => view.getByTestId('new-space-title');
async function toVisibility(view: View, name = 'Food on the go', kind: 'chat' | 'announcement' = 'chat') {
  await type(view, name);
  if (kind === 'announcement') await press(view, 'new-space-kind-announcement');
  await press(view, 'new-space-next');
  await waitFor(() => expect(title(view).props.children).toBe('Visibility'));
}
async function toPackages(view: View) {
  await press(view, 'new-space-package');
  await waitFor(() => expect(title(view).props.children).toBe('Included with a package'));
}
const postBody = () => {
  expect(mockPost).toHaveBeenCalledTimes(1);
  return mockPost.mock.calls[0][1];
};

beforeEach(() => {
  for (const k of Object.keys(mockFlags)) if (typeof mockFlags[k] === 'boolean') mockFlags[k] = true;
  mockGet.mockReset();
  mockPost.mockReset().mockImplementation(async (_url: string, body: { name: string }) => created(body.name));
  Object.values(mockHaptics).forEach((f) => f.mockReset());
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('N1: v1, the name and the kind', () => {
  it('Next is off for "" and " a ", on for "ab"; the field takes 120 characters, never the 121st', async () => {
    serve();
    const view = await openNewSpace();
    expect(title(view).props.accessibilityLabel).toBe('New space, step 1 of 2');
    expect(view.getByText('1 of 2', { includeHiddenElements: true })).toBeTruthy();
    expect(view.getByTestId('new-space-back').props.accessibilityLabel).toBe('Close');
    expect(view.getByTestId('new-space-name').props.maxLength).toBe(120);
    expect(disabled(view, 'new-space-next')).toBe(true);
    await type(view, ' a ');
    expect(disabled(view, 'new-space-next')).toBe(true);
    await type(view, 'ab');
    expect(disabled(view, 'new-space-next')).toBe(false);
    await type(view, 'x'.repeat(121));
    expect(view.getByTestId('new-space-name').props.value).toHaveLength(120);
  });

  it('Chat space is picked first; the two kinds are a radio group with their words; no Section card', async () => {
    serve();
    const view = await openNewSpace();
    const chat = view.getByTestId('new-space-kind-chat');
    const announce = view.getByTestId('new-space-kind-announcement');
    expect(chat.props.accessibilityRole).toBe('radio');
    expect(chat.props.accessibilityState).toEqual({ checked: true });
    expect(chat.props.accessibilityLabel).toBe('Chat space, Everyone in the space can post.');
    expect(announce.props.accessibilityLabel).toBe('Announcement space, Only you post. Members react and reply in threads.');
    expect(announce.props.accessibilityState).toEqual({ checked: false });
    expect(view.queryByText('Section')).toBeNull();
    expect(view.queryByText(/levels deep/)).toBeNull();
    await press(view, 'new-space-kind-announcement');
    expect(view.getByTestId('new-space-kind-announcement').props.accessibilityState).toEqual({ checked: true });
    expect(mockHaptics.selection).toHaveBeenCalledTimes(1);
  });

  it('v2: "Who can join {name}?", All my clients picked, the package card a button; no Public card, no "change this later"', async () => {
    serve();
    const view = await openNewSpace();
    await toVisibility(view);
    expect(title(view).props.accessibilityLabel).toBe('Visibility, step 2 of 2');
    expect(view.getByText('Who can join Food on the go?')).toBeTruthy();
    const clients = view.getByTestId('new-space-clients');
    expect(clients.props.accessibilityRole).toBe('radio');
    expect(clients.props.accessibilityState).toEqual({ checked: true });
    expect(clients.props.accessibilityLabel).toBe('All my clients, Every client you coach now. Access ends when they stop being your client.');
    const pack = view.getByTestId('new-space-package');
    expect(pack.props.accessibilityRole).toBe('button');
    expect(pack.props.accessibilityLabel).toBe('Included with a package, Clients with the packages you pick. Access ends when their package ends.');
    expect(view.queryByText('Public on TGP')).toBeNull();
    expect(view.queryByText('You can change this later.')).toBeNull();
    // R5: the selected card is the scheme card.
    const flat = jest.requireActual('react-native').StyleSheet.flatten(clients.props.style);
    expect(flat).toEqual(expect.objectContaining({ ...schemeCard }));
  });
});

describe('N2: Back and Close keep or drop the entries', () => {
  it('Back on v2 returns to v1 with the name and kind; Close on v1 leaves to the Home', async () => {
    serve();
    const view = await openNewSpace();
    await toVisibility(view, 'Food on the go', 'announcement');
    await press(view, 'new-space-back');
    expect(title(view).props.children).toBe('New space');
    expect(view.getByTestId('new-space-name').props.value).toBe('Food on the go');
    expect(view.getByTestId('new-space-kind-announcement').props.accessibilityState).toEqual({ checked: true });
    await press(view, 'new-space-back');
    await waitFor(() => expect(ref.getCurrentRoute()?.name).toBe('CoachCommunityHome'));
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('Back on v3 returns to v2 with the picks kept (no second read); the system Back steps back the same way', async () => {
    serve();
    const view = await openNewSpace();
    await toVisibility(view);
    await toPackages(view);
    await waitFor(() => expect(view.getByTestId('new-space-pkg-pkg-spring')).toBeTruthy());
    await press(view, 'new-space-pkg-pkg-spring');
    await press(view, 'new-space-back');
    expect(title(view).props.children).toBe('Visibility');
    await toPackages(view);
    expect(view.getByTestId('new-space-pkg-pkg-spring').props.accessibilityState).toEqual({ checked: true });
    expect(packageReads()).toBe(1);
    // Android's Back (and the iOS swipe) go through the stack's back: v3 -> v2 -> v1, then out.
    await act(async () => { ref.goBack(); });
    expect(title(view).props.children).toBe('Visibility');
    await act(async () => { ref.goBack(); });
    expect(title(view).props.children).toBe('New space');
    expect(ref.getCurrentRoute()?.name).toBe('CoachCommunityNewSpace');
    await act(async () => { ref.goBack(); });
    await waitFor(() => expect(ref.getCurrentRoute()?.name).toBe('CoachCommunityHome'));
  });
});

describe('N3: v3, the packages', () => {
  it('the live packages only, each a checkbox; "{n} active clients" only when the server counts; Create off with no pick', async () => {
    serve();
    const view = await openNewSpace();
    await toVisibility(view);
    await toPackages(view);
    expect(view.getByText('Pick packages')).toBeTruthy();
    expect(view.getByText('Clients with any of these packages can open Food on the go.')).toBeTruthy();
    await waitFor(() => expect(view.getByTestId('new-space-pkg-pkg-spring')).toBeTruthy());
    expect(view.queryByTestId('new-space-pkg-pkg-old')).toBeNull();
    expect(view.queryByTestId('new-space-pkg-pkg-draft')).toBeNull();
    const spring = view.getByTestId('new-space-pkg-pkg-spring');
    expect(spring.props.accessibilityRole).toBe('checkbox');
    expect(spring.props.accessibilityLabel).toBe('Spring 8-week plan, 24 active clients');
    expect(view.getByTestId('new-space-pkg-pkg-strength').props.accessibilityLabel).toBe('Strength 1:1, 1 active client');
    expect(view.getByTestId('new-space-pkg-pkg-checkin').props.accessibilityLabel).toBe('Check-in coaching');
    expect(within(view.getByTestId('new-space-pkg-pkg-checkin')).queryByText(/active client/)).toBeNull();
    expect(disabled(view, 'new-space-create')).toBe(true);
    await press(view, 'new-space-pkg-pkg-spring');
    expect(view.getByTestId('new-space-pkg-pkg-spring').props.accessibilityState).toEqual({ checked: true });
    const flat = jest.requireActual('react-native').StyleSheet.flatten(view.getByTestId('new-space-pkg-pkg-spring').props.style);
    expect(flat).toEqual(expect.objectContaining({ ...schemeCard }));
    expect(disabled(view, 'new-space-create')).toBe(false);
    expect(view.queryByText(/clients get access now/)).toBeNull();
  });

  it('loading: still rows, "Loading your packages", busy', async () => {
    serve({ '/v1/coach/packages': PENDING });
    const view = await openNewSpace();
    await toVisibility(view);
    await toPackages(view);
    const loading = view.getByTestId('new-space-packages-loading');
    expect(loading.props.accessibilityLabel).toBe('Loading your packages');
    expect(loading.props.accessibilityState).toEqual({ busy: true });
    expect(disabled(view, 'new-space-create')).toBe(true);
  });

  it('failed: the words and Try again, which reads again', async () => {
    serve({ '/v1/coach/packages': axiosErr(503) });
    const view = await openNewSpace();
    await toVisibility(view);
    await toPackages(view);
    await waitFor(() => expect(view.getByTestId('new-space-packages-failed')).toBeTruthy());
    expect(view.getByText('Your packages did not load. Check your connection, then try again.')).toBeTruthy();
    expect(disabled(view, 'new-space-create')).toBe(true);
    http['/v1/coach/packages'] = { packages: PACKAGES };
    await press(view, 'new-space-packages-retry');
    await waitFor(() => expect(view.getByTestId('new-space-pkg-pkg-spring')).toBeTruthy());
    expect(packageReads()).toBe(2);
  });

  it('none live: "No packages to pick yet." and Create stays off', async () => {
    serve({ '/v1/coach/packages': { packages: [PACKAGES[3], PACKAGES[4]] } });
    const view = await openNewSpace();
    await toVisibility(view);
    await toPackages(view);
    await waitFor(() => expect(view.getByText('No packages to pick yet.')).toBeTruthy());
    expect(disabled(view, 'new-space-create')).toBe(true);
  });
});

describe('N4: the create', () => {
  it('a failed create says why (alertCoachFailure), keeps every entry and turns Create on again', async () => {
    serve();
    mockPost.mockReset().mockRejectedValue(axiosErr(409));
    const view = await openNewSpace();
    await toVisibility(view, 'Food on the go', 'announcement');
    await press(view, 'new-space-create');
    await waitFor(() => expect(Alert.alert).toHaveBeenCalledTimes(1));
    expect(ref.getCurrentRoute()?.name).toBe('CoachCommunityNewSpace');
    expect(title(view).props.children).toBe('Visibility');
    await waitFor(() => expect(disabled(view, 'new-space-create')).toBe(false));
    await press(view, 'new-space-back');
    expect(view.getByTestId('new-space-name').props.value).toBe('Food on the go');
    expect(view.getByTestId('new-space-kind-announcement').props.accessibilityState).toEqual({ checked: true });
  });

  it('a double tap sends once', async () => {
    serve();
    let answer: (v: unknown) => void = () => undefined;
    mockPost.mockReset().mockImplementation(() => new Promise((r) => { answer = r; }));
    const view = await openNewSpace();
    await toVisibility(view);
    await act(async () => {
      fireEvent.press(view.getByTestId('new-space-create'));
      fireEvent.press(view.getByTestId('new-space-create'));
    });
    await press(view, 'new-space-create');
    expect(mockPost).toHaveBeenCalledTimes(1);
    await act(async () => { answer(created('Food on the go')); });
  });

  it('success: the success tick, back on the Home with the new space first and its tag', async () => {
    serve();
    let answer: (v: unknown) => void = () => undefined;
    mockPost.mockReset().mockImplementation(() => new Promise((r) => { answer = r; }));
    const view = await openNewSpace();
    await toVisibility(view);
    await press(view, 'new-space-create');
    await act(async () => { answer(created('Food on the go')); });
    await waitFor(() => expect(ref.getCurrentRoute()?.name).toBe('CoachCommunityHome'));
    expect(mockHaptics.success).toHaveBeenCalledTimes(1);
    const rows = view.getAllByTestId(/^coach-home-space-/);
    expect(rows[0].props.accessibilityLabel).toBe('Food on the go, Clients');
    expect(jest.requireActual('react-native').StyleSheet.flatten(rows[0].props.style).borderLeftColor).toBe(fp.leaf);
  });
});

describe('B1 through the page: the exact body for every kind and every choice', () => {
  it.each([
    ['chat', 'All my clients', [] as string[]],
    ['announcement', 'All my clients', []],
    ['chat', 'one package', ['pkg-spring']],
    ['announcement', 'one package', ['pkg-checkin']],
    ['chat', 'two packages', ['pkg-spring', 'pkg-checkin']],
    ['announcement', 'two packages', ['pkg-strength', 'pkg-spring']],
  ])('%s x %s', async (kind, _who, picks) => {
    serve();
    const view = await openNewSpace();
    await toVisibility(view, '  Food on the go ', kind as 'chat' | 'announcement');
    if (picks.length > 0) {
      await toPackages(view);
      await waitFor(() => expect(view.getByTestId('new-space-pkg-pkg-spring')).toBeTruthy());
      for (const id of picks) await press(view, `new-space-pkg-${id}`);
    }
    await press(view, 'new-space-create');
    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1));
    expect(mockPost.mock.calls[0][0]).toBe(`/community/workspaces/${WS}/cohorts`);
    const listed = PACKAGES.map((p) => p.id).filter((id) => picks.includes(id));
    expect(postBody()).toStrictEqual(picks.length > 0
      ? { name: 'Food on the go', kind, visibility: 'package', package_ids: listed }
      : { name: 'Food on the go', kind, visibility: 'clients' });
  });
});
