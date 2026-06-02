/**
 * useWearablePreference — optimistic-update + rollback tests.
 *
 * Mocks the API client at `../api/wearablesSamplesApi` and verifies the
 * full optimistic contract:
 *   • onMutate optimistically writes the new preferred provider into the
 *     per-metric preference cache BEFORE the request resolves,
 *   • onSuccess settles on the server-confirmed provider and invalidates the
 *     samples subtree,
 *   • onError rolls the preference cache back to its prior value and surfaces
 *     `isError` (so the screen's actionable toast can fire — #36 no silent
 *     failures).
 */

import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
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
  useWearablePreference,
  wearablePreferenceQueryKey,
} from './useWearablePreference';
import { WEARABLE_SAMPLES_ROOT_KEY } from './useWearableSamples';

const mockedSet = wearablesSamplesApi.setPreference as jest.MockedFunction<
  typeof wearablesSamplesApi.setPreference
>;
const mockedClearFn = wearablesSamplesApi.clearPreference as jest.MockedFunction<
  typeof wearablesSamplesApi.clearPreference
>;

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      // gcTime must be non-zero here: we read the per-metric preference cache
      // entry directly via getQueryData and it has no React Query observer, so
      // a gcTime of 0 would garbage-collect it the instant it's written and
      // the assertions below would race against the sweep.
      queries: { retry: false, gcTime: 60_000, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, Wrapper };
}

beforeEach(() => {
  mockedSet.mockReset();
  mockedClearFn.mockReset();
});

