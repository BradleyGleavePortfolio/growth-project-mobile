/**
 * PR-HK-2.c — `useSamsungHealthSync` / `useSamsungHealthLastSync` hook tests.
 *
 * The hooks own no connector logic; they wrap the connector's public surface
 * (`sync`, `getLastSyncAt`) in React Query primitives. These tests mock that
 * surface and assert:
 *   • the lastSync query reads through `getLastSyncAt` and exposes its value;
 *   • the sync mutation calls `sync()` and surfaces the result;
 *   • a successful sync invalidates the lastSync query so a freshness chip
 *     re-reads;
 *   • a failed sync surfaces the error (it is not swallowed).
 */

import React from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockSync = jest.fn();
const mockGetLastSyncAt = jest.fn();
jest.mock('../services/health/samsungHealth', () => ({
  __esModule: true,
  sync: (...a: unknown[]) => mockSync(...a),
  getLastSyncAt: (...a: unknown[]) => mockGetLastSyncAt(...a),
}));

import {
  useSamsungHealthLastSync,
  useSamsungHealthSync,
  SAMSUNG_HEALTH_LAST_SYNC_QUERY_KEY,
  SAMSUNG_HEALTH_SYNC_MUTATION_KEY,
} from './useSamsungHealthSync';

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
  return { qc, wrapper };
}

describe('useSamsungHealthSync hooks', () => {
  beforeEach(() => {
    mockSync.mockReset();
    mockGetLastSyncAt.mockReset();
  });

  describe('query keys', () => {
    it('exposes the stable lastSync query key', () => {
      expect(SAMSUNG_HEALTH_LAST_SYNC_QUERY_KEY).toEqual([
        'wearable',
        'samsung-health',
        'lastSyncAt',
      ]);
    });

    it('exposes the stable sync mutation key', () => {
      expect(SAMSUNG_HEALTH_SYNC_MUTATION_KEY).toEqual([
        'wearable',
        'samsung-health',
        'sync',
      ]);
    });
  });

  describe('useSamsungHealthLastSync', () => {
    it('reads the persisted lastSyncAt via getLastSyncAt', async () => {
      mockGetLastSyncAt.mockResolvedValueOnce('2026-05-30T12:00:00.000Z');
      const { wrapper } = makeWrapper();

      const { result } = await renderHook(() => useSamsungHealthLastSync(), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toBe('2026-05-30T12:00:00.000Z');
      expect(mockGetLastSyncAt).toHaveBeenCalledTimes(1);
    });

    it('exposes null when never synced', async () => {
      mockGetLastSyncAt.mockResolvedValueOnce(null);
      const { wrapper } = makeWrapper();

      const { result } = await renderHook(() => useSamsungHealthLastSync(), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toBeNull();
    });
  });

  describe('useSamsungHealthSync', () => {
    it('calls sync() and surfaces the result on mutate', async () => {
      const syncResult = {
        ingested: true,
        sampleCount: 3,
        recordTypesRead: ['Steps'],
        windowStart: '2026-05-01T00:00:00.000Z',
        windowEnd: '2026-05-31T00:00:00.000Z',
        lastSyncAt: '2026-05-31T00:00:00.000Z',
      };
      mockSync.mockResolvedValueOnce(syncResult);
      const { wrapper } = makeWrapper();

      const { result } = await renderHook(() => useSamsungHealthSync(), { wrapper });

      result.current.mutate();

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockSync).toHaveBeenCalledTimes(1);
      expect(result.current.data).toEqual(syncResult);
    });

    it('invalidates the lastSync query on success', async () => {
      mockSync.mockResolvedValueOnce({
        ingested: false,
        sampleCount: 0,
        recordTypesRead: [],
        windowStart: 'a',
        windowEnd: 'b',
        lastSyncAt: 'b',
      });
      const { qc, wrapper } = makeWrapper();
      const invalidateSpy = jest.spyOn(qc, 'invalidateQueries');

      const { result } = await renderHook(() => useSamsungHealthSync(), { wrapper });
      result.current.mutate();

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: SAMSUNG_HEALTH_LAST_SYNC_QUERY_KEY,
      });
    });

    it('surfaces a sync error (not swallowed)', async () => {
      mockSync.mockRejectedValueOnce(new Error('permission denied'));
      const { wrapper } = makeWrapper();

      const { result } = await renderHook(() => useSamsungHealthSync(), { wrapper });
      result.current.mutate();

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.error?.message).toBe('permission denied');
    });
  });
});
