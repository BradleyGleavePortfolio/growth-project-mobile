/**
 * B14 (CONSULT-ALL-M-133, owner decisions 27-28), caller level: every new
 * client gets the consultation, coached or coachless, whatever GET
 * /me/onboarding says about `consultation_available` (an older server says
 * false when it cannot finish it; the consultation then shows its calm server
 * state at POST /complete, see ConsultationFlow.test.tsx). The lean flow is
 * never mounted, in any build. A lean marker left by an earlier build is
 * cleared for a client who never finished it; a client who did finish keeps
 * the first-win step and never sees a second onboarding. History: S-REVENUE-124
 * (B-REV-1) sent these clients to the lean flow. Harness copied from
 * rootNavigatorConsultationComplete.test.tsx (real RootNavigator).
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
const mockOnboarding: { body: unknown; fail: boolean } = { body: null, fail: false };
const mockGet = jest.fn(async (url: string) => {
  if (url === '/me/onboarding') {
    if (mockOnboarding.fail) throw Object.assign(new Error('Network Error'), {});
    return { data: mockOnboarding.body };
  }
  return { data: { is_complete: true } };
});
jest.mock('../services/api', () => ({
  __esModule: true,
  default: {
    get: (url: string) => mockGet(url),
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
      // S-DUNNING: the payment-lockout provider reads the focused route.
      getCurrentRoute: () => undefined,
      addListener: () => () => undefined,
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
jest.mock('../navigation/ClientNavigator', () => {
  const React = jest.requireActual('react');
  const { Text } = jest.requireActual('react-native');
  return () => React.createElement(Text, { testID: 'nav-client' }, 'client');
});
jest.mock('../navigation/OnboardingNavigator', () => () => null);
jest.mock('../navigation/LeanOnboardingNavigator', () => {
  const React = jest.requireActual('react');
  const { Text } = jest.requireActual('react-native');
  return () => React.createElement(Text, { testID: 'nav-lean' }, 'lean');
});
jest.mock('../navigation/CoachWizardNavigator', () => () => null);
jest.mock('../navigation/Day1OnboardingNavigator', () => {
  const React = jest.requireActual('react');
  const { Text } = jest.requireActual('react-native');
  return () => React.createElement(Text, { testID: 'nav-day1' }, 'day1');
});
jest.mock('../navigation/ConsultationOnboardingNavigator', () => {
  const React = jest.requireActual('react');
  const { Text } = jest.requireActual('react-native');
  return () => React.createElement(Text, { testID: 'nav-consultation' }, 'consultation');
});
jest.mock('../components/OfflineBanner', () => () => null);
jest.mock('../components/PackageSelectionSheet', () => {
  const React = jest.requireActual('react');
  const { Text } = jest.requireActual('react-native');
  return () => React.createElement(Text, { testID: 'package-prompt' }, 'prompt');
});
const mockGetEntitlement = jest.fn();
jest.mock('../api/clientPaymentsApi', () => ({
  clientPaymentsApi: { getEntitlement: () => mockGetEntitlement() },
}));
jest.mock('../screens/client/Day1WinScreen', () => {
  const React = jest.requireActual('react');
  const { Text } = jest.requireActual('react-native');
  return () => React.createElement(Text, { testID: 'day1-win' }, 'win');
});
jest.mock('../services/support/crisp.service', () => ({ initCrisp: jest.fn(), syncCrispIdentity: jest.fn() }));
jest.mock('../hooks/useLeanOnboardingReconcile', () => ({ useLeanOnboardingReconcile: jest.fn() }));
const mockFirstWin = jest.fn();
jest.mock('../services/firstWinApi', () => ({
  firstWinApi: { getStatus: () => mockFirstWin() },
  WinType: {},
}));
let mockConsultFlag = true;
jest.mock('../config/featureFlags', () => {
  const actual = jest.requireActual('../config/featureFlags');
  return {
    ...actual,
    featureFlags: new Proxy(actual.featureFlags, {
      get: (t, k) => (k === 'consultationOnboarding' ? mockConsultFlag : Reflect.get(t, k)),
    }),
  };
});
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

let mockHidden = false;
jest.mock('../config/purchaseSurfaces', () => ({
  ...jest.requireActual('../config/purchaseSurfaces'),
  nonP2PPurchasesHidden: () => mockHidden,
}));
import React from 'react';
import { render, cleanup } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClientProvider } from '@tanstack/react-query';
import RootNavigator from '../navigation/RootNavigator';
import { queryClient } from '../services/queryClient';

const NEW_CLIENT = {
  id: 'client-N',
  email: 'n@example.com',
  role: 'student',
  name: 'Nia',
  profile: { onboarding_completed: false, day_one_completed: false },
};
const MARKER = 'onboarding_standard_path:client-N';
const onboardingReads = () => mockGet.mock.calls.filter(([u]) => u === '/me/onboarding').length;

beforeEach(async () => {
  await AsyncStorage.clear();
  queryClient.clear();
  for (const k of Object.keys(mockSecure)) delete mockSecure[k];
  mockSecure['supabase_token'] = 'jwt-N';
  mockConsultFlag = true;
  mockOnboarding.body = null;
  mockOnboarding.fail = false;
  mockGet.mockClear();
  mockFirstWin.mockReset();
  mockFirstWin.mockResolvedValue({ data: { completed: false } });
  mockGetEntitlement.mockReset();
  mockGetEntitlement.mockResolvedValue({ ok: true, data: { active: true, entitlement_active: true } });
  mockHidden = false;
  await AsyncStorage.setItem('prefs:auth.user_data', JSON.stringify(NEW_CLIENT));
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

describe('B14: every new client gets the consultation, never the lean flow', () => {
  it('a coachless client on an older server (consultation_available: false): the consultation, not the lean flow', async () => {
    mockOnboarding.body = { completed: false, answers: null, consultation_available: false };
    const r = await mount();
    await r.findByTestId('nav-consultation');
    expect(r.queryByTestId('nav-lean')).toBeNull();
    // Routing no longer asks the server; no lean marker is written.
    expect(onboardingReads()).toBe(0);
    expect(await AsyncStorage.getItem(MARKER)).toBeNull();
  });

  it('a coached client (server: available): the consultation', async () => {
    mockOnboarding.body = { completed: false, answers: null, consultation_available: true };
    const r = await mount();
    await r.findByTestId('nav-consultation');
    expect(r.queryByTestId('nav-lean')).toBeNull();
  });

  it.each([
    ['an older server without the field', () => { mockOnboarding.body = { completed: false, answers: null }; }],
    ['a failed read', () => { mockOnboarding.fail = true; }],
    ['the consultation flag off (a development build)', () => { mockConsultFlag = false; }],
  ])('%s: the consultation', async (_label, arrange) => {
    arrange();
    const r = await mount();
    await r.findByTestId('nav-consultation');
    expect(r.queryByTestId('nav-lean')).toBeNull();
  });

  it('a lean marker from an earlier build, onboarding never finished: the consultation, and the marker is cleared', async () => {
    await AsyncStorage.setItem(MARKER, 'true');
    const r = await mount();
    await r.findByTestId('nav-consultation');
    expect(r.queryByTestId('nav-lean')).toBeNull();
    expect(await AsyncStorage.getItem(MARKER)).toBeNull();
  });

  it.each([true, false])('a returning client who finished the consultation goes straight to the app (profile synced: %s)', async (synced) => {
    await AsyncStorage.setItem('onboarding_complete', 'true');
    await AsyncStorage.setItem('prefs:auth.user_data', JSON.stringify({
      ...NEW_CLIENT, profile: { ...NEW_CLIENT.profile, onboardingCompleted: synced },
    }));
    const r = await mount();
    await r.findByTestId('nav-client');
    expect(r.queryByTestId('nav-consultation')).toBeNull();
    expect(r.queryByTestId('day1-win')).toBeNull();
    expect(r.queryByTestId('nav-day1')).toBeNull();
    expect(onboardingReads()).toBe(0);
  });

  it('a returning client who finished on the server only (fresh install): the app, and the local flag is repaired', async () => {
    await AsyncStorage.setItem('prefs:auth.user_data', JSON.stringify({
      ...NEW_CLIENT, profile: { ...NEW_CLIENT.profile, onboarding_completed: true },
    }));
    const r = await mount();
    await r.findByTestId('nav-client');
    expect(r.queryByTestId('nav-consultation')).toBeNull();
    expect(await AsyncStorage.getItem('onboarding_complete')).toBe('true');
  });

  it.each([true, false])('after lean completion in an earlier build, never starts another onboarding (profile synced: %s)', async (synced) => {
    await AsyncStorage.setItem(MARKER, 'true');
    await AsyncStorage.setItem('onboarding_complete', 'true');
    await AsyncStorage.setItem('prefs:auth.user_data', JSON.stringify({
      ...NEW_CLIENT, profile: { ...NEW_CLIENT.profile, onboardingCompleted: synced },
    }));
    const r = await mount();
    await r.findByTestId('day1-win');
    expect(r.queryByTestId('nav-day1')).toBeNull();
    expect(r.queryByTestId('nav-consultation')).toBeNull();
    expect(onboardingReads()).toBe(0);
  });

  it('ignores an old Day-1 checkpoint after onboarding, with the consultation flag off', async () => {
    mockConsultFlag = false;
    await AsyncStorage.setItem('onboarding_complete', 'true');
    await AsyncStorage.setItem('day_one_onboarding_state_v1', JSON.stringify({ step: 'Goals' }));
    const r = await mount();
    await r.findByTestId('day1-win');
    expect(r.queryByTestId('nav-day1')).toBeNull();
  });
});
