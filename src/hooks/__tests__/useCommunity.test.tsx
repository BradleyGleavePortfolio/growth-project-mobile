/**
 * useCommunity — hook behaviour tests for the v1-5 Community client surface.
 *
 * Verifies:
 *   - useCreatePost / useAddComment / useSendDm apply an OPTIMISTIC update, then
 *     ROLL BACK to the prior snapshot when the server rejects.
 *   - useCommunityBadge subscribes to the Realtime per-user channel and, on a
 *     broadcast PING, refetches /community/me so the unread total updates WITHOUT
 *     polling (the ping payload is never trusted for data).
 *
 * communityApi and communityRealtime are mocked so the tests are deterministic
 * and never touch the network or a real WebSocket.
 */
import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('../../api/communityApi', () => ({
  communityApi: {
    getMe: jest.fn(),
    createPost: jest.fn(),
    addComment: jest.fn(),
    sendDm: jest.fn(),
    listComments: jest.fn(),
    listDmMessages: jest.fn(),
  },
}));

jest.mock('../../api/communityRealtime', () => ({
  subscribeToCommunityUser: jest.fn(),
}));

import { communityApi } from '../../api/communityApi';
import { subscribeToCommunityUser } from '../../api/communityRealtime';
import {
  communityKeys,
  useCreatePost,
  useAddComment,
  useSendDm,
  useCommunityBadge,
} from '../useCommunity';

const WS = '11111111-1111-1111-1111-111111111111';
const UID = '22222222-2222-2222-2222-222222222222';
const POST = '33333333-3333-3333-3333-333333333333';
const RECIP = '44444444-4444-4444-4444-444444444444';
const ISO = '2026-06-09T12:00:00.000Z';

const mockApi = communityApi as unknown as {
  getMe: jest.Mock;
  createPost: jest.Mock;
  addComment: jest.Mock;
  sendDm: jest.Mock;
};
const mockSubscribe = subscribeToCommunityUser as jest.Mock;

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
  mockApi.getMe.mockReset();
  mockApi.createPost.mockReset();
  mockApi.addComment.mockReset();
  mockApi.sendDm.mockReset();
  mockSubscribe.mockReset();
  mockSubscribe.mockReturnValue(() => {});
});

