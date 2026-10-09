/**
 * START-HANG-134 (B35, B37): the app's start never waits forever. Every
 * startup check that does not answer falls back the way its path already
 * does on a failure; a read on this phone that does not answer shows the calm
 * startup error with Try again; an overtaken bootstrap commits nothing.
 * Harness mirrors rootNavigatorPackagePromptGate.test.tsx (real RootNavigator,
 * mocked native/network edges); the step limit is shortened to keep it fast.
 */
const mockSecure: Record<string, string | null> = {};
let mockHangToken = false;
jest.mock('../services/secureStorage', () => ({
  secureStorage: {
    getItem: jest.fn((k: string) =>
      mockHangToken && k === 'supabase_token' ? new Promise(() => undefined) : Promise.resolve(mockSecure[k] ?? null),
    ),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));
let mockStepMs = 40;
jest.mock('../lib/startupTimebox', () => {
  const actual = jest.requireActual('../lib/startupTimebox');
  return {
    ...actual,
    withStartupTimeout: (work: Promise<unknown>, step: string, ms?: number) =>
      actual.withStartupTimeout(work, step, ms ?? mockStepMs),
  };
});
const mockApiGet = jest.fn();
jest.mock('../services/authActions', () => ({ signOut: jest.fn(async () => {}) }));
jest.mock('../services/api', () => ({
  __esModule: true,
  default: {
    get: (...args: unknown[]) => mockApiGet(...args),
    post: jest.fn(async () => ({ data: {} })),
  },
}));
jest.mock('react-native/Libraries/Linking/Linking', () => ({
  __esModule: true,
  default: { getInitialURL: async () => null, addEventListener: () => ({ remove: jest.fn() }), openURL: jest.fn() },
}));
jest.mock('@react-navigation/native', () => {
  const React = jest.requireActual('react');
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    NavigationContainer: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    createNavigationContainerRef: () => ({
      isReady: () => true, navigate: jest.fn(), resetRoot: jest.fn(),
      getCurrentRoute: () => undefined, addListener: () => () => undefined, current: null,
    }),
  };
});
jest.mock('../entitlements/dunning/dunningApi', () => ({
  ...jest.requireActual('../entitlements/dunning/dunningApi'),
  dunningApi: {
    getStatus: jest.fn(async () => ({ enabled: false, state: 'none' })),
    createCardSetup: jest.fn(), confirmCardUpdate: jest.fn(), cancelPlan: jest.fn(),
  },
}));
function mockScreen(testID: string) {
  const React = jest.requireActual('react');
  const { Text } = jest.requireActual('react-native');
  return () => React.createElement(Text, { testID }, testID);
}
jest.mock('../navigation/AuthNavigator', () => mockScreen('nav-auth'));
jest.mock('../navigation/CoachNavigator', () => mockScreen('nav-coach'));
jest.mock('../navigation/ClientNavigator', () => mockScreen('nav-client'));
jest.mock('../navigation/OnboardingNavigator', () => () => null);
jest.mock('../navigation/LeanOnboardingNavigator', () => () => null);
jest.mock('../navigation/CoachWizardNavigator', () => mockScreen('nav-wizard'));
jest.mock('../navigation/Day1OnboardingNavigator', () => () => null);
jest.mock('../components/OfflineBanner', () => () => null);
jest.mock('../components/PackageSelectionSheet', () => mockScreen('package-prompt'));
jest.mock('../api/clientPaymentsApi', () => ({
  clientPaymentsApi: { getEntitlement: jest.fn(async () => ({ ok: true, data: { active: true } })) },
}));
jest.mock('../screens/client/Day1WinScreen', () => mockScreen('day1win'));
jest.mock('../services/support/crisp.service', () => ({ initCrisp: jest.fn(), syncCrispIdentity: jest.fn() }));
jest.mock('../hooks/useLeanOnboardingReconcile', () => ({ useLeanOnboardingReconcile: jest.fn() }));
const mockGetStatus = jest.fn();
jest.mock('../services/firstWinApi', () => ({
  firstWinApi: { getStatus: () => mockGetStatus() },
  WinType: {},
}));
jest.mock('../services/foodLogQueue', () => ({ flush: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => ({ isOnline: true, isInternetReachable: true }),
  isEffectivelyOnline: () => true,
}));
const mockAuthListeners: Array<() => void> = [];
jest.mock('../utils/authEvents', () => ({
  authEvents: {
    onAuthChange: (fn: () => void) => {
      mockAuthListeners.push(fn);
      return () => undefined;
    },
    on: jest.fn(() => () => {}),
    emit: jest.fn(),
  },
}));
jest.mock('../screenshots', () => ({ isScreenshotMode: () => false }));
jest.mock('../offline', () => ({ triggerSync: jest.fn(async () => undefined) }));
jest.mock('../entitlements/EntitlementProvider', () => ({
  EntitlementProvider: ({ children }: { children: unknown }) => children,
}));

import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClientProvider } from '@tanstack/react-query';
import RootNavigator from '../navigation/RootNavigator';
import { queryClient } from '../services/queryClient';
import { STARTUP_ERROR_COPY } from '../components/StartupErrorScreen';

