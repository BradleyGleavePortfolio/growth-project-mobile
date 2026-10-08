/**
 * Opus B-05 on #310, caller level: with the consultation flag on, a client
 * who finished the consultation (plan reveal and Roman's tutorial) goes
 * straight to the app on the next boot. The old Day-1 flow and the Day-1 win
 * are never mounted, even though the server does not set
 * profile.day_one_completed for the consultation. Flag off: completed
 * onboarding can still offer the first win, but never starts a second setup.
 * Harness mirrors rootNavigatorPackagePromptGate.test.tsx (real
 * RootNavigator, mocked native/network edges).
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
jest.mock('../navigation/LeanOnboardingNavigator', () => () => null);
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

/** What the consultation leaves behind: onboarding done, Day-1 never run. */
const CONSULTED = {
  id: 'client-C',
  email: 'c@example.com',
  role: 'student',
  name: 'Cam',
  profile: { onboardingCompleted: true, day_one_completed: false },
};

async function seed(user: object, localOnboardingDone: boolean) {
  await AsyncStorage.setItem('prefs:auth.user_data', JSON.stringify(user));
  if (localOnboardingDone) await AsyncStorage.setItem('onboarding_complete', 'true');
}

beforeEach(async () => {
  await AsyncStorage.clear();
  queryClient.clear();
  for (const k of Object.keys(mockSecure)) delete mockSecure[k];
  mockSecure['supabase_token'] = 'jwt-C';
  mockConsultFlag = true;
  mockFirstWin.mockReset();
  mockFirstWin.mockResolvedValue({ data: { completed: false } });
  mockGetEntitlement.mockReset();
  mockGetEntitlement.mockResolvedValue({ ok: true, data: { active: true, entitlement_active: true } });
  mockHidden = false;
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

describe('RootNavigator after the consultation (flag on)', () => {
  it('finished consultation: straight to the app, no Day-1 flow, no Day-1 win', async () => {
    await seed(CONSULTED, true);
    const r = await mount();
    await r.findByTestId('nav-client');
    expect(r.queryByTestId('nav-day1')).toBeNull();
    expect(r.queryByTestId('day1-win')).toBeNull();
    expect(mockFirstWin).not.toHaveBeenCalled();
  });

  it('local flag only (server profile not caught up): still the app', async () => {
    await seed({ ...CONSULTED, profile: { onboarding_completed: false, day_one_completed: false } }, true);
    const r = await mount();
    await r.findByTestId('nav-client');
    expect(r.queryByTestId('nav-day1')).toBeNull();
  });

  it('not finished: the consultation, not the lean flow', async () => {
    await seed({ ...CONSULTED, profile: { onboarding_completed: false, day_one_completed: false } }, false);
    const r = await mount();
    await r.findByTestId('nav-consultation');
  });
});

describe('RootNavigator with the consultation flag off', () => {
  it('onboarding complete locally, profile pending: first win, never another setup', async () => {
    mockConsultFlag = false;
    await seed({ ...CONSULTED, profile: { onboarding_completed: false, day_one_completed: false } }, true);
    const r = await mount();
    await r.findByTestId('day1-win');
    expect(r.queryByTestId('nav-day1')).toBeNull();
    expect(mockFirstWin).toHaveBeenCalledTimes(1);
  });

  it('Day-1 done but the win not: the Day-1 win', async () => {
    mockConsultFlag = false;
    await seed({ ...CONSULTED, profile: { onboardingCompleted: true, day_one_completed: true } }, true);
    const r = await mount();
    await r.findByTestId('day1-win');
  });
});
