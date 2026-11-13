/**
 * FOREGROUND-BANNER-M cases 1-3: where the in-app banner is drawn. The real RootNavigator (harness of
 * rootNavigatorPackagePromptGate.test.tsx and rootNavigatorStartupHang.test.tsx: mocked native and network edges,
 * stub navigators), the real PersistedQueryCacheGate, the real push listener and banner store.
 * - Case 1: the client app (student, package_prompt) and the coach app draw a notification received while open,
 *   with exactly its title and body.
 * - Case 2: no banner while signed out, in the consultation, the age check, the coach wizard, the Day-1 win, the
 *   startup pending and startup error views, while the persisted cache restores, or behind the biometric lock.
 *   What a device tap does meanwhile (pushTapRouter.ts:246-292): signed out drops it; onboarding, age check, coach
 *   wizard, Day-1 win and startup error hold it (onboarding); loading holds it (unknown); restoring and the lock keep
 *   the 'app' session with no ready navigator, so it is held until the navigator is ready.
 * - Case 3: sign-out (resetUserScopedStores, authActions.ts:660) takes a showing banner away at once and the next
 *   account never sees it.
 */
const mockSecure: Record<string, string | null> = {};
let mockHangToken = false;
jest.mock('../services/secureStorage', () => ({
  secureStorage: {
    getItem: jest.fn((k: string) =>
      mockHangToken && k === 'supabase_token' ? new Promise(() => undefined) : Promise.resolve(mockSecure[k] ?? null),
    ),
    setItem: jest.fn(async (k: string, v: string) => { mockSecure[k] = v; }),
    removeItem: jest.fn(async (k: string) => { delete mockSecure[k]; }),
  },
}));
let mockStepMs = 60000;
jest.mock('../lib/startupTimebox', () => {
  const actual = jest.requireActual('../lib/startupTimebox');
  return {
    ...actual,
    withStartupTimeout: (work: Promise<unknown>, step: string, ms?: number) =>
      actual.withStartupTimeout(work, step, ms ?? mockStepMs),
  };
});
jest.mock('../services/authActions', () => ({
  ...jest.requireActual('../services/authActions'),
  signOut: jest.fn(async () => {}),
}));
const mockApiGet = jest.fn();
const mockMe = jest.fn();
jest.mock('../services/api', () => ({
  authApi: { me: () => mockMe() },
  __esModule: true,
  default: { get: (...a: unknown[]) => mockApiGet(...a), post: jest.fn(async () => ({ data: {} })) },
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
      navigate: jest.fn(),
      resetRoot: jest.fn(),
      getCurrentRoute: () => undefined,
      getRootState: () => undefined,
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
function mockStub(testID: string) {
  const React = jest.requireActual('react');
  const { Text } = jest.requireActual('react-native');
  return () => React.createElement(Text, { testID }, testID);
}
jest.mock('../navigation/AuthNavigator', () => mockStub('nav-auth'));
jest.mock('../navigation/CoachNavigator', () => mockStub('nav-coach'));
jest.mock('../navigation/ClientNavigator', () => mockStub('nav-client'));
jest.mock('../navigation/OnboardingNavigator', () => () => null);
jest.mock('../navigation/ConsultationOnboardingNavigator', () => mockStub('nav-consultation'));
jest.mock('../navigation/CoachWizardNavigator', () => mockStub('nav-wizard'));
jest.mock('../navigation/Day1OnboardingNavigator', () => () => null);
jest.mock('../screens/consultation/AgeCheckScreen', () => ({ AgeCheckNavigator: mockStub('nav-age-check') }));
jest.mock('../components/OfflineBanner', () => () => null);
jest.mock('../components/PackageSelectionSheet', () => mockStub('package-prompt'));
const mockGetEntitlement = jest.fn();
jest.mock('../api/clientPaymentsApi', () => ({ clientPaymentsApi: { getEntitlement: () => mockGetEntitlement() } }));
jest.mock('../screens/client/Day1WinScreen', () => mockStub('day1win'));
jest.mock('../services/support/crisp.service', () => ({ initCrisp: jest.fn(), syncCrispIdentity: jest.fn() }));
jest.mock('../hooks/useLeanOnboardingReconcile', () => ({ useLeanOnboardingReconcile: jest.fn() }));
const mockGetStatus = jest.fn();
jest.mock('../services/firstWinApi', () => ({ firstWinApi: { getStatus: () => mockGetStatus() }, WinType: {} }));
jest.mock('../services/foodLogQueue', () => ({ flush: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => ({ isOnline: true, isInternetReachable: true }),
  isEffectivelyOnline: () => true,
}));
const mockAuthListeners: (() => void)[] = [];
jest.mock('../utils/authEvents', () => ({
  authEvents: {
    // authActions' own import (sessionFence) subscribes before this file's consts exist: kept out of the list.
    onAuthChange: (cb: () => void) => { mockAuthListeners?.push(cb); return () => undefined; },
    on: jest.fn(() => () => {}),
    emit: jest.fn(),
  },
}));
jest.mock('../screenshots', () => ({ isScreenshotMode: () => false }));
jest.mock('../offline', () => ({ triggerSync: jest.fn(async () => undefined) }));
jest.mock('../entitlements/EntitlementProvider', () => ({
  EntitlementProvider: ({ children }: { children: unknown }) => children,
}));
let mockGate: 'unlocked' | 'locked' = 'unlocked';
jest.mock('../hooks/useBiometricGate', () => ({ useBiometricGate: () => ({ status: mockGate, retry: jest.fn() }) }));
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, bottom: 0, left: 0, right: 0 }),
}));
const mockAddReceived = jest.fn((_cb: unknown) => ({ remove: jest.fn() }));
// jest.setup.js's expo-notifications surface plus the received listener the banner store is fed by.
jest.mock('expo-notifications', () => ({
  unregisterForNotificationsAsync: jest.fn(async () => undefined),
  cancelScheduledNotificationAsync: jest.fn(async () => undefined),
  scheduleNotificationAsync: jest.fn(async () => 'mock-notif-id'),
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => undefined),
  getPermissionsAsync: jest.fn(async () => ({ status: 'undetermined' })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  AndroidImportance: { MAX: 5, HIGH: 4, DEFAULT: 3, LOW: 2, MIN: 1 },
  addNotificationReceivedListener: (cb: unknown) => mockAddReceived(cb),
}));

