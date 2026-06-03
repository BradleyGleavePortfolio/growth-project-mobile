/**
 * useWearableInsight — hook surface tests (PR-HK-5a).
 *
 * Mocks the api module (tighter than mocking axios) and verifies:
 *   - useCoachInsight: loading → success, calls fetchCoachInsight once.
 *   - useApproveDraft: the sole `ok` success shape (HK-6a is live) invalidates
 *     the coach insight key; a thrown error (e.g. a 404 from a deploy/route
 *     regression) PROPAGATES to the mutation's error state and does NOT
 *     invalidate — it is never coerced into a fake success.
 */

import React from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('../../api/wearableInsightsApi', () => {
  const actual = jest.requireActual('../../api/wearableInsightsApi');
  return {
    ...actual,
    fetchCoachInsight: jest.fn(),
    fetchClientInsight: jest.fn(),
    approveDraft: jest.fn(),
  };
});

import {
  fetchCoachInsight,
  approveDraft,
  insightQueryKeys,
  type CoachInsight,
  type ApproveResponse,
} from '../../api/wearableInsightsApi';
import { useApproveDraft, useCoachInsight } from '../useWearableInsight';

const mockedFetch = fetchCoachInsight as jest.MockedFunction<typeof fetchCoachInsight>;
const mockedApprove = approveDraft as jest.MockedFunction<typeof approveDraft>;

function coachInsight(): CoachInsight {
  return {
    observation: 'Steps trending down this week',
    hypothesis: 'Possibly a schedule change',
    suggested_action: 'Check in about routine',
    suggested_message_draft: 'Hey — noticed your steps dipped, all good?',
    confidence_level: 'confident',
    source_metrics: ['STEPS'],
  };
}

// Track every QueryClient created in a test so afterEach can tear each one
// down. Without this, the client's internal cache/timers keep the Node event
// loop alive and Jest prints "did not exit one second after the test run"
// (F5) — the CI gate runs without --forceExit, so a hang fails the gate.
const createdClients: QueryClient[] = [];

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      // RQ v5 defaults a mutation's gcTime to 5min; without overriding it the
      // settled mutation schedules a 5-minute setTimeout that outlives the
      // test and keeps Node's event loop alive (the F5 "did not exit" hang).
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
  mockedFetch.mockReset();
  mockedApprove.mockReset();
});

afterEach(() => {
  // Defense-in-depth alongside the zero gcTimes above: drop every cached
  // query/mutation and release the client's focus/online subscriptions so no
  // timer survives the test (F5).
  for (const qc of createdClients) {
    qc.clear();
    qc.unmount();
  }
  createdClients.length = 0;
});

describe('useCoachInsight', () => {
  it('transitions loading → success and returns the insight', async () => {
    mockedFetch.mockResolvedValueOnce(coachInsight());
    const { Wrapper } = makeWrapper();

    const { result } = renderHook(
      () => useCoachInsight({ clientId: 'client-1', bucket: 'HEALTH_FITNESS' }),
      { wrapper: Wrapper },
    );

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(coachInsight());
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(mockedFetch).toHaveBeenCalledWith({
      clientId: 'client-1',
      bucket: 'HEALTH_FITNESS',
    });
  });

  it('does not fire when clientId is empty', async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(
      () => useCoachInsight({ clientId: '', bucket: 'HEALTH_FITNESS' }),
      { wrapper: Wrapper },
    );
    // Disabled query never enters fetching.
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockedFetch).not.toHaveBeenCalled();
  });
});

describe('useApproveDraft', () => {
  it('invalidates the coach insight key on an ok result', async () => {
    const ok: ApproveResponse = {
      status: 'ok',
      draft_id: '11111111-1111-1111-1111-111111111111',
      materialised_at: '2026-05-20T10:00:00Z',
    };
    mockedApprove.mockResolvedValueOnce(ok);
    const { qc, Wrapper } = makeWrapper();
    const invalidateSpy = jest.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useApproveDraft(), { wrapper: Wrapper });

    await result.current.mutateAsync({
      clientId: 'client-7',
      bucket: 'SLEEP_RECOVERY',
      draftBody: 'Hi',
      action: 'approve',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: insightQueryKeys.coach('client-7', 'SLEEP_RECOVERY'),
    });
  });

  it('propagates a thrown error (e.g. 404) to onError and does NOT invalidate', async () => {
    // HK-6a is live: a 404 is now a real failure, not a coerced success. The
    // mutation must reject (caller's onError fires) and never invalidate.
    const boom = new Error('Request failed with status code 404');
    mockedApprove.mockRejectedValueOnce(boom);
    const { qc, Wrapper } = makeWrapper();
    const invalidateSpy = jest.spyOn(qc, 'invalidateQueries');
    const onError = jest.fn();

    const { result } = renderHook(() => useApproveDraft(), { wrapper: Wrapper });

    await expect(
      result.current.mutateAsync(
        {
          clientId: 'client-7',
          bucket: 'SLEEP_RECOVERY',
          draftBody: 'Hi',
          action: 'approve',
        },
        { onError },
      ),
    ).rejects.toThrow('404');

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
