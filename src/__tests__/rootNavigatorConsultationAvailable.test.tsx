/**
 * S-REVENUE-124 (B-REV-1), caller level: with the consultation flag on (the
 * clinic build), a new client the server cannot finish the consultation for
 * (GET /me/onboarding consultation_available: false: no coach yet, or a coach
 * without a clinic program set) gets the standard onboarding, with no second
 * Day-1 setup flow after completion, instead of a consultation that
 * ends on "not_attached" / "clinic_not_configured" forever. A missing field,
 * a 404 or a failed read keeps the consultation. Harness copied from
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

describe('B-REV-1: the consultation only where the server can finish it (flag on)', () => {
  it('no coach or a coach without a program set: the standard onboarding, never the consultation', async () => {
    mockOnboarding.body = { completed: false, answers: null, consultation_available: false };
    const r = await mount();
    await r.findByTestId('nav-lean');
    expect(r.queryByTestId('nav-consultation')).toBeNull();
    expect(await AsyncStorage.getItem(MARKER)).toBe('true');
  });

  it.each([true, false])('after lean completion, never starts another Day-1 flow (profile synced: %s)', async (synced) => {
    await AsyncStorage.setItem(MARKER, 'true');
    await AsyncStorage.setItem('onboarding_complete', 'true');
    await AsyncStorage.setItem('prefs:auth.user_data', JSON.stringify({
      ...NEW_CLIENT, profile: { ...NEW_CLIENT.profile, onboardingCompleted: synced },
    }));
    const r = await mount();
    await r.findByTestId('day1-win');
    expect(r.queryByTestId('nav-day1')).toBeNull();
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

  it('a clinic client (server: available): the consultation, unchanged', async () => {
    mockOnboarding.body = { completed: false, answers: null, consultation_available: true };
    const r = await mount();
    await r.findByTestId('nav-consultation');
    expect(r.queryByTestId('nav-lean')).toBeNull();
    expect(await AsyncStorage.getItem(MARKER)).toBeNull();
  });

  it('an older server without the field: the consultation, as before', async () => {
    mockOnboarding.body = { completed: false, answers: null };
    const r = await mount();
    await r.findByTestId('nav-consultation');
  });

  it('a failed read: the consultation, as before', async () => {
    mockOnboarding.fail = true;
    const r = await mount();
    await r.findByTestId('nav-consultation');
  });

  it('flag off: no read, the standard onboarding (unchanged)', async () => {
    mockConsultFlag = false;
    const r = await mount();
    await r.findByTestId('nav-lean');
    expect(onboardingReads()).toBe(0);
  });
});
