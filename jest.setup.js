// Jest global setup for the mobile app.
// jest-expo handles most RN/Expo shims; we only add mocks for modules that
// tests touch explicitly.

// PR-18 M1 R2 P3: the jest-expo preset is heavy and a cold RTL mount can take
// several seconds on a slow CI box. A handful of async `waitFor`-based screen
// tests (e.g. CoachPackageContentsScreen) intermittently raced Jest's 5s
// default per-test timeout. Raise the global budget here so the suite is
// robust WITHOUT requiring a `--testTimeout` override on the command line.
jest.setTimeout(20000);

// react-native-worklets throws at module-load when `global.__workletsModuleProxy`
// is undefined (NativeWorklets initializes during top-level import via
// reanimated → Skeleton → screen tests). The native TurboModule isn't present
// under Jest, so we install a Proxy that returns a jest.fn() for any method
// the wrapper invokes — enough to satisfy the init check.
global.__workletsModuleProxy = new Proxy(
  {},
  {
    get: () => jest.fn(() => ({})),
  },
);

// env.ts throws at module-load when these aren't set; provide deterministic
// stubs so tests that transitively import it (e.g. via services/api) can run.
process.env.EXPO_PUBLIC_SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL || 'http://test.local';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'test-anon-key';
process.env.EXPO_PUBLIC_API_URL =
  process.env.EXPO_PUBLIC_API_URL || 'http://test.local/api';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// expo-crypto: counter-backed UUID so tests get distinct ids without pulling
// in the native module. Format matches the v4-UUID shape we use for the
// food-log idempotency keys.
jest.mock('expo-crypto', () => {
  let counter = 0;
  return {
    randomUUID: jest.fn(() => {
      counter += 1;
      const hex = counter.toString(16).padStart(12, '0');
      return `00000000-0000-4000-8000-${hex}`;
    }),
    digestStringAsync: jest.fn(async (_alg, input) => `digest:${input}`),
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  };
});

// expo-notifications: just enough surface for the auth/signOut path. Tests
// that need richer behaviour can call jest.requireMock to access the mocks.
jest.mock('expo-notifications', () => ({
  unregisterForNotificationsAsync: jest.fn(async () => undefined),
  cancelScheduledNotificationAsync: jest.fn(async () => undefined),
  scheduleNotificationAsync: jest.fn(async () => 'mock-notif-id'),
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => undefined),
  getPermissionsAsync: jest.fn(async () => ({ status: 'undetermined' })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  AndroidImportance: { MAX: 5, HIGH: 4, DEFAULT: 3, LOW: 2, MIN: 1 },
}));

jest.mock('expo-secure-store', () => {
  const store = new Map();
  return {
    __store: store,
    setItemAsync: jest.fn(async (k, v) => {
      store.set(k, v);
    }),
    getItemAsync: jest.fn(async (k) => (store.has(k) ? store.get(k) : null)),
    deleteItemAsync: jest.fn(async (k) => {
      store.delete(k);
    }),
  };
});

jest.mock('@react-native-community/netinfo', () => {
  const listeners = new Set();
  let current = { isConnected: true, isInternetReachable: true };
  return {
    __setState: (next) => {
      current = { ...current, ...next };
      listeners.forEach((fn) => fn(current));
    },
    __reset: () => {
      current = { isConnected: true, isInternetReachable: true };
      listeners.clear();
    },
    fetch: jest.fn(async () => current),
    addEventListener: jest.fn((fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    }),
  };
});

// Phase 11 Track 9 — Mock crisp-sdk-react-native in all tests.
// The package bundles native modules that are unavailable in the Jest runner.
jest.mock('crisp-sdk-react-native', () => ({
  configure: jest.fn(),
  show: jest.fn(),
  hide: jest.fn(),
  setUserEmail: jest.fn(),
  setUserNickname: jest.fn(),
  setUserPhone: jest.fn(),
  setUserAvatar: jest.fn(),
  setSessionString: jest.fn(),
  setSessionBool: jest.fn(),
  setSessionInt: jest.fn(),
  setSessionSegment: jest.fn(),
  setSessionSegments: jest.fn(),
  getSessionIdentifier: jest.fn(async () => null),
  resetSession: jest.fn(),
}));

// Skeleton primitives read from the real ThemeProvider's `tokens` map. Most
// screen-level tests stub useTheme() to return only `{ colors: {...} }` and
// don't care about Skeleton's pixel-perfect appearance — they just need
// the screen's loading state to render without crashing. Replace Skeleton
// and its composites with lightweight placeholder Views so those tests
// don't have to keep theme mocks in lock-step with the Skeleton internals.
// Tests that DO want to assert on Skeleton's real behaviour can call
// jest.unmock('./src/ui/skeletons/Skeleton') and provide a complete theme.
jest.mock('./src/ui/skeletons/Skeleton', () => {
  const React = require('react');
  const { View } = require('react-native');
  const stub = (props) => React.createElement(View, props);
  return {
    __esModule: true,
    default: stub,
    Skeleton: stub,
    SkeletonRow: stub,
    SkeletonList: stub,
    SkeletonScreen: stub,
  };
});

// P1-2 (PR #192): react-native-get-random-values polyfills crypto.getRandomValues
// for Hermes / React Native. Under Jest (Node.js), globalThis.crypto.getRandomValues
// is already available natively, so this module is a no-op stub.
jest.mock('react-native-get-random-values', () => {});

// PR-HK-1: on-device wearable connectors (Apple HealthKit / Health Connect /
// Samsung Health) import these native modules through the single
// `services/health/onDeviceConnect` seam. The native TurboModules aren't
// present under Jest, so provide minimal default mocks (the granted path) here
// so any screen that transitively imports the seam mounts cleanly. Tests that
// exercise specific outcomes override these per-case with jest.mock(...).
jest.mock('react-native-health', () => ({
  __esModule: true,
  default: {
    Constants: {
      Permissions: {
        Steps: 'Steps',
        StepCount: 'StepCount',
        HeartRate: 'HeartRate',
        RestingHeartRate: 'RestingHeartRate',
        HeartRateVariability: 'HeartRateVariability',
        ActiveEnergyBurned: 'ActiveEnergyBurned',
        SleepAnalysis: 'SleepAnalysis',
        Workout: 'Workout',
      },
    },
    initHealthKit: jest.fn((_perms, cb) => cb(null)),
    isAvailable: jest.fn((cb) => cb(null, true)),
  },
}));

jest.mock('react-native-health-connect', () => ({
  __esModule: true,
  SdkAvailabilityStatus: {
    SDK_UNAVAILABLE: 1,
    SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED: 2,
    SDK_AVAILABLE: 3,
  },
  getSdkStatus: jest.fn(async () => 3),
  initialize: jest.fn(async () => true),
  openHealthConnectSettings: jest.fn(),
  requestPermission: jest.fn(async (perms) => perms),
}));
