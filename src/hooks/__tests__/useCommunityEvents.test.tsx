/**
 * useCommunityEvents — hook behaviour tests for the v2-3 Community events
 * surface.
 *
 * Verifies:
 *   - useRsvpEvent applies an OPTIMISTIC detail update (sets viewer_rsvp_status,
 *     moves the count) then ROLLS BACK to the prior snapshot on server reject.
 *   - useCreateEvent inserts an OPTIMISTIC provisional event at the top of the
 *     workspace list, then ROLLS BACK on failure.
 *   - isOptimisticEventId recognises provisional ids.
 *
 * communityEventsApi is mocked so the tests are deterministic and never touch
 * the network. Reads are seeded via `setQueryDefaults` with a queryFn so the
 * `onSettled` invalidation has a deterministic server snapshot to reconcile to
 * (mirrors the v1-5 useCommunity optimistic-rollback harness).
 */
import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('../../api/communityEventsApi', () => ({
  communityEventsApi: {
    list: jest.fn(),
    getOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    rsvp: jest.fn(),
    attachReplay: jest.fn(),
    reflect: jest.fn(),
  },
}));

import { communityEventsApi } from '../../api/communityEventsApi';
import type {
  CommunityEvent,
  CommunityEventListResponse,
} from '../../api/communityEventsApi';
import {
  communityEventsKeys,
  useRsvpEvent,
  useCreateEvent,
  isOptimisticEventId,
} from '../useCommunityEvents';

const WS = '11111111-1111-4111-8111-111111111111';
const UID = '22222222-2222-4222-8222-222222222222';
const EV = '33333333-3333-4333-8333-333333333333';

const mockApi = {
  getOne: jest.mocked(communityEventsApi.getOne),
  rsvp: jest.mocked(communityEventsApi.rsvp),
  create: jest.mocked(communityEventsApi.create),
};

function baseEvent(overrides: Partial<CommunityEvent> = {}): CommunityEvent {
  return {
    id: EV,
    workspace_id: WS,
    cohort_id: null,
    created_by_user_id: UID,
    title: 'Live Q&A',
    description: null,
    state: 'scheduled',
    starts_at: '2026-07-01T18:00:00.000Z',
    ends_at: null,
    external_url: null,
    reflected_at: null,
    canceled: false,
    rsvp_counts: { going: 2, maybe: 0, declined: 0, attended: 0, missed: 0 },
    viewer_rsvp_status: null,
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeWrapper() {
  // gcTime: Infinity so a cache entry that loses its observer (after the
  // mutation settles and the rendered hook unmounts) is NOT immediately
  // garbage-collected — the rollback assertions read the post-settle snapshot.
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: 0 },
    },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, Wrapper };
}

beforeEach(() => {
  mockApi.getOne.mockReset();
  mockApi.rsvp.mockReset();
  mockApi.create.mockReset();
});

describe('isOptimisticEventId', () => {
  it('recognises provisional ids and rejects server ids', () => {
    expect(isOptimisticEventId('optimistic:123')).toBe(true);
    expect(isOptimisticEventId(EV)).toBe(false);
  });
});

describe('useRsvpEvent — optimistic detail update + rollback', () => {
  it('optimistically sets viewer status and moves the count before settle', async () => {
    const { qc, Wrapper } = makeWrapper();
    const detailKey = communityEventsKeys.detail(EV);
    // Server snapshot the invalidation refetches: the RSVP already applied.
    const reconciled = baseEvent({
      viewer_rsvp_status: 'going',
      rsvp_counts: { going: 3, maybe: 0, declined: 0, attended: 0, missed: 0 },
    });
    qc.setQueryDefaults(detailKey, { queryFn: async () => reconciled });
    qc.setQueryData<CommunityEvent>(detailKey, baseEvent());

    // Capture the snapshot WHILE the request is in flight (optimistic state).
    let inflight: CommunityEvent | undefined;
    mockApi.rsvp.mockImplementation(async () => {
      inflight = qc.getQueryData<CommunityEvent>(detailKey);
      return {
        event_id: EV,
        user_id: UID,
        status: 'going',
        created_at: '2026-06-02T00:00:00.000Z',
        updated_at: '2026-06-02T00:00:00.000Z',
      };
    });

    const { result } = renderHook(() => useRsvpEvent(EV, WS), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync('going');
    });

    // Optimistic state observed mid-flight: viewer=going, going count bumped.
    expect(inflight?.viewer_rsvp_status).toBe('going');
    expect(inflight?.rsvp_counts.going).toBe(3);
    expect(mockApi.rsvp).toHaveBeenCalledWith(EV, 'going');
  });

  it('rolls back to the prior snapshot when the server rejects', async () => {
    const { qc, Wrapper } = makeWrapper();
    const detailKey = communityEventsKeys.detail(EV);
    const prior = baseEvent();
    // The server snapshot the rollback-invalidation refetches is the prior.
    qc.setQueryDefaults(detailKey, { queryFn: async () => prior });
    qc.setQueryData<CommunityEvent>(detailKey, prior);
    mockApi.rsvp.mockRejectedValueOnce(new Error('boom'));

    const { result } = renderHook(() => useRsvpEvent(EV, WS), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync('maybe').catch(() => undefined);
    });

    await waitFor(() => {
      const cached = qc.getQueryData<CommunityEvent>(detailKey);
      expect(cached?.viewer_rsvp_status).toBeNull();
      expect(cached?.rsvp_counts.maybe).toBe(0);
    });
  });
});

describe('useCreateEvent — optimistic insert + rollback', () => {
  it('inserts a provisional event at the top while in flight', async () => {
    const { qc, Wrapper } = makeWrapper();
    const listKey = communityEventsKeys.list(WS);
    const server: CommunityEventListResponse = {
      events: [baseEvent({ id: 'server-new' })],
      next_before: null,
    };
    qc.setQueryDefaults(listKey, { queryFn: async () => server });
    qc.setQueryData<CommunityEventListResponse>(listKey, {
      events: [],
      next_before: null,
    });

    let inflight: CommunityEventListResponse | undefined;
    mockApi.create.mockImplementation(async () => {
      inflight = qc.getQueryData<CommunityEventListResponse>(listKey);
      return baseEvent({ id: 'server-new' });
    });

    const { result } = renderHook(() => useCreateEvent(WS, UID), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync({
        title: 'Workshop',
        starts_at: '2026-08-01T18:00:00.000Z',
      });
    });

    expect(inflight?.events[0].title).toBe('Workshop');
    expect(isOptimisticEventId(inflight?.events[0].id ?? '')).toBe(true);
    expect(mockApi.create).toHaveBeenCalledWith(
      WS,
      expect.objectContaining({ title: 'Workshop' }),
    );
  });

  it('rolls back to the prior (empty) list when the server rejects', async () => {
    const { qc, Wrapper } = makeWrapper();
    const listKey = communityEventsKeys.list(WS);
    const empty: CommunityEventListResponse = { events: [], next_before: null };
    qc.setQueryDefaults(listKey, { queryFn: async () => empty });
    qc.setQueryData<CommunityEventListResponse>(listKey, empty);
    mockApi.create.mockRejectedValueOnce(new Error('nope'));

    const { result } = renderHook(() => useCreateEvent(WS, UID), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await result.current
        .mutateAsync({ title: 'X', starts_at: '2026-08-01T18:00:00.000Z' })
        .catch(() => undefined);
    });

    await waitFor(() => {
      const cached = qc.getQueryData<CommunityEventListResponse>(listKey);
      expect(cached?.events).toHaveLength(0);
    });
  });
});
