import React from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react-native';

let mockUser: { id: string; role: string; profile: object } | null;
let mockInitialUrl: string | null;
let mockUrlListener: ((event: { url: string }) => void) | undefined;
const mockAuthListeners: Array<() => void> = [];
let mockPushListener: ((response: unknown) => void) | undefined;
const mockNavigate = jest.fn();
const mockSignOut = jest.fn();
let mockRoots = ['Home', 'WorkoutTab', 'MoreTab', 'Log', 'ClientsStack', 'Messages', 'SettingsStack'];

jest.mock('../lib/userCache', () => ({
  readUserCache: async () => mockUser,
  clearUserCache: jest.fn(),
  patchUserCache: jest.fn(),
}));
jest.mock('../services/secureStorage', () => ({
  secureStorage: { getItem: async () => mockUser ? 'session' : null },
}));
jest.mock('../services/authActions', () => ({ signOut: () => mockSignOut() }));
jest.mock('../services/api', () => ({
  __esModule: true,
  default: { get: async () => ({ data: { is_complete: true } }) },
  authApi: { me: async () => ({ data: mockUser }) },
}));
jest.mock('../utils/authEvents', () => ({
  authEvents: { onAuthChange: (fn: () => void) => { mockAuthListeners.push(fn); return () => {}; } },
}));
jest.mock('react-native/Libraries/Linking/Linking', () => ({
  __esModule: true,
  default: {
    getInitialURL: async () => mockInitialUrl,
    addEventListener: (_: string, fn: typeof mockUrlListener) => {
      mockUrlListener = fn;
      return { remove: jest.fn() };
    },
    openURL: jest.fn(),
  },
}));
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    NavigationContainer: ({ children }: { children: React.ReactNode }) => children,
    createNavigationContainerRef: () => ({
      isReady: () => true,
      navigate: (...args: unknown[]) => mockNavigate(...args),
      getRootState: () => ({ routeNames: mockRoots }),
      getCurrentRoute: () => undefined,
      addListener: () => () => {},
    }),
  };
});
jest.mock('expo-notifications', () => ({
  addNotificationResponseReceivedListener: (fn: typeof mockPushListener) => {
    mockPushListener = fn;
    return { remove: jest.fn() };
  },
  getLastNotificationResponseAsync: async () => null,
}));
jest.mock('../navigation/AuthNavigator', () => () => null);
jest.mock('../navigation/ClientNavigator', () => () => null);
jest.mock('../navigation/CoachNavigator', () => () => null);
jest.mock('../navigation/CoachWizardNavigator', () => () => null);
jest.mock('../navigation/ConsultationOnboardingNavigator', () => () => null);
jest.mock('../navigation/OnboardingNavigator', () => () => null);
jest.mock('../components/OfflineBanner', () => () => null);
jest.mock('../components/PackageSelectionSheet', () => () => null);
jest.mock('../screens/client/Day1WinScreen', () => () => null);
jest.mock('../services/support/crisp.service', () => ({ initCrisp: jest.fn(), syncCrispIdentity: jest.fn() }));
jest.mock('../hooks/useLeanOnboardingReconcile', () => ({ useLeanOnboardingReconcile: () => {} }));
jest.mock('../hooks/useFoodLogQueueSync', () => ({ useFoodLogQueueSync: () => {} }));
jest.mock('../hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => ({ isOnline: true, isInternetReachable: true }),
  isEffectivelyOnline: () => true,
}));
jest.mock('../offline', () => ({ triggerSync: async () => {} }));
jest.mock('../services/firstWinApi', () => ({
  firstWinApi: { getStatus: async () => ({ data: { completed: true } }) },
}));
jest.mock('../screenshots', () => ({ isScreenshotMode: () => false }));
jest.mock('../entitlements/EntitlementProvider', () => ({
  EntitlementProvider: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('../entitlements/dunning/DunningLockoutProvider', () => ({
  DunningLockoutProvider: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('../services/PersistedQueryCacheGate', () => ({
  PersistedQueryCacheGate: ({ children }: { children: React.ReactNode }) => children,
}));

import RootNavigator, { linking } from '../navigation/RootNavigator';
import { __resetPushTapRouterForTests, routePushTap } from '../services/pushTapRouter';
import { installNotificationResponseHandler } from '../services/pushNotifications';

const ID = '137c1340-c8a2-45d6-a006-7a6e695ed845';
const CLIENT = {
  id: 'client-one', role: 'student',
  profile: { onboarding_completed: true, date_of_birth: '1990-01-01' },
};
const mealTarget = { screen: 'ClientDailyMealPlan', params: { assignmentId: ID }, initial: false };

beforeEach(() => {
  jest.clearAllMocks();
  __resetPushTapRouterForTests();
  mockUser = CLIENT;
  mockInitialUrl = null;
  mockUrlListener = undefined;
  mockAuthListeners.length = 0;
  mockRoots = ['Home', 'WorkoutTab', 'MoreTab', 'Log', 'ClientsStack', 'Messages', 'SettingsStack'];
});
afterEach(cleanup);

async function warm(url: string) {
  await render(<RootNavigator />);
  await act(async () => { mockUrlListener?.({ url }); });
}

it.each([
  `tgp://meal-plan/${ID}`,
  `https://app.trygrowthproject.com/meal-plan/${ID}`,
])('opens the existing client meal-plan screen from %s', async (url) => {
  await warm(url);
  await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('MoreTab', mealTarget));
});

it.each([
  'https://unknown.example/meal-plan/',
  'https://app.trygrowthproject.com.evil.example/meal-plan/',
  'https://evil.example/app.trygrowthproject.com/meal-plan/',
  'http://app.trygrowthproject.com/meal-plan/',
  'other://meal-plan/',
  'tgp://meal-plan/not-an-id',
  'tgp://meal-plan/%E0%A4%A',
  'tgp://meal-plan/%2F',
])('ignores an untrusted URL or malformed id: %s', async (prefix) => {
  const url = prefix.endsWith('/') ? prefix + ID : prefix;
  await warm(url);
  expect(mockNavigate).not.toHaveBeenCalled();
  expect(mockSignOut).not.toHaveBeenCalled();
});

it('never lets the native linking receiver accept an unknown host', () => {
  expect(linking.filter?.(`https://app.trygrowthproject.com.evil.example/join/${ID}`)).toBe(false);
});

it('holds a signed-out cold-start link until sign-in mounts the client navigator', async () => {
  mockUser = null;
  mockInitialUrl = `tgp://meal-plan/${ID}`;
  mockRoots = ['Welcome', 'Login'];
  await render(<RootNavigator />);
  expect(mockNavigate).not.toHaveBeenCalled();
  mockUser = CLIENT;
  mockRoots = ['Home', 'MoreTab', 'WorkoutTab', 'Log'];
  await act(async () => { mockAuthListeners.forEach((fn) => fn()); });
  await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('MoreTab', mealTarget));
  expect(mockNavigate).toHaveBeenCalledTimes(1);
});

it.each(['deepLink', 'deep_link'])('routes the meal-plan push via %s instead of the fallback inbox', async (key) => {
  await render(<RootNavigator />);
  const stop = installNotificationResponseHandler(routePushTap);
  await act(async () => {
    mockPushListener?.({
      notification: { request: { identifier: key, content: {
        data: { actionScreen: 'NotificationCenter', [key]: `tgp://meal-plan/${ID}` },
      } } },
    });
  });
  await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('MoreTab', mealTarget));
  expect(mockNavigate).toHaveBeenCalledTimes(1);
  stop();
});

it('does not open a client meal plan in the coach navigator', async () => {
  mockUser = { ...CLIENT, id: 'coach-one', role: 'coach' };
  await warm(`tgp://meal-plan/${ID}`);
  expect(mockNavigate).not.toHaveBeenCalled();
});
