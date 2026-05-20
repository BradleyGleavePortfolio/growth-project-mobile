// Jest global setup for the mobile app.
// jest-expo handles most RN/Expo shims; we only add mocks for modules that
// tests touch explicitly.

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
