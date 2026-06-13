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
import {
  QueryClient,
  QueryClientProvider,
  type InfiniteData,
} from '@tanstack/react-query';

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
  useCommunityEventsInfiniteList,
  isOptimisticEventId,
} from '../useCommunityEvents';

const WS = '11111111-1111-4111-8111-111111111111';
const UID = '22222222-2222-4222-8222-222222222222';
const EV = '33333333-3333-4333-8333-333333333333';

const mockApi = {
  getOne: jest.mocked(communityEventsApi.getOne),
  rsvp: jest.mocked(communityEventsApi.rsvp),
  create: jest.mocked(communityEventsApi.create),
  list: jest.mocked(communityEventsApi.list),
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
  mockApi.list.mockReset();
});

describe('useCommunityEventsInfiniteList — keyset (before) pagination', () => {
  it('omits the cursor on page 1 and threads next_before into page 2', async () => {
    const { Wrapper } = makeWrapper();
    const page1: CommunityEventListResponse = {
      events: [baseEvent({ id: 'newest' })],
      next_before: '2026-06-01T00:00:00.000Z',
    };
    const page2: CommunityEventListResponse = {
      events: [baseEvent({ id: 'older' })],
      next_before: null,
    };
    mockApi.list
      .mockResolvedValueOnce(page1)
      .mockResolvedValueOnce(page2);

    const { result } = await renderHook(
      () => useCommunityEventsInfiniteList(WS),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Page 1 fetched WITHOUT a cursor.
    expect(mockApi.list).toHaveBeenLastCalledWith(WS, {});
    expect(result.current.hasNextPage).toBe(true);

    await act(async () => {
      await result.current.fetchNextPage();
    });

    await waitFor(() =>
      expect(result.current.data?.pages).toHaveLength(2),
    );
    // Page 2 fetched WITH the server-issued cursor.
    expect(mockApi.list).toHaveBeenLastCalledWith(WS, {
      before: '2026-06-01T00:00:00.000Z',
    });
    expect(result.current.hasNextPage).toBe(false);
  });

  it('is disabled (no fetch) until a workspace id is known', async () => {
    const { Wrapper } = makeWrapper();
    await renderHook(() => useCommunityEventsInfiniteList(undefined), {
      wrapper: Wrapper,
    });
    expect(mockApi.list).not.toHaveBeenCalled();
  });
});

describe('communityEventsKeys.list — request-shaping options', () => {
  it('includes limit so different page sizes do not share a cache entry', () => {
    const a = communityEventsKeys.list(WS, { limit: 20 });
    const b = communityEventsKeys.list(WS, { limit: 50 });
    expect(a).not.toEqual(b);
  });

  it('separates state and cohort filters in the key', () => {
    const a = communityEventsKeys.list(WS, { state: 'live' });
    const b = communityEventsKeys.list(WS, { state: 'replay' });
    const c = communityEventsKeys.list(WS, { cohort_id: 'c-1' });
    expect(a).not.toEqual(b);
    expect(a).not.toEqual(c);
  });
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

    const { result } = await renderHook(() => useRsvpEvent(EV, WS), {
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

    const { result } = await renderHook(() => useRsvpEvent(EV, WS), {
      wrapper: Wrapper,
    });

    // Assert the rejection explicitly (R65 / Failure #36: never swallow a
    // rejected promise with a no-op catch — that hides the thrown error
    // class/message). The mutation must reject with the server error.
    await act(async () => {
      await expect(result.current.mutateAsync('maybe')).rejects.toThrow('boom');
    });

    await waitFor(() => {
      const cached = qc.getQueryData<CommunityEvent>(detailKey);
      expect(cached?.viewer_rsvp_status).toBeNull();
      expect(cached?.rsvp_counts.maybe).toBe(0);
    });
  });
});

describe('useCreateEvent — optimistic insert + rollback', () => {
  it('inserts a provisional event at the top of the first page while in flight', async () => {
    const { qc, Wrapper } = makeWrapper();
    const listKey = communityEventsKeys.list(WS);
    // The list surfaces read through useInfiniteQuery, so the cached shape is
    // InfiniteData<CommunityEventListResponse>.
    qc.setQueryData<InfiniteData<CommunityEventListResponse>>(listKey, {
      pages: [{ events: [], next_before: null }],
      pageParams: [undefined],
    });

    let inflight: InfiniteData<CommunityEventListResponse> | undefined;
    mockApi.create.mockImplementation(async () => {
      inflight =
        qc.getQueryData<InfiniteData<CommunityEventListResponse>>(listKey);
      return baseEvent({ id: 'server-new' });
    });

    const { result } = await renderHook(() => useCreateEvent(WS, UID), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync({
        title: 'Workshop',
        starts_at: '2026-08-01T18:00:00.000Z',
      });
    });

    const firstEvent = inflight?.pages[0].events[0];
    expect(firstEvent?.title).toBe('Workshop');
    expect(isOptimisticEventId(firstEvent?.id ?? '')).toBe(true);
    expect(mockApi.create).toHaveBeenCalledWith(
      WS,
      expect.objectContaining({ title: 'Workshop' }),
    );
  });

  it('rolls back to the prior (empty) list when the server rejects', async () => {
    const { qc, Wrapper } = makeWrapper();
    const listKey = communityEventsKeys.list(WS);
    const empty: InfiniteData<CommunityEventListResponse> = {
      pages: [{ events: [], next_before: null }],
      pageParams: [undefined],
    };
    qc.setQueryData<InfiniteData<CommunityEventListResponse>>(listKey, empty);
    mockApi.create.mockRejectedValueOnce(new Error('nope'));

    const { result } = await renderHook(() => useCreateEvent(WS, UID), {
      wrapper: Wrapper,
    });

    // Assert the rejection explicitly rather than swallowing it (R65 / #36).
    await act(async () => {
      await expect(
        result.current.mutateAsync({
          title: 'X',
          starts_at: '2026-08-01T18:00:00.000Z',
        }),
      ).rejects.toThrow('nope');
    });

    await waitFor(() => {
      const cached =
        qc.getQueryData<InfiniteData<CommunityEventListResponse>>(listKey);
      expect(cached?.pages.flatMap((p) => p.events)).toHaveLength(0);
    });
  });
});
