/**
 * ONB-SWEEP-SOL-135 B2 (B-SMALLFIX-135): a coach who left setup partway and
 * opens the app with no or stalled reception resumes the saved consultation
 * (coach_consult_v1:<id>) instead of landing on the dashboard. With no saved
 * draft the start still fails open to the dashboard, and the normal path
 * (the server answers) is unchanged. Real RootNavigator and the real 8 s
 * startup limit on fake timers; native and network edges mocked as in
 * rootNavigatorStartupHang.test.tsx.
 */
const mockSecure: Record<string, string | null> = {};
jest.mock('../services/secureStorage', () => ({
  secureStorage: {
    getItem: jest.fn((k: string) => Promise.resolve(mockSecure[k] ?? null)),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));
const mockApiGet = jest.fn();
const mockApiPost = jest.fn();
jest.mock('../services/authActions', () => ({ signOut: jest.fn(async () => {}) }));
jest.mock('../services/api', () => ({
  __esModule: true,
  default: {
    get: (...args: unknown[]) => mockApiGet(...args),
    post: (...args: unknown[]) => mockApiPost(...args),
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
jest.mock('../services/firstWinApi', () => ({
  firstWinApi: { getStatus: jest.fn(async () => ({ data: { completed: true } })) },
  WinType: {},
}));
jest.mock('../services/foodLogQueue', () => ({ flush: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => ({ isOnline: true, isInternetReachable: true }),
  isEffectivelyOnline: () => true,
}));
jest.mock('../utils/authEvents', () => ({
  authEvents: { onAuthChange: () => () => undefined, on: jest.fn(() => () => {}), emit: jest.fn() },
}));
jest.mock('../screenshots', () => ({ isScreenshotMode: () => false }));
jest.mock('../offline', () => ({ triggerSync: jest.fn(async () => undefined) }));
jest.mock('../entitlements/EntitlementProvider', () => ({
  EntitlementProvider: ({ children }: { children: unknown }) => children,
}));

import React from 'react';
import { act, cleanup, render } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClientProvider } from '@tanstack/react-query';
import RootNavigator, { COACH_DRAFT_READ_MS } from '../navigation/RootNavigator';
import { queryClient } from '../services/queryClient';
import { STARTUP_CEILING_MS, STARTUP_STEP_TIMEOUT_MS } from '../lib/startupTimebox';

const NEVER = () => new Promise<never>(() => undefined);
const COACH = { id: 'coach-C', email: 'c@example.com', role: 'coach', name: 'Cass' };
const DRAFT_KEY = 'coach_consult_v1:coach-C';
const DRAFT = {
  v: 1,
  step: 'K4',
  answers: { display_name: 'Cass', clients_today: '1_10' },
  synced: false,
  updatedAt: '2026-10-08T19:00:00.000Z',
};

async function signInCoach(draft: object | null = DRAFT, key = DRAFT_KEY) {
  mockSecure['supabase_token'] = 'jwt-C';
  await AsyncStorage.setItem('prefs:auth.user_data', JSON.stringify(COACH));
  if (draft) await AsyncStorage.setItem(key, JSON.stringify(draft));
}

const mount = () =>
  render(
    <QueryClientProvider client={queryClient}>
      <RootNavigator />
    </QueryClientProvider>,
  );

async function advance(ms: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

const routed = (r: Awaited<ReturnType<typeof mount>>) => ({
  coach: r.queryByTestId('nav-coach') !== null,
  wizard: r.queryByTestId('nav-wizard') !== null,
});

beforeEach(async () => {
  jest.useFakeTimers();
  await AsyncStorage.clear();
  queryClient.clear();
  for (const k of Object.keys(mockSecure)) delete mockSecure[k];
  mockApiGet.mockReset().mockResolvedValue({ data: { is_complete: true } });
  mockApiPost.mockReset().mockResolvedValue({ data: {} });
});
afterEach(async () => {
  await cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('stalled setup read (no answer within the startup limit)', () => {
  it('an unfinished saved consultation resumes, after the limit and not before', async () => {
    await signInCoach();
    mockApiGet.mockImplementation(NEVER);
    const r = await mount();
    await advance(STARTUP_STEP_TIMEOUT_MS - 500);
    expect(routed(r)).toEqual({ coach: false, wizard: false });
    await advance(1000);
    expect(routed(r)).toEqual({ coach: false, wizard: true });
    expect(mockApiGet).toHaveBeenCalledWith('/coach/onboarding');
  });

  it('no saved draft: the coach dashboard, as before', async () => {
    await signInCoach(null);
    mockApiGet.mockImplementation(NEVER);
    const r = await mount();
    await advance(STARTUP_STEP_TIMEOUT_MS + 500);
    expect(routed(r)).toEqual({ coach: true, wizard: false });
  });

  it("another account's draft on the same phone is not this coach's: the dashboard", async () => {
    await signInCoach(DRAFT, 'coach_consult_v1:someone-else');
    mockApiGet.mockImplementation(NEVER);
    const r = await mount();
    await advance(STARTUP_STEP_TIMEOUT_MS + 500);
    expect(routed(r)).toEqual({ coach: true, wizard: false });
  });

  it('an unreadable draft (wrong version, unknown step) is ignored: the dashboard', async () => {
    await signInCoach({ ...DRAFT, v: 2 });
    mockApiGet.mockImplementation(NEVER);
    const r = await mount();
    await advance(STARTUP_STEP_TIMEOUT_MS + 500);
    expect(routed(r)).toEqual({ coach: true, wizard: false });
    await cleanup();
    await AsyncStorage.setItem(DRAFT_KEY, JSON.stringify({ ...DRAFT, step: 'K99' }));
    const again = await mount();
    await advance(STARTUP_STEP_TIMEOUT_MS + 500);
    expect(routed(again)).toEqual({ coach: true, wizard: false });
  });

  it('the draft read itself is bounded: no answer within its limit opens the dashboard before the loading ceiling', async () => {
    await signInCoach();
    mockApiGet.mockImplementation(NEVER);
    const realGet = AsyncStorage.getItem.bind(AsyncStorage);
    jest.spyOn(AsyncStorage, 'getItem').mockImplementation((k: string) =>
      k === DRAFT_KEY ? NEVER() : realGet(k),
    );
    const r = await mount();
    await advance(STARTUP_STEP_TIMEOUT_MS + 100);
    expect(routed(r)).toEqual({ coach: false, wizard: false });
    await advance(COACH_DRAFT_READ_MS);
    expect(routed(r)).toEqual({ coach: true, wizard: false });
    expect(STARTUP_STEP_TIMEOUT_MS + COACH_DRAFT_READ_MS).toBeLessThan(STARTUP_CEILING_MS);
    expect(r.queryByTestId('startup-error')).toBeNull();
  });
});

describe('setup read fails at once', () => {
  it('Network Error with a saved draft resumes the consultation (the ONB-SWEEP probe)', async () => {
    await signInCoach();
    mockApiGet.mockRejectedValue(new Error('Network Error'));
    const r = await mount();
    await advance(500);
    expect(routed(r)).toEqual({ coach: false, wizard: true });
  });

  it('Network Error with no draft: the dashboard', async () => {
    await signInCoach(null);
    mockApiGet.mockRejectedValue(new Error('Network Error'));
    const r = await mount();
    await advance(500);
    expect(routed(r)).toEqual({ coach: true, wizard: false });
  });

  it('404 then a failed start, with a saved draft: the consultation; with none: the dashboard', async () => {
    await signInCoach();
    mockApiGet.mockRejectedValue(Object.assign(new Error('Not Found'), { response: { status: 404 } }));
    mockApiPost.mockRejectedValue(new Error('Network Error'));
    const r = await mount();
    await advance(500);
    expect(routed(r)).toEqual({ coach: false, wizard: true });
    await cleanup();
    await AsyncStorage.removeItem(DRAFT_KEY);
    const again = await mount();
    await advance(500);
    expect(routed(again)).toEqual({ coach: true, wizard: false });
  });
});

describe('normal path unchanged (the server answers)', () => {
  it('setup complete: the dashboard even with a draft left on the phone, and the draft is not read', async () => {
    await signInCoach();
    const getItem = jest.spyOn(AsyncStorage, 'getItem');
    const r = await mount();
    await advance(500);
    expect(routed(r)).toEqual({ coach: true, wizard: false });
    expect(getItem.mock.calls.some((c) => c[0] === DRAFT_KEY)).toBe(false);
  });

  it('setup not complete: the consultation, with or without a draft', async () => {
    mockApiGet.mockResolvedValue({ data: { is_complete: false } });
    await signInCoach(null);
    const r = await mount();
    await advance(500);
    expect(routed(r)).toEqual({ coach: false, wizard: true });
  });

  it('404 then a started wizard row: the consultation, as before', async () => {
    await signInCoach(null);
    mockApiGet.mockRejectedValue(Object.assign(new Error('Not Found'), { response: { status: 404 } }));
    const r = await mount();
    await advance(500);
    expect(routed(r)).toEqual({ coach: false, wizard: true });
    expect(mockApiPost).toHaveBeenCalledWith('/coach/onboarding/start', {});
  });
});
