/**
 * useCoachAckActions — v2-2 coach ack-mutation hook tests.
 *
 * Verifies the optimistic + rollback + reconcile contract against a mocked
 * coachCommunityApi (no network):
 *   - HAPPY PATH: markAcked optimistically raises the per-message ack cache to
 *     `acked` before the request settles, then reconciles to the authoritative
 *     server envelope on success.
 *   - ERROR ROLLBACK: a rejected transition restores the EXACT prior cache
 *     snapshot (including `undefined` when there was none).
 *   - IDEMPOTENCY / MONOTONICITY: marking `seen` on a message already at
 *     `replied` never regresses the displayed state (the optimistic projection
 *     only ever raises the state), matching the backend's monotonic rule.
 *
 * coachCommunityApi is mocked so the tests are deterministic.
 */
import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('../../api/coachCommunityApi', () => {
  const actual = jest.requireActual('../../api/coachCommunityApi');
  return {
    ...actual,
    coachCommunityApi: {
      markCoachAckSeen: jest.fn(),
      markCoachAckAcked: jest.fn(),
      markCoachAckReplied: jest.fn(),
    },
  };
});

import {
  coachCommunityApi,
  CoachCommunityApiError,
  ACK_ILLEGAL_TRANSITION_CODE,
  type AckStateDto,
  type AckTransitionResponse,
} from '../../api/coachCommunityApi';
import { useCoachAckActions } from '../useCoachAckActions';
import { coachCommunityKeys } from '../useCoachCommunity';

const MSG = '11111111-1111-1111-1111-111111111111';

// Typed access to the jest-mocked client — `jest.mocked` infers the mock-fn
// types from the real module surface, so we never need an `as unknown as`
// double-cast (the mock factory above only stubs the three ack transitions).
const mockApi = jest.mocked(coachCommunityApi);

function sla() {
  return {
    sla_state: 'within' as const,
    elapsed_ms: 1_000,
    soft_target_ms: 24 * 60 * 60 * 1000,
    hard_target_ms: 48 * 60 * 60 * 1000,
  };
}

function envelope(over: Partial<AckStateDto> = {}): AckStateDto {
  return {
    state: 'none',
    seen_at: null,
    acked_at: null,
    replied_at: null,
    sla: sla(),
    ...over,
  };
}

function response(ack: AckStateDto): AckTransitionResponse {
  return { message_id: MSG, ack };
}

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, Wrapper };
}

beforeEach(() => {
  mockApi.markCoachAckSeen.mockReset();
  mockApi.markCoachAckAcked.mockReset();
  mockApi.markCoachAckReplied.mockReset();
});

describe('useCoachAckActions — happy path (optimistic then reconcile)', () => {
  it('markAcked raises the cache to acked, then reconciles to the server envelope', async () => {
    const { qc, Wrapper } = makeWrapper();
    const key = coachCommunityKeys.ackState(MSG);

    // A controllable deferred so we can observe the optimistic state BEFORE the
    // request resolves.
    let resolveCall: (v: AckTransitionResponse) => void = () => {};
    mockApi.markCoachAckAcked.mockReturnValue(
      new Promise<AckTransitionResponse>((res) => {
        resolveCall = res;
      }),
    );

    const { result } = renderHook(() => useCoachAckActions(MSG), {
      wrapper: Wrapper,
    });

    act(() => {
      result.current.markAcked.mutate();
    });

    // Optimistic: the cache shows `acked` while the request is in flight.
    await waitFor(() =>
      expect(qc.getQueryData<AckStateDto>(key)?.state).toBe('acked'),
    );
    expect(qc.getQueryData<AckStateDto>(key)?.acked_at).not.toBeNull();

    // Server reconciles with canonical timestamps.
    const server = envelope({
      state: 'acked',
      seen_at: '2026-06-09T12:00:00.000Z',
      acked_at: '2026-06-09T12:05:00.000Z',
    });
    await act(async () => {
      resolveCall(response(server));
    });

    await waitFor(() => expect(result.current.markAcked.isSuccess).toBe(true));
    expect(qc.getQueryData<AckStateDto>(key)).toEqual(server);
    expect(mockApi.markCoachAckAcked).toHaveBeenCalledWith(MSG);
  });
});

describe('useCoachAckActions — error rollback', () => {
  it('restores the exact prior snapshot (a seeded seen state) on failure', async () => {
    const { qc, Wrapper } = makeWrapper();
    const key = coachCommunityKeys.ackState(MSG);

    // Seed a prior `seen` envelope (e.g. primed from the inbox payload).
    const prior = envelope({ state: 'seen', seen_at: '2026-06-09T12:00:00.000Z' });
    qc.setQueryData<AckStateDto>(key, prior);

    mockApi.markCoachAckAcked.mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useCoachAckActions(MSG), {
      wrapper: Wrapper,
    });

    await act(async () => {
      result.current.markAcked.mutate();
    });

    await waitFor(() => expect(result.current.markAcked.isError).toBe(true));
    // Rolled back to the exact prior snapshot — never left in the optimistic
    // `acked` state.
    expect(qc.getQueryData<AckStateDto>(key)).toEqual(prior);
  });

  it('restores undefined (no prior value) on failure', async () => {
    const { qc, Wrapper } = makeWrapper();
    const key = coachCommunityKeys.ackState(MSG);

    mockApi.markCoachAckSeen.mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useCoachAckActions(MSG), {
      wrapper: Wrapper,
    });

    await act(async () => {
      result.current.markSeen.mutate();
    });

    await waitFor(() => expect(result.current.markSeen.isError).toBe(true));
    expect(qc.getQueryData<AckStateDto>(key)).toBeUndefined();
  });
});