const NEVER = () => new Promise(() => undefined);
// A coachless client on the standard path (marker left by an earlier build):
// the only network read on its start is GET /me/first-win/status.
const CLIENT = { id: 'client-S', email: 's@example.com', role: 'student', name: 'Sam', profile: { onboarding_completed: true } };

async function signIn(user: object) {
  mockSecure['supabase_token'] = 'jwt-S';
  await AsyncStorage.setItem('prefs:auth.user_data', JSON.stringify(user));
}

beforeEach(async () => {
  await AsyncStorage.clear();
  queryClient.clear();
  for (const k of Object.keys(mockSecure)) delete mockSecure[k];
  mockHangToken = false;
  mockStepMs = 40;
  mockAuthListeners.length = 0;
  mockApiGet.mockReset().mockResolvedValue({ data: { is_complete: true } });
  mockGetStatus.mockReset().mockResolvedValue({ data: { completed: true } });
  await AsyncStorage.setItem('onboarding_complete', 'true');
  await AsyncStorage.setItem('onboarding_standard_path:client-S', 'true');
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

describe('RootNavigator start never waits forever (B35, B37)', () => {
  it('first-win read that never settles: the client app opens, no endless spinner', async () => {
    await signIn(CLIENT);
    mockGetStatus.mockImplementation(NEVER);
    const r = await mount();
    await r.findByTestId('nav-client');
    expect(mockGetStatus).toHaveBeenCalled();
    expect(r.queryByTestId('day1win')).toBeNull();
    expect(r.queryByTestId('startup-error')).toBeNull();
  });

  it('coach setup read that never settles: the coach dashboard opens (fails open as on a network error)', async () => {
    await signIn({ ...CLIENT, id: 'coach-C', role: 'coach' });
    mockApiGet.mockImplementation(NEVER);
    const r = await mount();
    await r.findByTestId('nav-coach');
    expect(r.queryByTestId('nav-wizard')).toBeNull();
  });

  it('stored-session read that never settles: the calm startup error; Try again opens the app', async () => {
    await signIn(CLIENT);
    mockHangToken = true;
    const r = await mount();
    await r.findByTestId('startup-error');
    expect(r.getByTestId('startup-error-line').props.children).toBe(STARTUP_ERROR_COPY.device);
    expect(r.queryByTestId('nav-auth')).toBeNull();
    // The session was not touched (no sign-out on a slow read).
    expect(mockSecure['supabase_token']).toBe('jwt-S');
    mockHangToken = false;
    fireEvent.press(r.getByTestId('startup-error-retry'));
    await r.findByTestId('nav-client');
  });

  it('latest bootstrap wins: a slow earlier run cannot overwrite the newer outcome', async () => {
    await signIn(CLIENT);
    mockStepMs = 5000;
    let answerFirst: (v: { data: { completed: boolean } }) => void = () => undefined;
    mockGetStatus
      .mockImplementationOnce(() => new Promise((resolve) => { answerFirst = resolve; }))
      .mockResolvedValue({ data: { completed: true } });
    const r = await mount();
    await waitFor(() => expect(mockGetStatus).toHaveBeenCalledTimes(1));
    // An auth event while the first run waits: a second bootstrap starts.
    await act(async () => {
      mockAuthListeners.forEach((fn) => fn());
    });
    await r.findByTestId('nav-client');
    // The first run's late answer ("not completed") would show the Day 1 Win.
    await act(async () => {
      answerFirst({ data: { completed: false } });
    });
    expect(r.queryByTestId('day1win')).toBeNull();
    expect(r.getByTestId('nav-client')).toBeTruthy();
  });
});
