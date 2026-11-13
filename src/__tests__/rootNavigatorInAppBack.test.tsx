/**
 * INAPP-BACK-M (LO-971R1 C5 and C6), the pin half of RootNavigator's pair: the lockout's Data export, Delete account
 * and Update card (RootNavigator.tsx openDataExport, openDeleteAccount, openUpdateCard) and the plans prompt's
 * onOpenPlans (the package_prompt and student branches) send `initial: false`, so the You home sits under the screen
 * (inAppTapStack.test.tsx case c sends each exact argument through the real client navigator). The Day 1 hand-off's
 * argument stays pinned by rootNavigatorPackagePromptGate.test.tsx. Harness copied from that file (real RootNavigator,
 * mocked native and network edges), with the two providers mocked to capture the handlers RootNavigator hands them.
 */
const mockSecure: Record<string, string | null> = {};
const mockNavigate = jest.fn();
type Handlers = {
  onOpenDataExport: () => void;
  onOpenDeleteAccount: () => void;
  onOpenUpdateCard: (p: { autostart: boolean; surface: string }) => void;
};
let mockDunningProps: Handlers | null = null;
let mockEntitlementProps: { onOpenPlans: () => void } | null = null;
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
  authApi: { me: async () => ({ data: { profile: { date_of_birth: '1990-01-01' } } }) },
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
    NavigationContainer: ({ children, onReady }: { children: React.ReactNode; onReady: () => void }) => {
      React.useEffect(() => { onReady(); }, [onReady]);
      return React.createElement(React.Fragment, null, children);
    },
    createNavigationContainerRef: () => ({
      isReady: () => true,
      navigate: (...args: unknown[]) => mockNavigate(...args),
      resetRoot: jest.fn(),
      getCurrentRoute: () => undefined,
      addListener: () => () => undefined,
      current: null,
    }),
  };
});
jest.mock('../entitlements/dunning/dunningApi', () => ({
  ...jest.requireActual('../entitlements/dunning/dunningApi'),
  dunningApi: {
    getStatus: jest.fn(async () => ({ enabled: false, state: 'none' })),
    createCardSetup: jest.fn(),
    confirmCardUpdate: jest.fn(),
    cancelPlan: jest.fn(),
  },
}));
jest.mock('../navigation/AuthNavigator', () => {
  const React = jest.requireActual('react');
  const { Text } = jest.requireActual('react-native');
  return () => React.createElement(Text, { testID: 'nav-auth' }, 'auth');
});
jest.mock('../navigation/CoachNavigator', () => () => null);
jest.mock('../navigation/ClientNavigator', () => {
  const React = jest.requireActual('react');
  const { Text } = jest.requireActual('react-native');
  return () => React.createElement(Text, { testID: 'nav-client' }, 'client');
});
jest.mock('../navigation/OnboardingNavigator', () => () => null);
jest.mock('../navigation/CoachWizardNavigator', () => () => null);
jest.mock('../navigation/Day1OnboardingNavigator', () => () => null);
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
// The two providers capture what RootNavigator hands them.
jest.mock('../entitlements/EntitlementProvider', () => ({
  EntitlementProvider: (props: { children: unknown; onOpenPlans: () => void }) => {
    mockEntitlementProps = props;
    return props.children;
  },
}));
jest.mock('../entitlements/dunning/DunningLockoutProvider', () => ({
  DunningLockoutProvider: (props: Handlers & { children: unknown }) => {
    mockDunningProps = props;
    return props.children;
  },
}));
jest.mock('../config/featureFlags', () => {
  const actual = jest.requireActual('../config/featureFlags');
  return {
    ...actual,
    featureFlags: new Proxy(actual.featureFlags, {
      get: (t, k) => (k === 'clientTutorial' || k === 'consultationOnboarding' ? false : Reflect.get(t, k)),
    }),
  };
});
import React from 'react';
import { render, cleanup, act } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import RootNavigator from '../navigation/RootNavigator';
import { queryClient } from '../services/queryClient';

const STUDENT = {
  id: 'client-S',
  email: 's@example.com',
  role: 'student',
  name: 'Sam',
  coach_id: 'coach-1',
  profile: { onboarding_completed: true, day_one_completed: true },
};
const PROMPT_KEY = 'prefs:onboarding.package_prompt_dismissed_at:client-S';
const realOS = Platform.OS;

beforeEach(async () => {
  jest.clearAllMocks();
  mockDunningProps = null;
  mockEntitlementProps = null;
  await AsyncStorage.clear();
  queryClient.clear();
  for (const k of Object.keys(mockSecure)) delete mockSecure[k];
  mockGetEntitlement.mockReset();
  mockSecure['supabase_token'] = 'jwt-S';
  await AsyncStorage.setItem('prefs:auth.user_data', JSON.stringify(STUDENT));
  await AsyncStorage.setItem('onboarding_complete', 'true');
  await AsyncStorage.setItem('day_one_completed', 'true');
  // Dismissed more than 24h ago, so only the entitlement decides.
  await AsyncStorage.setItem(PROMPT_KEY, new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString());
});
afterEach(async () => {
  await cleanup();
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => realOS });
});

const ACTIVE = { ok: true, data: { active: true, entitlement_active: true } };
const NO_PLAN = { ok: true, data: { active: false, entitlement_active: false } };

describe.each([
  ['student (RootNavigator.tsx:1113 branch)', ACTIVE, 'nav-client'],
  ['package_prompt (RootNavigator.tsx:1082 branch)', NO_PLAN, 'package-prompt'],
] as const)('%s: each in-app tap into the You tab keeps the You home under its screen', (_state, entitlement, shown) => {
  const mount = async () => {
    mockGetEntitlement.mockResolvedValue(entitlement);
    const r = await render(<QueryClientProvider client={queryClient}><RootNavigator /></QueryClientProvider>);
    await r.findByTestId(shown);
    await r.findByTestId('nav-client');
    expect(mockDunningProps).not.toBeNull();
    expect(mockEntitlementProps).not.toBeNull();
    mockNavigate.mockClear();
  };

  it.each([
    ['the lockout\'s Data export (:337)', () => mockDunningProps!.onOpenDataExport(), { screen: 'DataExport', initial: false }],
    ['the lockout\'s Delete account (:341)', () => mockDunningProps!.onOpenDeleteAccount(), { screen: 'DeleteAccount', initial: false }],
    ['Update card (:346)', () => mockDunningProps!.onOpenUpdateCard({ autostart: true, surface: 'test' }),
      { screen: 'UpdateCard', params: { autostart: true }, initial: false }],
    ['the plans prompt\'s onOpenPlans', () => mockEntitlementProps!.onOpenPlans(), { screen: 'ClientPackages', initial: false }],
  ] as const)('%s', async (_name, tap, expected) => {
    await mount();
    await act(async () => tap());
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('MoreTab', expected);
  });
});
