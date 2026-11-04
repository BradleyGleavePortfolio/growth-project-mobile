/**
 * LO-923 B-TEST (B1): the all-on job must also turn on the switches the phone
 * reads from the server (GET /me/feature-flags, src/hooks/useFeatureFlags.ts).
 * The jest run has no backend, so the transport is unreachable here; the job
 * has to supply the on map itself (for example a test-only setup file). Run by
 * the job's proof step (*.check.js), never by the normal suite.
 */
const React = require('react');
const { renderHook, waitFor } = require('@testing-library/react-native');
const { QueryClient, QueryClientProvider } = require('@tanstack/react-query');

jest.mock('../../src/services/api', () => {
  const down = () => Promise.reject(Object.assign(new Error('no backend in the all-on run'), { request: {} }));
  const api = { get: down, post: down, put: down, patch: down, delete: down };
  return { __esModule: true, default: api };
});

const { SERVER_FEATURE_FLAG_KEYS } = require('../../src/api/featureFlagsApi');
const { useFeatureFlags } = require('../../src/hooks/useFeatureFlags');

test('every server switch the phone reads (GET /me/feature-flags) reads on', async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }) => React.createElement(QueryClientProvider, { client: qc }, children);
  const { result } = await renderHook(() => useFeatureFlags(), { wrapper });
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  const off = SERVER_FEATURE_FLAG_KEYS.filter((k) => result.current.flags[k] !== true);
  expect(off).toEqual([]);
});