describe('useWearablePreference', () => {
  it('optimistically writes the new provider, then settles on the server value', async () => {
    mockedSet.mockResolvedValueOnce({
      metric: 'STEPS',
      preferred_provider: 'WHOOP',
      updated_at: '2026-05-08T06:00:00.000Z',
    });
    const { qc, Wrapper } = makeWrapper();
    // seed a prior preference
    qc.setQueryData(wearablePreferenceQueryKey('STEPS'), 'OURA');

    const { result } = renderHook(() => useWearablePreference(), {
      wrapper: Wrapper,
    });

    act(() => {
      result.current.mutate({ metric: 'STEPS', preferredProvider: 'WHOOP' });
    });

    // Optimistic write is visible synchronously after mutate kicks onMutate.
    await waitFor(() =>
      expect(qc.getQueryData(wearablePreferenceQueryKey('STEPS'))).toBe('WHOOP'),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(qc.getQueryData(wearablePreferenceQueryKey('STEPS'))).toBe('WHOOP');
  });

  it('rolls back to the prior value and surfaces isError on failure', async () => {
    mockedSet.mockRejectedValueOnce(new Error('network'));
    const { qc, Wrapper } = makeWrapper();
    qc.setQueryData(wearablePreferenceQueryKey('STEPS'), 'OURA');

    const { result } = renderHook(() => useWearablePreference(), {
      wrapper: Wrapper,
    });

    act(() => {
      result.current.mutate({ metric: 'STEPS', preferredProvider: 'WHOOP' });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    // Rolled back to the snapshot — the chip never lies.
    expect(qc.getQueryData(wearablePreferenceQueryKey('STEPS'))).toBe('OURA');
    expect(result.current.error?.message).toBe('network');
  });

  it('invalidates the samples subtree on settle', async () => {
    mockedSet.mockResolvedValueOnce({
      metric: 'STEPS',
      preferred_provider: 'WHOOP',
      updated_at: '2026-05-08T06:00:00.000Z',
    });
    const { qc, Wrapper } = makeWrapper();
    const invalidateSpy = jest.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useWearablePreference(), {
      wrapper: Wrapper,
    });

    act(() => {
      result.current.mutate({ metric: 'STEPS', preferredProvider: 'WHOOP' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: WEARABLE_SAMPLES_ROOT_KEY,
    });
  });

  it('rollback clears the optimistic write when there was no prior value', async () => {
    mockedSet.mockRejectedValueOnce(new Error('boom'));
    const { qc, Wrapper } = makeWrapper();
    // no seed — prior value is undefined

    const { result } = renderHook(() => useWearablePreference(), {
      wrapper: Wrapper,
    });

    act(() => {
      result.current.mutate({ metric: 'STEPS', preferredProvider: 'WHOOP' });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(qc.getQueryData(wearablePreferenceQueryKey('STEPS'))).toBeUndefined();
  });
});

describe('useWearablePreference({ metric }) — HK-3b contract overload (R1 P0 #5)', () => {
  it('returns { data, mutate, isPending } and mutate(provider) writes the metric', async () => {
    mockedSet.mockResolvedValueOnce({
      metric: 'STEPS',
      preferred_provider: 'WHOOP',
      updated_at: '2026-05-08T06:00:00.000Z',
    });
    const { qc, Wrapper } = makeWrapper();

    const { result } = renderHook(
      () => useWearablePreference({ metric: 'STEPS' }),
      { wrapper: Wrapper },
    );

    // Bound surface: data + isPending + a single-arg mutate.
    expect(result.current).toHaveProperty('data');
    expect(result.current).toHaveProperty('isPending');
    expect(typeof result.current.mutate).toBe('function');

    act(() => {
      // The metric is bound, so the simpler surface is mutate(preferredProvider).
      result.current.mutate('WHOOP');
    });

    // Optimistic write lands in the per-metric preference cache.
    await waitFor(() =>
      expect(qc.getQueryData(wearablePreferenceQueryKey('STEPS'))).toBe('WHOOP'),
    );
    expect(mockedSet).toHaveBeenCalledWith('STEPS', 'WHOOP');
  });

  it('reads the optimistic provider back through `data`', async () => {
    const { qc, Wrapper } = makeWrapper();
    qc.setQueryData(wearablePreferenceQueryKey('STEPS'), 'OURA');

    const { result } = renderHook(
      () => useWearablePreference({ metric: 'STEPS' }),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.data).toBe('OURA'));
  });

  it('mutate(null) clears the preference via the clear endpoint', async () => {
    const mockedClear = wearablesSamplesApi.clearPreference as jest.MockedFunction<
      typeof wearablesSamplesApi.clearPreference
    >;
    mockedClear.mockResolvedValueOnce();
    const { Wrapper } = makeWrapper();

    const { result } = renderHook(
      () => useWearablePreference({ metric: 'STEPS' }),
      { wrapper: Wrapper },
    );

    act(() => {
      result.current.mutate(null);
    });

    await waitFor(() => expect(mockedClear).toHaveBeenCalledWith('STEPS'));
  });

  it('clear routes through React Query: drops the preference, invalidates samples, exposes isPending', async () => {
    const mockedClear = wearablesSamplesApi.clearPreference as jest.MockedFunction<
      typeof wearablesSamplesApi.clearPreference
    >;
    // Hold the DELETE open so we can assert isPending is true mid-flight.
    let resolveClear!: () => void;
    mockedClear.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveClear = resolve;
      }),
    );
    const { qc, Wrapper } = makeWrapper();
    // Seed an active preference so we can prove the clear drops it.
    qc.setQueryData(wearablePreferenceQueryKey('STEPS'), 'OURA');
    const invalidateSpy = jest.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(
      () => useWearablePreference({ metric: 'STEPS' }),
      { wrapper: Wrapper },
    );

    act(() => {
      result.current.mutate(null);
    });

    // The clear is a tracked mutation — isPending flips true while in flight.
    await waitFor(() => expect(result.current.isPending).toBe(true));

    act(() => {
      resolveClear();
    });

    // On success: per-metric preference cache is dropped to null …
    await waitFor(() =>
      expect(qc.getQueryData(wearablePreferenceQueryKey('STEPS'))).toBeNull(),
    );
    // … the samples subtree is invalidated so reads fall back to recency …
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: WEARABLE_SAMPLES_ROOT_KEY,
    });
    // … and isPending settles back to false.
    await waitFor(() => expect(result.current.isPending).toBe(false));
  });

  it('clear surfaces errors via opts.onError so the caller is notified', async () => {
    const mockedClear = wearablesSamplesApi.clearPreference as jest.MockedFunction<
      typeof wearablesSamplesApi.clearPreference
    >;
    const boom = new Error('clear failed');
    mockedClear.mockRejectedValueOnce(boom);
    const { qc, Wrapper } = makeWrapper();
    qc.setQueryData(wearablePreferenceQueryKey('STEPS'), 'OURA');
    const onError = jest.fn();

    const { result } = renderHook(
      () => useWearablePreference({ metric: 'STEPS' }),
      { wrapper: Wrapper },
    );

    act(() => {
      result.current.mutate(null, { onError });
    });

    // The failure is observable — the caller's onError fires (actionable toast).
    await waitFor(() => expect(onError).toHaveBeenCalledWith(boom));
    // The optimistic active preference is preserved on a failed clear.
    expect(qc.getQueryData(wearablePreferenceQueryKey('STEPS'))).toBe('OURA');
  });

  it('clear with a caller onError still reflects isError and error on the bound return', async () => {
    const mockedClear = wearablesSamplesApi.clearPreference as jest.MockedFunction<
      typeof wearablesSamplesApi.clearPreference
    >;
    const boom = new Error('clear rejected');
    mockedClear.mockRejectedValueOnce(boom);
    const { qc, Wrapper } = makeWrapper();
    qc.setQueryData(wearablePreferenceQueryKey('STEPS'), 'OURA');
    const onError = jest.fn();

    const { result } = renderHook(
      () => useWearablePreference({ metric: 'STEPS' }),
      { wrapper: Wrapper },
    );

    act(() => {
      result.current.mutate(null, { onError });
    });

    // The caller's onError runs ADDITIVELY — exactly once, with the error …
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onError).toHaveBeenCalledWith(boom);
    // … AND passing opts.onError does NOT consume the observable error state:
    // the bound return reflects the failed clear (R65 #36).
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBe(boom);
    expect(result.current.error?.message).toBe('clear rejected');
  });
});