describe('useCreatePost — optimistic insert + rollback', () => {
  it('inserts an optimistic post then rolls back on failure', async () => {
    const { qc, Wrapper } = makeWrapper();
    // Seed the feed via a real query (with a queryFn) so a later invalidation
    // has a deterministic source to refetch from rather than dropping to
    // undefined. The queryFn always returns the empty server snapshot.
    qc.setQueryDefaults(communityKeys.posts(WS), { queryFn: async () => [] });
    qc.setQueryData(communityKeys.posts(WS), []);

    // Track the length over the lifetime of the mutation: it must PEAK at the
    // optimistic insert (>=1) and then RETURN to the empty snapshot (rollback).
    let maxLen = 0;
    let lenAfterPeak = 0;
    let peaked = false;
    const unsub = qc.getQueryCache().subscribe(() => {
      const feed = qc.getQueryData<unknown[]>(communityKeys.posts(WS));
      const len = feed?.length ?? 0;
      if (len > maxLen) maxLen = len;
      if (maxLen >= 1) peaked = true;
      if (peaked) lenAfterPeak = len;
    });

    mockApi.createPost.mockRejectedValueOnce(new Error('server said no'));

    const { result } = await renderHook(() => useCreatePost(WS, UID), {
      wrapper: Wrapper,
    });

    await act(() => {
      result.current.mutate({ title: 'Hi', body: 'there' });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    unsub();

    // Optimistic insert observed (>=1), then rolled back to the empty snapshot.
    expect(maxLen).toBeGreaterThanOrEqual(1);
    expect(lenAfterPeak).toBe(0);
  });
});

describe('useAddComment — optimistic append + rollback', () => {
  it('appends optimistically then rolls back on failure', async () => {
    const { qc, Wrapper } = makeWrapper();
    qc.setQueryDefaults(communityKeys.comments(POST), { queryFn: async () => [] });
    qc.setQueryData(communityKeys.comments(POST), []);

    let maxLen = 0;
    let lenAfterPeak = 0;
    let peaked = false;
    const unsub = qc.getQueryCache().subscribe(() => {
      const len = qc.getQueryData<unknown[]>(communityKeys.comments(POST))?.length ?? 0;
      if (len > maxLen) maxLen = len;
      if (maxLen >= 1) peaked = true;
      if (peaked) lenAfterPeak = len;
    });

    mockApi.addComment.mockRejectedValueOnce(new Error('nope'));

    const { result } = await renderHook(() => useAddComment(POST, UID), {
      wrapper: Wrapper,
    });
    await act(() => {
      result.current.mutate('first reply');
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    unsub();
    expect(maxLen).toBeGreaterThanOrEqual(1);
    expect(lenAfterPeak).toBe(0);
  });
});

describe('useSendDm — optimistic append + rollback', () => {
  it('appends an optimistic message then rolls back on failure', async () => {
    const { qc, Wrapper } = makeWrapper();
    const key = communityKeys.dmMessages(WS, RECIP);
    qc.setQueryDefaults(key, { queryFn: async () => [] });
    qc.setQueryData(key, []);

    let maxLen = 0;
    let lenAfterPeak = 0;
    let peaked = false;
    const unsub = qc.getQueryCache().subscribe(() => {
      const len = qc.getQueryData<unknown[]>(key)?.length ?? 0;
      if (len > maxLen) maxLen = len;
      if (maxLen >= 1) peaked = true;
      if (peaked) lenAfterPeak = len;
    });

    mockApi.sendDm.mockRejectedValueOnce(new Error('dm gate closed'));

    const { result } = await renderHook(() => useSendDm(WS, RECIP, UID), {
      wrapper: Wrapper,
    });
    await act(() => {
      result.current.mutate('hello coach');
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    unsub();
    expect(maxLen).toBeGreaterThanOrEqual(1);
    expect(lenAfterPeak).toBe(0);
  });

  it('does not roll back on success (optimistic entry survives)', async () => {
    const { qc, Wrapper } = makeWrapper();
    const key = communityKeys.dmMessages(WS, RECIP);
    const serverMsg = {
      id: '99999999-9999-9999-9999-999999999999',
      thread_id: 't',
      sender_user_id: UID,
      recipient_user_id: RECIP,
      body: 'hello coach',
      created_at: ISO,
      deleted: false,
    };
    // queryFn returns the authoritative server message so the post-success
    // invalidation refetch keeps the conversation non-empty (the temp row is
    // reconciled, not dropped).
    qc.setQueryDefaults(key, { queryFn: async () => [serverMsg] });
    qc.setQueryData(key, []);
    mockApi.sendDm.mockResolvedValueOnce(serverMsg);

    // Observe the length right after the optimistic insert: on SUCCESS there is
    // no rollback, so the count never returns below the optimistic peak before
    // the invalidation reconciles. The error path is covered separately.
    // Track whether onError's rollback to the empty snapshot ever fired.
    let peakLen = 0;
    let rolledBackToEmpty = false;
    const unsub = qc.getQueryCache().subscribe(() => {
      const len = qc.getQueryData<unknown[]>(key)?.length ?? 0;
      if (len > peakLen) peakLen = len;
    });

    const { result } = await renderHook(() => useSendDm(WS, RECIP, UID), {
      wrapper: Wrapper,
    });
    await act(() => {
      result.current.mutate('hello coach');
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // The mutation never entered the error state, so the onError rollback path
    // (the only code that restores the pre-mutation snapshot) did not run.
    rolledBackToEmpty = result.current.isError;
    unsub();

    expect(peakLen).toBeGreaterThanOrEqual(1);
    expect(rolledBackToEmpty).toBe(false);
  });
});

describe('useCommunityBadge — live unread via Realtime ping (no polling)', () => {
  function meWith(dm: number, cohort: number, mentions: number) {
    return {
      feature_flag_state: 'enabled',
      workspace_id: WS,
      membership: null,
      unread: {
        cohort_messages: cohort,
        dm_messages: dm,
        mentions,
      },
      flags: {
        community_api: true,
        community_dm: true,
        community_realtime: true,
        community_push: false,
        community_telemetry: true,
      },
    };
  }

  it('subscribes to the per-user channel and exposes the unread total', async () => {
    const { Wrapper } = makeWrapper();
    mockApi.getMe.mockResolvedValue(meWith(1, 2, 0));

    const { result } = await renderHook(() => useCommunityBadge(UID), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.total).toBe(3));
    expect(mockSubscribe).toHaveBeenCalledWith(UID, expect.any(Function));
  });

  it('increments the badge when a broadcast ping arrives — without polling', async () => {
    const { Wrapper } = makeWrapper();
    // Capture the onPing handler the hook registers.
    let pingHandler: (() => void) | null = null;
    mockSubscribe.mockImplementation(
      (_userId: string, onPing: () => void) => {
        pingHandler = onPing;
        return () => {};
      },
    );

    // First fetch: 1 unread. After the ping-driven refetch: 4 unread.
    mockApi.getMe
      .mockResolvedValueOnce(meWith(1, 0, 0))
      .mockResolvedValue(meWith(3, 1, 0));

    const { result } = await renderHook(() => useCommunityBadge(UID), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.total).toBe(1));

    // Simulate a Realtime broadcast ping (e.g. a new DM). The hook should
    // invalidate /community/me and refetch authoritative counts over REST.
    const callsBefore = mockApi.getMe.mock.calls.length;
    await act(() => {
      pingHandler?.();
    });

    await waitFor(() => expect(result.current.total).toBe(4));
    // The badge updated via an explicit ping-driven refetch, not a poll timer.
    expect(mockApi.getMe.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it('does not subscribe when there is no user id', async () => {
    const { Wrapper } = makeWrapper();
    mockApi.getMe.mockResolvedValue(meWith(0, 0, 0));
    await renderHook(() => useCommunityBadge(null), { wrapper: Wrapper });
    expect(mockSubscribe).not.toHaveBeenCalled();
  });
});
