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
