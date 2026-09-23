/**
 * S6-P1 — RootNavigator is the identity authority for the persisted query
 * cache (REQUIRED post-fix suite).
 *
 * Renders the REAL RootNavigator with the real `lib/userCache` (AsyncStorage
 * shim), real `queryClient`, real `PersistedQueryCacheGate`; collaborators
 * that touch network/native are mocked exactly as in
 * rootNavigatorAcceptLink.test.tsx.
 *
 * Pins parent decision (b): the committed bootstrap result — token present AND
 * user readable — is the only thing that may authorize restoring a user's
 * persisted queries. A cached user whose token is missing must NOT have their
 * cache read, and the auth stack must render with an empty cache.
 */
const mockSecure: Record<string, string | null> = {};
jest.mock('../services/secureStorage', () => ({
  secureStorage: {
    getItem: jest.fn(async (k: string) => mockSecure[k] ?? null),
    setItem: jest.fn(async (k: string, v: string) => {
      mockSecure[k] = v;
    }),
    removeItem: jest.fn(async (k: string) => {
      delete mockSecure[k];
    }),
  },
}));
jest.mock('../services/authActions', () => ({ signOut: jest.fn(async () => {}) }));
jest.mock('../services/api', () => ({
  __esModule: true,
  default: {
    get: jest.fn(async () => ({ data: { is_complete: true } })),
    post: jest.fn(async () => ({ data: {} })),
  },
}));
jest.mock('react-native/Libraries/Linking/Linking', () => ({
  __esModule: true,
  default: {
    getInitialURL: jest.fn(async () => null),
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
    openURL: jest.fn(async () => true),
  },
}));
jest.mock('@react-navigation/native', () => {
  const React = jest.requireActual('react');
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    NavigationContainer: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    createNavigationContainerRef: () => ({
      isReady: () => true,
      navigate: jest.fn(),
      resetRoot: jest.fn(),
      current: null,
    }),
  };
});
jest.mock('../navigation/AuthNavigator', () => {
  const React = jest.requireActual('react');
  const { Text } = jest.requireActual('react-native');
  return () => React.createElement(Text, { testID: 'nav-auth' }, 'auth');
});
jest.mock('../navigation/CoachNavigator', () => {
  const React = jest.requireActual('react');
  const { Text } = jest.requireActual('react-native');
  const { queryClient } = jest.requireActual('../services/queryClient');
  // The private surface reports what it can see from the cache at mount.
  return () => {
    const me = queryClient.getQueryData(['me']);
    return React.createElement(Text, { testID: 'nav-coach' }, me ? JSON.stringify(me) : 'none');
  };
});
jest.mock('../navigation/ClientNavigator', () => () => null);
jest.mock('../navigation/OnboardingNavigator', () => () => null);
jest.mock('../navigation/LeanOnboardingNavigator', () => () => null);
jest.mock('../navigation/CoachWizardNavigator', () => () => null);
jest.mock('../navigation/Day1OnboardingNavigator', () => () => null);
jest.mock('../components/OfflineBanner', () => () => null);
jest.mock('../components/PackageSelectionSheet', () => () => null);
jest.mock('../screens/client/Day1WinScreen', () => () => null);
jest.mock('../services/support/crisp.service', () => ({ initCrisp: jest.fn(), syncCrispIdentity: jest.fn() }));
jest.mock('../hooks/useLeanOnboardingReconcile', () => ({ useLeanOnboardingReconcile: jest.fn() }));
jest.mock('../services/firstWinApi', () => ({
  firstWinApi: { getStatus: jest.fn().mockResolvedValue({ data: { completed: true } }) },
  WinType: {},
}));
jest.mock('../services/foodLogQueue', () => ({ flush: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => ({ isOnline: true, isInternetReachable: true }),
  isEffectivelyOnline: () => true,
}));
jest.mock('../utils/authEvents', () => ({
  authEvents: { onAuthChange: jest.fn(() => () => {}), on: jest.fn(() => () => {}), emit: jest.fn() },
}));
jest.mock('../screenshots', () => ({ isScreenshotMode: () => false }));
jest.mock('../offline', () => ({ triggerSync: jest.fn(async () => undefined) }));
jest.mock('../entitlements/EntitlementProvider', () => ({
  EntitlementProvider: ({ children }: { children: unknown }) => children,
}));

import React from 'react';
import { render, act, waitFor, cleanup } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider, dehydrate } from '@tanstack/react-query';
import RootNavigator from '../navigation/RootNavigator';
import { queryClient, persisterKeyForUser, QUERY_CACHE_BUSTER, QUERY_CACHE_KEY_PREFIX } from '../services/queryClient';
import { PERSISTED_CACHE_RESTORE_TIMEOUT_MS } from '../services/PersistedQueryCacheGate';

