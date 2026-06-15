/**
 * useRegimes — TanStack Query v5 hook tests (F2 named-regimes surface).
 *
 * Mocks the api module (`regimesApi` / `refundDecisionsApi`) rather than axios
 * so the assertions pin the hook contract, not transport. Covers:
 *   - useRegimes: loading → success, returns the unwrapped `.data` array.
 *   - useRegime(id): disabled when id is empty (never fetches).
 *   - useUpdateRegime: success invalidates the list + that regime's revisions.
 *   - useArchiveRegime: success invalidates the list.
 *   - useDecideRefund: success returns the result + invalidates pending; an
 *     error PROPAGATES (never coerced to a fake success) and does NOT invalidate.
 *   - usePushRegimeToExisting: a 404 (F1 endpoint not yet merged) propagates to
 *     the mutation's error state rather than being swallowed.
 *
 * Mirrors the QueryClient teardown harness in useWearableInsight.test.tsx (zero
 * gcTimes + afterEach clear/unmount) so no timer outlives a test (the CI gate
 * runs without --forceExit).
 */
import React from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('../../services/api', () => ({
  regimesApi: {
    list: jest.fn(),
    getRevisions: jest.fn(),
    promoteFromProgram: jest.fn(),
    update: jest.fn(),
    archive: jest.fn(),
    pushToExisting: jest.fn(),
  },
  refundDecisionsApi: {
    listPending: jest.fn(),
    decide: jest.fn(),
  },
}));

import { regimesApi, refundDecisionsApi } from '../../services/api';
import {
  useRegimes,
  useRegime,
  useUpdateRegime,
  useArchiveRegime,
  useDecideRefund,
  usePushRegimeToExisting,
} from '../useRegimes';
import type {
  RegimeListItem,
  RegimeRevisionItem,
  DecideRefundResult,
} from '../../types/regimes';

const mockList = regimesApi.list as jest.Mock;
const mockGetRevisions = regimesApi.getRevisions as jest.Mock;
const mockUpdate = regimesApi.update as jest.Mock;
const mockArchive = regimesApi.archive as jest.Mock;
const mockPush = regimesApi.pushToExisting as jest.Mock;
const mockDecide = refundDecisionsApi.decide as jest.Mock;

function regime(overrides: Partial<RegimeListItem> = {}): RegimeListItem {
  return {
    id: 'reg-1',
    name: 'Hypertrophy Block',
    regime_display_name: 'Off-Season Mass',
    weeks: 8,
    days_per_week: 4,
    head_revision_id: 'rev-9',
    archived_at: null,
    package_attachments_count: 2,
    ...overrides,
  };
}

const createdClients: QueryClient[] = [];

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { gcTime: 0 },
    },
  });
  createdClients.push(qc);
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, Wrapper };
}

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  for (const qc of createdClients) {
    qc.clear();
    qc.unmount();
  }
  createdClients.length = 0;
});

describe('useRegimes', () => {
  it('transitions loading → success and unwraps the list payload', async () => {
    mockList.mockResolvedValueOnce({ data: [regime()] });
    const { Wrapper } = makeWrapper();

    const { result } = await renderHook(() => useRegimes(), { wrapper: Wrapper });

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([regime()]);
    expect(mockList).toHaveBeenCalledTimes(1);
  });
});

describe('useRegime', () => {
  it('does not fetch revisions when the id is empty', async () => {
    const { Wrapper } = makeWrapper();
    const { result } = await renderHook(() => useRegime(''), { wrapper: Wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockGetRevisions).not.toHaveBeenCalled();
  });

  it('fetches revisions for a real id and unwraps the payload', async () => {
    const revisions: RegimeRevisionItem[] = [
      { revision_index: 3, created_at: '2026-06-10T00:00:00.000Z', cause: 'edit' },
    ];
    mockGetRevisions.mockResolvedValueOnce({ data: revisions });
    const { Wrapper } = makeWrapper();

    const { result } = await renderHook(() => useRegime('reg-1'), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.data?.length).toBe(1));
    expect(result.current.data?.[0].revision_index).toBe(3);
    expect(mockGetRevisions).toHaveBeenCalledWith('reg-1');
  });
});

