/**
 * B-TEST LS-D10C-1 B1 (m#1022 at 1d451956): on an iPhone, swiping back on New space step 2 or 3 must never leave a
 * page that UIKit has already removed in front of the coach stack's JS state.
 *
 * The coach stack is a native stack (CoachCommunityNavigator.tsx:50-51). On iOS the swipe pops the page in UIKit
 * first and only then tells JS (NativeStackView's onDismissed, which dispatches a pop). A raw 'beforeRemove' listener
 * that calls preventDefault cannot hold that swipe: the pop is refused in JS, the page is already gone natively, and
 * react-native-screens never re-attaches a dismissed screen. The Home is then on screen while New space stays the
 * focused route, so "+ New space" (navigate to the route already in front) does nothing. Only a route marked through
 * usePreventRemove (native-stack then sets preventNativeDismiss) or one with gestureEnabled false is safe; this repo
 * recorded the same trap at src/navigation/ClientNavigator.tsx:533-536 (m#521).
 *
 * The real coach Community stack and the real New space page; the HTTP edge, theme, icons and the other pages are
 * stubbed as in D10CNewSpace.test.tsx. Names and ids are made up.
 */
import React from 'react';
import { NavigationContainer, createNavigationContainerRef, type ParamListBase } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
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

// eslint-disable-next-line @typescript-eslint/no-var-requires
const CoachCommunityNavigator = require('../../../navigation/CoachCommunityNavigator').default;

const uuid = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const WS = uuid(1);
const ME = { feature_flag_state: 'enabled', workspace_id: WS, membership: null,
  unread: { cohort_messages: 0, dm_messages: 0, mentions: 0 },
  flags: { community_api: true, community_dm: true, community_realtime: false, community_push: true, community_telemetry: false } };
const SPACES = [
  { id: uuid(11), workspace_id: WS, name: 'Announcements', member_count: 12, kind: 'announcement', visibility: 'clients', unread_count: 0 },
];
const HTTP: Record<string, unknown> = {
  '/community/me': ME, [`/community/workspaces/${WS}/dms`]: { threads: [] }, '/community/cohorts': { cohorts: SPACES },
  '/v1/coach/packages': { packages: [] },
};

const Root = createNativeStackNavigator();
const ref = createNavigationContainerRef<ParamListBase>();
type Shown = Awaited<ReturnType<typeof render>>;
type NativeScreen = { props: { screenId?: string; gestureEnabled?: boolean; preventNativeDismiss?: boolean;
  onDismissed?: (e: { nativeEvent: { dismissCount: number } }) => void };
  queryAll: (match: (n: NativeScreen) => boolean) => NativeScreen[] };

/** The native stack's own host screen for a route (ScreenStackItem carries the route key as screenId; RNTL 14 reads host elements only). */
function nativeScreenOf(view: Shown, key: string): NativeScreen {
  const root = view.root as unknown as NativeScreen;
  const found = [root, ...root.queryAll(() => true)].filter((n) => n.props?.screenId === key && typeof n.props?.onDismissed === 'function');
  expect(found.length).toBeGreaterThan(0);
  return found[0];
}

it('B1: an iPhone swipe-back on step 2 never leaves a natively removed New space in front of the stack', async () => {
  for (const k of Object.keys(mockFlags)) if (typeof mockFlags[k] === 'boolean') mockFlags[k] = true;
  mockGet.mockImplementation(async (url: string) => {
    const key = url.split('?')[0];
    if (!(key in HTTP)) throw Object.assign(new Error('HTTP 404'), { isAxiosError: true, response: { status: 404, data: {} } });
    return { data: HTTP[key], headers: {} };
  });
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
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
  await act(async () => { fireEvent.changeText(view.getByTestId('new-space-name'), 'Food on the go'); });
  await act(async () => { fireEvent.press(view.getByTestId('new-space-next')); });
  await waitFor(() => expect(view.getByTestId('new-space-title').props.children).toBe('Visibility'));

  const route = ref.getCurrentRoute();
  const screen = nativeScreenOf(view, route?.key as string);
  // The only two ways a native stack holds the iOS swipe: usePreventRemove (preventNativeDismiss) or no gesture at all.
  const holdsSwipe = screen.props.preventNativeDismiss === true || screen.props.gestureEnabled === false;
  if (!holdsSwipe) {
    // What UIKit does on a swipe it was allowed to finish: the page is popped, then JS is told.
    await act(async () => { screen.props.onDismissed?.({ nativeEvent: { dismissCount: 1 } }); });
  }
  const left = ref.getCurrentRoute()?.name === 'CoachCommunityHome';
  // Held natively, or gone from JS too. Never: removed natively and still the focused route.
  expect({ holdsSwipe, left, focused: ref.getCurrentRoute()?.name }).toEqual(
    holdsSwipe ? { holdsSwipe: true, left: false, focused: 'CoachCommunityNewSpace' } : { holdsSwipe: false, left: true, focused: 'CoachCommunityHome' },
  );
});
