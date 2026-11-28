/**
 * LO-D10C-1 B1 (lens B-TEST for m#1022 @ 1d451956): on v2 and v3 New space steps back instead of leaving. The page holds
 * that with a raw navigation.addListener('beforeRemove'), which native-stack cannot hold against the iOS swipe: it only
 * passes preventNativeDismiss to the native screen for usePreventRemove (NativeStackView.native.tsx:208, :278, :411).
 * So the swipe dismisses the page natively, the JS pop is prevented, and the stack keeps a route the phone no longer
 * shows (useDismissedRouteError.tsx:21-23); "+ New space" then navigates to the focused route and pushes nothing.
 * The harness is D10CNewSpace.test.tsx's (the real coach Community stack, every switch on, the HTTP edge stubbed).
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
beforeEach(() => {
  for (const k of Object.keys(mockFlags)) if (typeof mockFlags[k] === 'boolean') mockFlags[k] = true;
  mockGet.mockReset();
  mockPost.mockReset().mockImplementation(async (_url: string, body: { name: string }) => created(body.name));
  Object.values(mockHaptics).forEach((f) => f.mockReset());
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

/** The native screen (react-native-screens) that hosts New space: the host node with onDismissed above the page. */
type HostNode = { parent: HostNode | null; props: Record<string, unknown>; type: unknown };
function nativeScreenOf(view: View): HostNode {
  let node: HostNode | null = view.getByTestId('coach-new-space') as unknown as HostNode;
  while (node && !(typeof node.type === 'string' && typeof node.props.onDismissed === 'function')) node = node.parent;
  if (!node) throw new Error('no native screen above New space');
  return node;
}

describe('LO-D10C-1 B1: the iOS swipe on v2 and v3', () => {
  it('while v2 or v3 is open the native screen cannot be dismissed by the swipe (preventNativeDismiss or gestureEnabled false)', async () => {
    serve();
    const view = await openNewSpace();
    await toVisibility(view);
    const v2 = nativeScreenOf(view).props;
    expect({ step: 'v2', held: v2.preventNativeDismiss === true || v2.gestureEnabled === false }).toEqual({ step: 'v2', held: true });
    await toPackages(view);
    const v3 = nativeScreenOf(view).props;
    expect({ step: 'v3', held: v3.preventNativeDismiss === true || v3.gestureEnabled === false }).toEqual({ step: 'v3', held: true });
  });
});
