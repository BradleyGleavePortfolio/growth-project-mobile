/**
 * ALL-ON-CI-M: a test file that mocks expo-constants, featureFlagsApi or
 * communityApi itself keeps its own mock in the all-on job; switchesOn.setup.js
 * only fills the gap when a test supplies nothing. Run by the proof step only.
 */
const React = require('react');
const { Platform } = require('react-native');
const { renderHook, waitFor } = require('@testing-library/react-native');
const { QueryClient, QueryClientProvider } = require('@tanstack/react-query');

jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: {} } } }));
jest.mock('../../src/api/communityApi', () => ({
  ...jest.requireActual('../../src/api/communityApi'),
  communityApi: { getMe: async () => ({ feature_flag_state: 'disabled' }) },
}));
jest.mock('../../src/api/featureFlagsApi', () => ({
  ...jest.requireActual('../../src/api/featureFlagsApi'),
  featureFlagsApi: { getFeatureFlags: async () => ({ flags: {}, evaluated_at: new Date().toISOString() }) },
}));

const { SERVER_FEATURE_FLAG_KEYS } = require('../../src/api/featureFlagsApi');
const { useFeatureFlags } = require('../../src/hooks/useFeatureFlags');
const { isAndroidHealthConnectEnabled } = require('../../src/config/healthConnect');
const { communityApi } = require('../../src/api/communityApi');

test("a test's own expo-constants mock wins over the job's", () => {
  const os = Platform.OS;
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
  try {
    expect(isAndroidHealthConnectEnabled()).toBe(false);
  } finally {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: os });
  }
});

test("a test's own featureFlagsApi mock wins over the job's", async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }) => React.createElement(QueryClientProvider, { client: qc }, children);
  const { result } = await renderHook(() => useFeatureFlags(), { wrapper });
  await waitFor(() => expect(result.current.data).toBeDefined());
  expect(SERVER_FEATURE_FLAG_KEYS.filter((k) => result.current.flags[k])).toEqual([]);
});

test("a test's own communityApi mock wins over the job's", async () => {
  expect((await communityApi.getMe()).feature_flag_state).toBe('disabled');
});