describe('useUpdateRegime', () => {
  it('invalidates the list and that regime\u2019s revisions on success', async () => {
    mockUpdate.mockResolvedValueOnce({ data: regime({ regime_display_name: 'New Name' }) });
    const { qc, Wrapper } = makeWrapper();
    const invalidateSpy = jest.spyOn(qc, 'invalidateQueries');

    const { result } = await renderHook(() => useUpdateRegime(), { wrapper: Wrapper });
    result.current.mutate({ id: 'reg-1', regime_display_name: 'New Name' });

    await waitFor(() => expect(result.current.data?.id).toBe('reg-1'));
    expect(mockUpdate).toHaveBeenCalledWith('reg-1', { regime_display_name: 'New Name' });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['regimes'] });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['regimes', 'reg-1', 'revisions'],
    });
  });
});

describe('useArchiveRegime', () => {
  it('invalidates the regime list on success', async () => {
    mockArchive.mockResolvedValueOnce({
      data: { id: 'reg-1', archived_at: '2026-06-14T00:00:00.000Z' },
    });
    const { qc, Wrapper } = makeWrapper();
    const invalidateSpy = jest.spyOn(qc, 'invalidateQueries');

    const { result } = await renderHook(() => useArchiveRegime(), { wrapper: Wrapper });
    result.current.mutate('reg-1');

    await waitFor(() => expect(result.current.data?.id).toBe('reg-1'));
    expect(mockArchive).toHaveBeenCalledWith('reg-1');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['regimes'] });
  });
});

describe('useDecideRefund', () => {
  it('returns the decision result and invalidates the pending list on success', async () => {
    const out: DecideRefundResult = {
      id: 'dec-1',
      decision: 'unassign_drops',
      drops_canceled: 3,
    };
    mockDecide.mockResolvedValueOnce({ data: out });
    const { qc, Wrapper } = makeWrapper();
    const invalidateSpy = jest.spyOn(qc, 'invalidateQueries');

    const { result } = await renderHook(() => useDecideRefund(), { wrapper: Wrapper });
    result.current.mutate({ refundId: 're_1', decision: 'unassign_drops' });

    await waitFor(() => expect(result.current.data?.id).toBe('dec-1'));
    expect(result.current.data?.drops_canceled).toBe(3);
    expect(mockDecide).toHaveBeenCalledWith('re_1', { decision: 'unassign_drops' });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['refund-decisions', 'pending'],
    });
  });

  it('propagates an error and does NOT invalidate (never a coerced success)', async () => {
    mockDecide.mockRejectedValueOnce(new Error('Request failed with status code 409'));
    const { qc, Wrapper } = makeWrapper();
    const invalidateSpy = jest.spyOn(qc, 'invalidateQueries');

    const { result } = await renderHook(() => useDecideRefund(), { wrapper: Wrapper });
    result.current.mutate({ refundId: 're_1', decision: 'keep_drops' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});

describe('usePushRegimeToExisting', () => {
  it('propagates a 404 from F1\u2019s not-yet-merged endpoint to the error state', async () => {
    mockPush.mockRejectedValueOnce(new Error('Request failed with status code 404'));
    const { Wrapper } = makeWrapper();

    const { result } = await renderHook(() => usePushRegimeToExisting(), {
      wrapper: Wrapper,
    });
    result.current.mutate({ packageId: 'pkg-1', contentId: 'rev-9' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
    expect((result.current.error as Error).message).toContain('404');
  });

  it('returns the push result on success', async () => {
    mockPush.mockResolvedValueOnce({ data: { drops_updated: 5, buyers_affected: 2 } });
    const { Wrapper } = makeWrapper();

    const { result } = await renderHook(() => usePushRegimeToExisting(), {
      wrapper: Wrapper,
    });
    result.current.mutate({ packageId: 'pkg-1', contentId: 'rev-9' });

    await waitFor(() => expect(result.current.data?.buyers_affected).toBe(2));
    expect(result.current.data?.drops_updated).toBe(5);
  });
});
