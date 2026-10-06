/**
 * Fix round #304 (Sol B1), caller level: RootNavigator's 24h package-prompt
 * re-surface uses the real packagePromptGate and is offered only after an
 * explicit inactive entitlement. Comp (active) and every unknown/error
 * lookup must land the client in the app with no prompt. Harness mirrors
 * rootNavigatorPersistedCacheGate.test.tsx (real RootNavigator, mocked
 * native/network edges).
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
// S-DUNNING: the lockout provider's status read is not under test here.
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

const STUDENT = {
  id: 'client-S',
  email: 's@example.com',
  role: 'student',
  name: 'Sam',
  profile: { onboarding_completed: true, day_one_completed: true },
};

beforeEach(async () => {
  await AsyncStorage.clear();
  queryClient.clear();
  for (const k of Object.keys(mockSecure)) delete mockSecure[k];
  mockGetEntitlement.mockReset();
  mockHidden = false;
  mockSecure['supabase_token'] = 'jwt-S';
  await AsyncStorage.setItem('prefs:auth.user_data', JSON.stringify(STUDENT));
  await AsyncStorage.setItem('onboarding_complete', 'true');
  await AsyncStorage.setItem('day_one_completed', 'true');
  // Dismissed more than 24h ago, so only the entitlement decides.
  await AsyncStorage.setItem(
    'prefs:onboarding.package_prompt_dismissed_at:client-S',
    new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
  );
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

describe('RootNavigator 24h package prompt is fail closed', () => {
  it('comp (active) client: app, no prompt', async () => {
    mockGetEntitlement.mockResolvedValue({ ok: true, data: { active: true, entitlement_active: true } });
    const r = await mount();
    await r.findByTestId('nav-client');
    expect(r.queryByTestId('package-prompt')).toBeNull();
    expect(mockGetEntitlement).toHaveBeenCalled();
  });

  it.each([
    ['ok:false', () => Promise.resolve({ ok: false, reason: 'error', message: 'timeout' })],
    ['empty data', () => Promise.resolve({ ok: true, data: {} })],
    ['rejected', () => Promise.reject(new Error('network'))],
  ])('failed entitlement lookup (%s): app, no prompt', async (_l, impl) => {
    mockGetEntitlement.mockImplementation(impl);
    const r = await mount();
    await r.findByTestId('nav-client');
    expect(r.queryByTestId('package-prompt')).toBeNull();
    expect(mockGetEntitlement).toHaveBeenCalled();
  });

  it('explicitly inactive client: the prompt re-surfaces', async () => {
    mockGetEntitlement.mockResolvedValue({ ok: true, data: { active: false, entitlement_active: false } });
    const r = await mount();
    await r.findByTestId('package-prompt');
  });

  it('hidden iOS build: no prompt even for an explicitly inactive client', async () => {
    mockHidden = true;
    mockGetEntitlement.mockResolvedValue({ ok: true, data: { active: false, entitlement_active: false } });
    const r = await mount();
    await r.findByTestId('nav-client');
    expect(r.queryByTestId('package-prompt')).toBeNull();
    expect(mockGetEntitlement).not.toHaveBeenCalled();
  });
});
