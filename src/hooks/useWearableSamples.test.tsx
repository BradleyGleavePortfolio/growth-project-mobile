/**
 * useWearableSamples — hook surface tests.
 *
 * Mocks the API client at `../api/wearablesSamplesApi` and exercises:
 *   • happy path — the query resolves to the DTO,
 *   • error path — a rejected query surfaces `isError` (NOT swallowed),
 *   • `enabled:false` gates the request,
 *   • the cache key is fully normalised (optionals → null/defaults) so two
 *     param sets that differ only in an omitted-vs-defaulted field share a key.
 *
 * Uses the repo's standard React Query test wrapper (see
 * useWearableConnections.test.tsx).
 */

import React from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('../api/wearablesSamplesApi', () => ({
  wearablesSamplesApi: {
    getSamples: jest.fn(),
    setPreference: jest.fn(),
    clearPreference: jest.fn(),
  },
}));

import { wearablesSamplesApi } from '../api/wearablesSamplesApi';
import {
  useWearableSamples,
  wearableSamplesQueryKey,
  WEARABLE_SAMPLES_STALE_MS,
  WEARABLE_SAMPLES_GC_MS,
} from './useWearableSamples';

const mockedGet = wearablesSamplesApi.getSamples as jest.MockedFunction<
  typeof wearablesSamplesApi.getSamples
>;

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, Wrapper };
}

const baseParams = {
  bucket: 'HEALTH_FITNESS' as const,
  from: '2026-05-01T00:00:00.000Z',
  to: '2026-05-08T00:00:00.000Z',
};

const okResponse = {
  version: 1 as const,
  user_id: 'u1',
  bucket: 'HEALTH_FITNESS' as const,
  window: { from: baseParams.from, to: baseParams.to },
  series: [],
  freshness: { providers: [] },
};

beforeEach(() => {
  mockedGet.mockReset();
});

describe('useWearableSamples', () => {
  it('resolves to the DTO on the happy path', async () => {
    mockedGet.mockResolvedValueOnce(okResponse);
    const { Wrapper } = makeWrapper();

    const { result } = renderHook(() => useWearableSamples(baseParams), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(okResponse);
    expect(mockedGet).toHaveBeenCalledWith(baseParams);
  });

  it('surfaces isError (does NOT swallow) on a rejected query', async () => {
    mockedGet.mockRejectedValueOnce(new Error('503 degraded'));
    const { Wrapper } = makeWrapper();

    const { result } = renderHook(() => useWearableSamples(baseParams), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('503 degraded');
  });

  it('does not fire the request when enabled:false', async () => {
    const { Wrapper } = makeWrapper();

    renderHook(() => useWearableSamples(baseParams, { enabled: false }), {
      wrapper: Wrapper,
    });

    // give React Query a tick — it must not call the queryFn.
    await new Promise((r) => setTimeout(r, 10));
    expect(mockedGet).not.toHaveBeenCalled();
  });
});

describe('wearableSamplesQueryKey', () => {
  it('normalises omitted optionals to null/defaults', () => {
    expect(wearableSamplesQueryKey(baseParams)).toEqual([
      'wearables',
      'samples',
      {
        bucket: 'HEALTH_FITNESS',
        metric: null,
        from: baseParams.from,
        to: baseParams.to,
        clientId: null,
        granularity: 'raw',
        preferredOnly: true,
      },
    ]);
  });

  it('an omitted granularity and an explicit "raw" produce the SAME key', () => {
    const a = wearableSamplesQueryKey(baseParams);
    const b = wearableSamplesQueryKey({ ...baseParams, granularity: 'raw' });
    expect(a).toEqual(b);
  });

  it('an omitted preferredOnly and an explicit true produce the SAME key', () => {
    const a = wearableSamplesQueryKey(baseParams);
    const b = wearableSamplesQueryKey({ ...baseParams, preferredOnly: true });
    expect(a).toEqual(b);
  });

  it('distinct metrics produce distinct keys', () => {
    const a = wearableSamplesQueryKey({ ...baseParams, metric: 'STEPS' });
    const b = wearableSamplesQueryKey({ ...baseParams, metric: 'HEART_RATE_BPM' });
    expect(a).not.toEqual(b);
  });
});

describe('cache timing constants', () => {
  it('uses a 60s staleTime and 5min gcTime per the CPO note', () => {
    expect(WEARABLE_SAMPLES_STALE_MS).toBe(60_000);
    expect(WEARABLE_SAMPLES_GC_MS).toBe(5 * 60_000);
  });
});
