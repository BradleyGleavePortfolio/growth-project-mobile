/**
 * useWearableConnections — hook surface tests.
 *
 * Mocks the API client at `../api/wearablesConnectionsApi` (fewer moving parts
 * than mocking axios) and exercises:
 *   • happy path — the list query resolves to the DTO array,
 *   • error path — a rejected query surfaces `isError`,
 *   • disconnect mutation invalidates the ['wearable-connections'] cache.
 *
 * Uses the repo's standard React Query test wrapper (see useAIBudget.test.tsx).
 */

import React from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('../api/wearablesConnectionsApi', () => ({
  wearablesConnectionsApi: {
    list: jest.fn(),
    startOauth: jest.fn(),
    disconnect: jest.fn(),
  },
}));

import { wearablesConnectionsApi } from '../api/wearablesConnectionsApi';
import {
  useWearableConnections,
  useDisconnectProvider,
  WEARABLE_CONNECTIONS_QUERY_KEY,
} from './useWearableConnections';

const mockedList = wearablesConnectionsApi.list as jest.MockedFunction<
  typeof wearablesConnectionsApi.list
>;
const mockedDisconnect = wearablesConnectionsApi.disconnect as jest.MockedFunction<
  typeof wearablesConnectionsApi.disconnect
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

const sampleConnection = {
  id: 'c1',
  user_id: 'u1',
  provider: 'OURA' as const,
  external_account_id: null,
  access_token_expires_at: null,
  scopes: [],
  webhook_subscription_id: null,
  channel_expires_at: null,
  status: 'connected',
  last_error: null,
  last_synced_at: '2026-05-31T09:00:00.000Z',
  backfilled_until: null,
  disconnected_at: null,
  created_at: '2026-05-01T00:00:00.000Z',
  updated_at: '2026-05-31T09:00:00.000Z',
};

beforeEach(() => {
  mockedList.mockReset();
  mockedDisconnect.mockReset();
});

describe('useWearableConnections', () => {
  it('resolves to the connection array on the happy path', async () => {
    mockedList.mockResolvedValueOnce([sampleConnection]);

    const { Wrapper } = makeWrapper();
    const { result } = await renderHook(() => useWearableConnections(), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([sampleConnection]);
    expect(mockedList).toHaveBeenCalledTimes(1);
  });

  it('surfaces isError when the query rejects', async () => {
    mockedList.mockRejectedValueOnce(new Error('network down'));

    const { Wrapper } = makeWrapper();
    const { result } = await renderHook(() => useWearableConnections(), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('network down');
  });
});

describe('useDisconnectProvider', () => {
  it('invalidates the connections cache on a successful disconnect', async () => {
    mockedDisconnect.mockResolvedValueOnce({ success: true, provider: 'OURA' });

    const { qc, Wrapper } = makeWrapper();
    const invalidateSpy = jest.spyOn(qc, 'invalidateQueries');

    const { result } = await renderHook(() => useDisconnectProvider(), {
      wrapper: Wrapper,
    });

    await result.current.mutateAsync('OURA');

    expect(mockedDisconnect).toHaveBeenCalledWith('OURA');
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: WEARABLE_CONNECTIONS_QUERY_KEY,
    });
  });

  it('does not invalidate when the disconnect fails', async () => {
    mockedDisconnect.mockRejectedValueOnce(new Error('boom'));

    const { qc, Wrapper } = makeWrapper();
    const invalidateSpy = jest.spyOn(qc, 'invalidateQueries');

    const { result } = await renderHook(() => useDisconnectProvider(), {
      wrapper: Wrapper,
    });

    await expect(result.current.mutateAsync('OURA')).rejects.toThrow('boom');
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
