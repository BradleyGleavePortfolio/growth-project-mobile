/**
 * useHealthKitSync — hook surface tests.
 *
 * Verifies:
 *   - `isSupported` reflects the client's platform support.
 *   - `sync(...)` delegates to `healthKitSyncService.sync` and resolves with
 *     the result on the mutation.
 *   - A sync failure surfaces on `mutation.error` (no throw out of the hook
 *     when using the mutation state).
 *
 * The sync service and client are mocked at the connector barrel so the hook
 * is tested in isolation from the native bridge / axios.
 */

import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockSync = jest.fn();
let mockIsSupported = true;

jest.mock('../../services/health/healthkit', () => ({
  __esModule: true,
  healthKitSyncService: { sync: (...args: unknown[]) => mockSync(...args) },
  healthKitClient: {
    get isSupported() {
      return mockIsSupported;
    },
  },
  HealthKitUnsupportedError: class HealthKitUnsupportedError extends Error {},
}));

import { useHealthKitSync } from '../useHealthKitSync';

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

const RESULT = {
  postedCount: 3,
  since: '2026-05-01T00:00:00.000Z',
  until: '2026-05-31T12:00:00.000Z',
  cursorAdvanced: true,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockIsSupported = true;
});

describe('useHealthKitSync', () => {
  it('exposes isSupported from the client (iOS)', () => {
    const { result } = renderHook(() => useHealthKitSync(), { wrapper: makeWrapper() });
    expect(result.current.isSupported).toBe(true);
  });

  it('reflects isSupported=false off iOS', () => {
    mockIsSupported = false;
    const { result } = renderHook(() => useHealthKitSync(), { wrapper: makeWrapper() });
    expect(result.current.isSupported).toBe(false);
  });

  it('delegates sync() to the service and resolves with the result', async () => {
    mockSync.mockResolvedValueOnce(RESULT);
    const { result } = renderHook(() => useHealthKitSync(), { wrapper: makeWrapper() });

    let resolved: unknown;
    await act(async () => {
      resolved = await result.current.sync({ userId: 'u', connectionId: 'c' });
    });

    expect(mockSync).toHaveBeenCalledWith({ userId: 'u', connectionId: 'c' });
    expect(resolved).toEqual(RESULT);
    await waitFor(() => expect(result.current.mutation.data).toEqual(RESULT));
  });

  it('surfaces a sync failure on mutation.error', async () => {
    mockSync.mockRejectedValueOnce(new Error('ingest down'));
    const { result } = renderHook(() => useHealthKitSync(), { wrapper: makeWrapper() });

    await act(async () => {
      await expect(
        result.current.sync({ userId: 'u', connectionId: 'c' }),
      ).rejects.toThrow('ingest down');
    });

    await waitFor(() => expect(result.current.mutation.isError).toBe(true));
    expect(result.current.mutation.error?.message).toBe('ingest down');
  });
});
