/**
 * useScheduling — hook smoke tests.
 *
 * Mocks `../../api/schedulingApi` and asserts that the hooks call the
 * right method with the right shape, and that mutation success
 * invalidates the right query keys.
 *
 * Three focused cases:
 *   1. useMyUpcomingSessions calls schedulingApi.listMySessions and
 *      returns the response in `data`.
 *   2. useRequestSession invokes schedulingApi.requestSession with the
 *      caller-supplied input.
 *   3. useApproveSession success invalidates the `['scheduling',
 *      'sessions', 'me']` list query key AND the per-session key.
 */

import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useApproveSession,
  useMyUpcomingSessions,
  useRequestSession,
} from '../useScheduling';
import type { CoachingSession } from '../../api/schedulingApi';

// Mock the API module before importing it transitively via the hook.
jest.mock('../../api/schedulingApi', () => ({
  schedulingApi: {
    listMySessions: jest.fn(),
    requestSession: jest.fn(),
    approveSession: jest.fn(),
  },
}));

// Pull the mocked surface back in for assertions.
import { schedulingApi } from '../../api/schedulingApi';
const mockApi = schedulingApi as unknown as {
  listMySessions: jest.Mock;
  requestSession: jest.Mock;
  approveSession: jest.Mock;
};

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  // Tests assert on qc.getQueryState — return it so the assertion path
  // can check `isInvalidated` after a mutation success.
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
  return { qc, wrapper };
}

const FAKE_SESSION: CoachingSession = {
  id: 'sess-1',
  coach_id: 'coach-1',
  client_id: 'client-1',
  session_type_id: null,
  status: 'scheduled',
  start_at: '2026-05-12T15:00:00.000Z',
  end_at: '2026-05-12T15:30:00.000Z',
  title: 'Weekly check-in',
  coach_notes_md: null,
  client_recap_md: null,
  video_provider: 'manual',
  video_url: null,
  video_meeting_id: null,
  calendar_provider: 'stub',
  calendar_event_id: null,
  approved_at: '2026-05-11T18:00:00.000Z',
  ended_at: null,
  end_reason: null,
  created_at: '2026-05-11T17:30:00.000Z',
  updated_at: '2026-05-11T18:00:00.000Z',
};

describe('useScheduling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('useMyUpcomingSessions returns the list from listMySessions', async () => {
    mockApi.listMySessions.mockResolvedValueOnce([FAKE_SESSION]);
    const { wrapper } = makeWrapper();
    const { result } = await renderHook(() => useMyUpcomingSessions(10), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApi.listMySessions).toHaveBeenCalledWith(10);
    expect(result.current.data).toEqual([FAKE_SESSION]);
  });

  it('useRequestSession forwards the input to schedulingApi.requestSession', async () => {
    mockApi.requestSession.mockResolvedValueOnce({
      ...FAKE_SESSION,
      status: 'requested',
    });
    const { wrapper } = makeWrapper();
    const { result } = await renderHook(() => useRequestSession(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        coach_id: 'coach-1',
        title: 'Weekly check-in',
        start_at: '2026-05-12T15:00:00.000Z',
        end_at: '2026-05-12T15:30:00.000Z',
      });
    });

    expect(mockApi.requestSession).toHaveBeenCalledTimes(1);
    expect(mockApi.requestSession.mock.calls[0][0]).toMatchObject({
      coach_id: 'coach-1',
      title: 'Weekly check-in',
    });
  });

  it('useApproveSession success invalidates the "me" list AND the per-id query', async () => {
    mockApi.approveSession.mockResolvedValueOnce(FAKE_SESSION);
    const { qc, wrapper } = makeWrapper();

    // Seed both caches so we can observe invalidation.
    qc.setQueryData(['scheduling', 'sessions', 'me', { limit: 25 }], []);
    qc.setQueryData(['scheduling', 'sessions', FAKE_SESSION.id], FAKE_SESSION);

    const { result } = await renderHook(() => useApproveSession(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ id: FAKE_SESSION.id });
    });

    // After invalidate, both query states should be marked stale/invalidated.
    const meState = qc.getQueryState([
      'scheduling',
      'sessions',
      'me',
      { limit: 25 },
    ]);
    const idState = qc.getQueryState([
      'scheduling',
      'sessions',
      FAKE_SESSION.id,
    ]);
    expect(meState?.isInvalidated).toBe(true);
    expect(idState?.isInvalidated).toBe(true);
    expect(mockApi.approveSession).toHaveBeenCalledWith(FAKE_SESSION.id);
  });
});