const COACH_B = { id: 'user-B', email: 'b@example.com', role: 'coach', name: 'Bea' };
const KEY_B = persisterKeyForUser('user-B');

function blob(data: unknown): string {
  const tmp = new QueryClient();
  tmp.setQueryData(['me'], data);
  const clientState = dehydrate(tmp);
  tmp.clear(); // drop the throwaway client's gc timer (test-owned real handle that kept Jest alive)
  return JSON.stringify({ buster: QUERY_CACHE_BUSTER, timestamp: Date.now(), clientState });
}

beforeEach(async () => {
  await AsyncStorage.clear();
  queryClient.clear();
  for (const k of Object.keys(mockSecure)) delete mockSecure[k];
  jest.restoreAllMocks();
});
afterEach(async () => {
  await cleanup();
});

const mount = () =>
  render(
    <QueryClientProvider client={queryClient}>
      <RootNavigator />
    </QueryClientProvider>,
  );

describe('RootNavigator × persisted cache identity', () => {
  it('cached user B with a MISSING token: auth stack renders, B\'s persisted cache is never read, memory stays empty', async () => {
    await AsyncStorage.setItem('prefs:auth.user_data', JSON.stringify(COACH_B));
    await AsyncStorage.setItem(KEY_B, blob({ ...COACH_B, secret: 'B-private' }));
    const getItem = jest.spyOn(AsyncStorage, 'getItem');
    const { findByTestId } = await mount();
    await findByTestId('nav-auth');
    expect(getItem.mock.calls.filter((c) => String(c[0]).startsWith(QUERY_CACHE_KEY_PREFIX))).toEqual([]);
    expect(queryClient.getQueryData(['me'])).toBeUndefined();
  });

  it('cached user B WITH a token: the coach surface mounts only after B\'s own cache is restored and sees it', async () => {
    mockSecure['supabase_token'] = 'jwt-B';
    await AsyncStorage.setItem('prefs:auth.user_data', JSON.stringify(COACH_B));
    await AsyncStorage.setItem(KEY_B, blob({ ...COACH_B, secret: 'B-private' }));
    const getItem = jest.spyOn(AsyncStorage, 'getItem');
    const { findByTestId } = await mount();
    const coach = await findByTestId('nav-coach');
    expect(coach.props.children).toContain('B-private'); // visible at first private mount, not after
    expect(getItem.mock.calls.some((c) => c[0] === KEY_B)).toBe(true);
    expect(getItem.mock.calls.filter((c) => String(c[0]).includes(':anonymous'))).toEqual([]);
  });

  it('a hung persisted-cache read does not deadlock bootstrap: coach surface renders within the bounded window', async () => {
    jest.useFakeTimers();
    try {
      mockSecure['supabase_token'] = 'jwt-B';
      await AsyncStorage.setItem('prefs:auth.user_data', JSON.stringify(COACH_B));
      const realGet = AsyncStorage.getItem.bind(AsyncStorage);
      jest.spyOn(AsyncStorage, 'getItem').mockImplementation((k: string) =>
        k === KEY_B ? new Promise<never>(() => {}) : realGet(k),
      );
      const r = await mount();
      await act(async () => {
        await jest.advanceTimersByTimeAsync(50);
      });
      expect(r.queryByTestId('nav-coach')).toBeNull(); // restoring, bounded
      await act(async () => {
        await jest.advanceTimersByTimeAsync(PERSISTED_CACHE_RESTORE_TIMEOUT_MS + 50);
      });
      expect(r.getByTestId('nav-coach').props.children).toBe('none');
    } finally {
      jest.useRealTimers();
    }
  });

  it('cached user B whose bootstrap fails validation (needs_role_selection) is treated as unauthenticated: no cache read', async () => {
    mockSecure['supabase_token'] = 'jwt-B';
    await AsyncStorage.setItem('prefs:auth.user_data', JSON.stringify(COACH_B));
    await AsyncStorage.setItem('needs_role_selection', 'true');
    await AsyncStorage.setItem(KEY_B, blob({ secret: 'B-private' }));
    const getItem = jest.spyOn(AsyncStorage, 'getItem');
    const { findByTestId } = await mount();
    await findByTestId('nav-auth');
    await waitFor(() => expect(queryClient.getQueryData(['me'])).toBeUndefined());
    expect(getItem.mock.calls.filter((c) => c[0] === KEY_B)).toEqual([]);
  });
});