import React from 'react';
import { render, cleanup, act } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClientProvider } from '@tanstack/react-query';
import RootNavigator from '../navigation/RootNavigator';
import BiometricUnlockGate from '../components/BiometricUnlockGate';
import { queryClient, persisterKeyForUser } from '../services/queryClient';
import { installForegroundHandler } from '../services/pushNotifications';
import { foregroundBannerStore } from '../store/foregroundBannerStore';
import { resetUserScopedStores } from '../services/authActions';

const TITLE = 'Stand-in title';
const BODY = 'Stand-in body';
const STUDENT = {
  id: 'client-S', email: 's@example.com', role: 'student', name: 'Sam', coach_id: 'coach-1',
  profile: { onboarding_completed: true, day_one_completed: true, date_of_birth: '1990-01-01' },
};
const COACH = { id: 'coach-C', email: 'c@example.com', role: 'coach', name: 'Cal' };
const PROMPT_KEY = 'prefs:onboarding.package_prompt_dismissed_at:client-S';

let receive: (n: unknown) => void;
let stop: () => void;
let seq = 0;
beforeAll(() => {
  stop = installForegroundHandler();
  receive = mockAddReceived.mock.calls[mockAddReceived.mock.calls.length - 1][0] as (n: unknown) => void;
});
afterAll(() => stop());

beforeEach(async () => {
  await AsyncStorage.clear();
  queryClient.clear();
  for (const k of Object.keys(mockSecure)) delete mockSecure[k];
  mockHangToken = false;
  mockStepMs = 60000;
  mockGate = 'unlocked';
  mockAuthListeners.length = 0;
  mockApiGet.mockReset().mockResolvedValue({ data: { is_complete: true } });
  mockMe.mockReset().mockResolvedValue({ data: { profile: { date_of_birth: '1990-01-01' } } });
  mockGetStatus.mockReset().mockResolvedValue({ data: { completed: true } });
  mockGetEntitlement.mockReset().mockResolvedValue({ ok: true, data: { active: true, entitlement_active: true } });
  await AsyncStorage.setItem('onboarding_complete', 'true');
  await AsyncStorage.setItem('day_one_completed', 'true');
  await AsyncStorage.setItem(PROMPT_KEY, new Date().toISOString());
});
afterEach(async () => {
  await act(async () => foregroundBannerStore.getState().reset());
  await cleanup();
});

async function signIn(user: object) {
  mockSecure['supabase_token'] = 'jwt';
  await AsyncStorage.setItem('prefs:auth.user_data', JSON.stringify(user));
}
const mount = (tree: React.ReactElement = <RootNavigator />) =>
  render(<QueryClientProvider client={queryClient}>{tree}</QueryClientProvider>);
/** A push received while the app is open (the real listener, pushNotifications.ts installForegroundHandler). */
async function push(title = TITLE, body = BODY) {
  seq += 1;
  await act(async () => receive({
    request: { identifier: `n-${seq}`, content: { title, body, data: { kind: 'message_received', actionScreen: 'Messages' } } },
  }));
}
const label = `${TITLE}. ${BODY}. Tap to view.`;

