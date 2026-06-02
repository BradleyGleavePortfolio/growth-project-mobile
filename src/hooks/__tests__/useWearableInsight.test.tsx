/**
 * useWearableInsight — hook surface tests (PR-HK-5a).
 *
 * Mocks the api module (tighter than mocking axios) and verifies:
 *   - useCoachInsight: loading → success, calls fetchCoachInsight once.
 *   - useApproveDraft: an `ok` result invalidates the coach insight key; a
 *     `not_implemented` result does NOT invalidate (nothing new to read).
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

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, Wrapper };
}

beforeEach(() => {
  mockedFetch.mockReset();
  mockedApprove.mockReset();
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

  it('does NOT invalidate on a not_implemented result', async () => {
    const pending: ApproveResponse = {
      status: 'not_implemented',
      message: 'Approval is rolling out — try again later.',
    };
    mockedApprove.mockResolvedValueOnce(pending);
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
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
