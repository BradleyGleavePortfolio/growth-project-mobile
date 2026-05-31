// PR-HK-2.b — useHealthConnectSync hook tests.
//
// Verifies the hook exposes `supported` (platform-derived), runs a sync via
// the injected deps, and surfaces success/error through the mutation. The
// sync service is exercised through dependency injection (mocked client +
// ingest api) so the hook test does not touch the native library directly.

import React from 'react';
import { Platform } from 'react-native';
import { renderHook, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const store: Record<string, string> = {};
jest.mock('../services/secureStorage', () => ({
  secureStorage: {
    getItem: jest.fn((k: string) => Promise.resolve(store[k] ?? null)),
    setItem: jest.fn((k: string, v: string) => {
      store[k] = v;
      return Promise.resolve();
    }),
    removeItem: jest.fn((k: string) => {
      delete store[k];
      return Promise.resolve();
    }),
  },
}));

jest.mock('../utils/logger', () => ({
  logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { useHealthConnectSync } from './useHealthConnectSync';
import { HealthConnectUnsupportedError } from '../services/health/healthConnect';

function setPlatform(os: string): void {
  Object.defineProperty(Platform, 'OS', { get: () => os, configurable: true });
}

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const NOW = new Date('2026-05-10T12:00:00.000Z');

function deps() {
  const grant = [{ accessType: 'read', recordType: 'Steps' }];
  const client = {
    isHealthConnectSupported: jest.fn(() => true),
    buildReadPermissions: jest.fn(() => grant),
    initialize: jest.fn().mockResolvedValue(true),
    requestPermission: jest.fn().mockResolvedValue(grant),
    getGrantedPermissions: jest.fn().mockResolvedValue(grant),
    readRecords: jest
      .fn()
      .mockResolvedValue([
        { startTime: NOW.toISOString(), endTime: NOW.toISOString(), count: 11 },
      ]),
    readAllSupportedRecords: jest.fn(),
  };
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: client as any,
    ingestApi: { ingest: jest.fn().mockResolvedValue({ inserted: 1, skipped: 0 }) },
    now: () => NOW,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(store)) delete store[k];
  setPlatform('android');
});

describe('useHealthConnectSync', () => {
  it('reports supported=true on android', () => {
    const { result } = renderHook(() => useHealthConnectSync(), { wrapper });
    expect(result.current.supported).toBe(true);
  });

  it('reports supported=false on ios', () => {
    setPlatform('ios');
    const { result } = renderHook(() => useHealthConnectSync(), { wrapper });
    expect(result.current.supported).toBe(false);
  });

  it('runs a sync and surfaces the result', async () => {
    const d = deps();
    const { result } = renderHook(() => useHealthConnectSync({ deps: d }), { wrapper });

    let res: { normalizedCount: number; inserted: number } | undefined;
    await act(async () => {
      res = await result.current.sync({ userId: 'u1', connectionId: 'c1' });
      // Allow the post-resolution mutation state update to flush inside act().
      await Promise.resolve();
    });

    expect(res?.normalizedCount).toBe(1);
    expect(res?.inserted).toBe(1);
    expect(d.ingestApi.ingest).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.mutation.isSuccess).toBe(true));
  });

  it('rejects with HealthConnectUnsupportedError on ios', async () => {
    setPlatform('ios');
    const d = deps();
    const { result } = renderHook(() => useHealthConnectSync({ deps: d }), { wrapper });
    await act(async () => {
      await expect(
        result.current.sync({ userId: 'u1', connectionId: 'c1' }),
      ).rejects.toBeInstanceOf(HealthConnectUnsupportedError);
      await Promise.resolve();
    });
  });
});