describe('case 1: the client and coach apps draw the banner', () => {
  it.each([
    ['client (student)', STUDENT, 'nav-client', undefined],
    ['client under the package prompt', STUDENT, 'package-prompt', 'prompt'],
    ['coach', COACH, 'nav-coach', undefined],
  ])('%s: exactly its title and body', async (_name, user, anchor, prompt) => {
    if (prompt) {
      await AsyncStorage.setItem(PROMPT_KEY, new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString());
      mockGetEntitlement.mockResolvedValue({ ok: true, data: { active: false, entitlement_active: false } });
    }
    await signIn(user);
    const r = await mount();
    await r.findByTestId(anchor);
    await push();
    expect(r.getByText(TITLE)).toBeTruthy();
    expect(r.getByText(BODY)).toBeTruthy();
    expect(r.getByLabelText(label)).toBeTruthy();
  });
});

describe('case 2: no banner outside a mounted client or coach app', () => {
  it.each([
    ['signed out', async () => { await AsyncStorage.setItem('prefs:auth.user_data', JSON.stringify(STUDENT)); }, 'nav-auth'],
    ['the consultation (onboarding)', async () => {
      await AsyncStorage.removeItem('onboarding_complete');
      await signIn({ ...STUDENT, profile: { onboarding_completed: false } });
    }, 'nav-consultation'],
    ['the age check', async () => {
      mockMe.mockResolvedValue({ data: { profile: { date_of_birth: null } } });
      await signIn({ ...STUDENT, profile: { onboarding_completed: true, day_one_completed: true } });
    }, 'nav-age-check'],
    ['the coach wizard', async () => {
      mockApiGet.mockResolvedValue({ data: { is_complete: false } });
      await signIn(COACH);
    }, 'nav-wizard'],
    ['the Day-1 win', async () => {
      await AsyncStorage.setItem('onboarding_standard_path:client-S', 'true');
      mockGetStatus.mockResolvedValue({ data: { completed: false } });
      await signIn(STUDENT);
    }, 'day1win'],
    ['startup pending (loading)', async () => { await signIn(STUDENT); mockHangToken = true; }, 'startup-pending'],
    ['the startup error', async () => { await signIn(STUDENT); mockHangToken = true; mockStepMs = 40; }, 'startup-error'],
  ])('%s', async (_name, arrange, anchor) => {
    await arrange();
    const r = await mount();
    await r.findByTestId(anchor);
    await push();
    expect(foregroundBannerStore.getState().banner?.title).toBe(TITLE); // held, never drawn
    expect(r.queryByText(TITLE)).toBeNull();
    expect(r.queryByLabelText(label)).toBeNull();
  });

  it('a coach while the persisted cache restores: no banner until the coach app is mounted', async () => {
    await signIn(COACH);
    let release: (v: string | null) => void = () => undefined;
    const realGet = AsyncStorage.getItem.bind(AsyncStorage);
    const spy = jest.spyOn(AsyncStorage, 'getItem').mockImplementation((k: string) =>
      k === persisterKeyForUser('coach-C') ? new Promise<string | null>((res) => { release = res; }) : realGet(k),
    );
    const r = await mount();
    await r.findByTestId('persisted-cache-pending');
    await push();
    expect(r.queryByTestId('nav-coach')).toBeNull();
    expect(r.queryByText(TITLE)).toBeNull();
    await act(async () => release(null));
    await r.findByTestId('nav-coach');
    expect(r.getByText(TITLE)).toBeTruthy();
    spy.mockRestore();
  });

  it('behind the biometric lock: no banner', async () => {
    mockGate = 'locked';
    await signIn(COACH);
    const r = await mount(<BiometricUnlockGate><RootNavigator /></BiometricUnlockGate>);
    await act(async () => { await new Promise((res) => setTimeout(res, 20)); });
    await push();
    expect(r.queryByTestId('nav-coach')).toBeNull();
    expect(r.queryByText(TITLE)).toBeNull();
  });
});

describe('case 3: sign-out takes the banner with it', () => {
  it('a showing banner is gone at once, and the next account never sees it', async () => {
    await signIn(COACH);
    const r = await mount();
    await r.findByTestId('nav-coach');
    await push();
    expect(r.getByText(TITLE)).toBeTruthy();
    // signOut's own clean-up (authActions.ts:660), then the session ends and the navigator re-bootstraps.
    await act(async () => {
      resetUserScopedStores();
      delete mockSecure['supabase_token'];
      mockAuthListeners.forEach((cb) => cb());
    });
    await r.findByTestId('nav-auth');
    expect(r.queryByText(TITLE)).toBeNull();
    expect(foregroundBannerStore.getState().banner).toBeNull();
    await signIn(STUDENT);
    await act(async () => { mockAuthListeners.forEach((cb) => cb()); });
    await r.findByTestId('nav-client');
    expect(r.queryByText(TITLE)).toBeNull();
  });
});