describe('useCoachAckActions — 409 illegal_transition reconcile', () => {
  it('a server-rejected transition refetches the ack state + inbox and surfaces isError', async () => {
    const { qc, Wrapper } = makeWrapper();
    const key = coachCommunityKeys.ackState(MSG);

    // Seed a prior `acked` envelope; another device advanced the message, so
    // the backend rejects this transition with 409 illegal_transition.
    const prior = envelope({
      state: 'acked',
      seen_at: '2026-06-09T12:00:00.000Z',
      acked_at: '2026-06-09T12:05:00.000Z',
    });
    qc.setQueryData<AckStateDto>(key, prior);

    const invalidateSpy = jest.spyOn(qc, 'invalidateQueries');

    mockApi.markCoachAckAcked.mockRejectedValue(
      new CoachCommunityApiError(
        'conflict',
        409,
        'coach community request failed (409)',
        undefined,
        ACK_ILLEGAL_TRANSITION_CODE,
      ),
    );

    const { result } = renderHook(() => useCoachAckActions(MSG), {
      wrapper: Wrapper,
    });

    await act(async () => {
      result.current.markAcked.mutate();
    });

    await waitFor(() => expect(result.current.markAcked.isError).toBe(true));

    // The error is the recognised illegal-transition conflict (the row reads
    // this to show its accessible "message state changed — refreshed" notice).
    const err = result.current.markAcked.error;
    expect(err).toBeInstanceOf(CoachCommunityApiError);
    expect((err as CoachCommunityApiError).kind).toBe('conflict');
    expect((err as CoachCommunityApiError).code).toBe(
      ACK_ILLEGAL_TRANSITION_CODE,
    );

    // Reconcile: BOTH the per-message ack state and the inbox page are
    // invalidated so the next read pulls the authoritative state.
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: key }),
      );
    });
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: coachCommunityKeys.inbox() }),
    );

    invalidateSpy.mockRestore();
  });
});

describe('useCoachAckActions — monotonic / idempotent', () => {
  it('marking seen on an already-replied message does not regress the displayed state', async () => {
    const { qc, Wrapper } = makeWrapper();
    const key = coachCommunityKeys.ackState(MSG);

    const replied = envelope({
      state: 'replied',
      seen_at: '2026-06-09T12:00:00.000Z',
      acked_at: '2026-06-09T12:05:00.000Z',
      replied_at: '2026-06-09T12:10:00.000Z',
    });
    qc.setQueryData<AckStateDto>(key, replied);

    // Server is idempotent: returns the existing replied envelope unchanged.
    mockApi.markCoachAckSeen.mockResolvedValue(response(replied));

    const { result } = renderHook(() => useCoachAckActions(MSG), {
      wrapper: Wrapper,
    });

    await act(async () => {
      result.current.markSeen.mutate();
    });

    // Even mid-flight the optimistic projection must NOT lower the state below
    // replied.
    await waitFor(() => expect(result.current.markSeen.isSuccess).toBe(true));
    expect(qc.getQueryData<AckStateDto>(key)?.state).toBe('replied');
    expect(qc.getQueryData<AckStateDto>(key)?.replied_at).toBe(
      '2026-06-09T12:10:00.000Z',
    );
  });

  it('marking acked twice is a stable no-op on the displayed state', async () => {
    const { qc, Wrapper } = makeWrapper();
    const key = coachCommunityKeys.ackState(MSG);

    const acked = envelope({
      state: 'acked',
      seen_at: '2026-06-09T12:00:00.000Z',
      acked_at: '2026-06-09T12:05:00.000Z',
    });
    mockApi.markCoachAckAcked.mockResolvedValue(response(acked));

    const { result } = renderHook(() => useCoachAckActions(MSG), {
      wrapper: Wrapper,
    });

    await act(async () => {
      result.current.markAcked.mutate();
    });
    await waitFor(() => expect(result.current.markAcked.isSuccess).toBe(true));
    expect(qc.getQueryData<AckStateDto>(key)?.state).toBe('acked');

    // Second identical tap: still acked, same timestamp.
    await act(async () => {
      result.current.markAcked.mutate();
    });
    await waitFor(() => expect(mockApi.markCoachAckAcked).toHaveBeenCalledTimes(2));
    expect(qc.getQueryData<AckStateDto>(key)?.state).toBe('acked');
    expect(qc.getQueryData<AckStateDto>(key)?.acked_at).toBe(
      '2026-06-09T12:05:00.000Z',
    );
  });
});
