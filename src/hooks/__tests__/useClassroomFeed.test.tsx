/**
 * useClassroomFeed — hook behaviour tests for the v3-2 read-only classroom feed.
 *
 * Verifies the query posture (mirrors the v3-1 / v2-3 infinite-list harness):
 *   - DISABLED (no fetch) when no workspace id is known (null).
 *   - DISABLED (no fetch) when the `communityClassroom` flag is OFF, even with a
 *     valid workspace id — belt-and-suspenders containment so a flag-off build
 *     never issues a classroom request.
 *   - ENABLED with a workspace id + flag ON: calls listFeed(workspaceId, {
 *     limit }) bounded, with no cursor on page 1.
 *   - Pagination: the first page's next_cursor threads verbatim into page 2 as
 *     the bare cursor param; a null next_cursor stops further fetches.
 *
 * communityClassroomApi is mocked so the tests are deterministic and never
 * touch the network. featureFlags is a mutable holder so flag-off is exercised.
 */
import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ── Feature flags — mutable holder, overridden per test ──────────────────────
const flags = { communityClassroom: true };
jest.mock('../../config/featureFlags', () => ({
  get featureFlags() {
    return flags;
  },
}));

// ── API client mock ──────────────────────────────────────────────────────────
jest.mock('../../api/communityClassroomApi', () => ({
  communityClassroomApi: {
    listFeed: jest.fn(),
    getLesson: jest.fn(),
  },
  CLASSROOM_PAGE_LIMIT: 20,
}));

import { communityClassroomApi } from '../../api/communityClassroomApi';
import type {
  ClassroomPost,
  ClassroomFeedPage,
} from '../../api/communityClassroomApi';
import { useClassroomFeed } from '../useClassroomFeed';

const api = jest.mocked(communityClassroomApi);

const WS = '11111111-1111-4111-8111-111111111111';
const CURSOR_UUID = '99999999-9999-4999-8999-999999999999';

function lesson(overrides: Partial<ClassroomPost> = {}): ClassroomPost {
  return {
    id: 'lesson-1',
    workspace_id: WS,
    cohort_id: null,
    coach_id: '22222222-2222-4222-8222-222222222222',
    title: 'Lesson',
    body_markdown: '',
    status: 'published',
    pinned: false,
    pinned_order: null,
    release_at: null,
    release_locked: false,
    published_at: '2026-03-01T00:00:00.000Z',
    created_at: '2026-03-01T00:00:00.000Z',
    updated_at: '2026-03-01T00:00:00.000Z',
    media: [],
    ...overrides,
  };
}

function page(
  posts: ClassroomPost[],
  next_cursor: string | null = null,
): ClassroomFeedPage {
  return { posts, next_cursor };
}

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, Wrapper };
}

beforeEach(() => {
  flags.communityClassroom = true;
  (api.listFeed as jest.Mock).mockReset();
  api.listFeed.mockResolvedValue(page([]));
});

describe('useClassroomFeed — disabled postures (no network)', () => {
  it('does NOT fetch when no workspace id is known (null)', async () => {
    const { Wrapper } = makeWrapper();
    const { result } = await renderHook(
      () => useClassroomFeed({ workspaceId: null }),
      { wrapper: Wrapper },
    );
    // The query is disabled — no request, and it never enters a loading fetch.
    expect(api.listFeed).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('does NOT fetch when the communityClassroom flag is OFF, even with a workspace id', async () => {
    flags.communityClassroom = false;
    const { Wrapper } = makeWrapper();
    const { result } = await renderHook(
      () => useClassroomFeed({ workspaceId: WS }),
      { wrapper: Wrapper },
    );
    expect(api.listFeed).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useClassroomFeed — enabled fetch + cursor pagination', () => {
  it('calls listFeed with the workspace id and a bounded page limit, no cursor on page 1', async () => {
    api.listFeed.mockResolvedValue(page([lesson({ id: 'lesson-1' })]));
    const { Wrapper } = makeWrapper();
    const { result } = await renderHook(
      () => useClassroomFeed({ workspaceId: WS }),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Bounded — always carries the page limit, never a bare unbounded call.
    expect(api.listFeed).toHaveBeenLastCalledWith(WS, { limit: 20 });
    expect(api.listFeed).not.toHaveBeenCalledWith(WS);
  });

  it('passes a cohort scope through to listFeed when provided', async () => {
    api.listFeed.mockResolvedValue(page([]));
    const { Wrapper } = makeWrapper();
    await renderHook(
      () => useClassroomFeed({ workspaceId: WS, cohortId: 'co-7' }),
      { wrapper: Wrapper },
    );
    await waitFor(() =>
      expect(api.listFeed).toHaveBeenLastCalledWith(WS, {
        limit: 20,
        cohortId: 'co-7',
      }),
    );
  });

  it('threads the first page next_cursor into page 2 as the bare cursor, then stops on null', async () => {
    api.listFeed
      .mockResolvedValueOnce(page([lesson({ id: 'lesson-1' })], CURSOR_UUID))
      .mockResolvedValueOnce(page([lesson({ id: 'lesson-2' })], null));
    const { Wrapper } = makeWrapper();
    const { result } = await renderHook(
      () => useClassroomFeed({ workspaceId: WS }),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Page 1: bounded, no cursor.
    expect(api.listFeed).toHaveBeenNthCalledWith(1, WS, { limit: 20 });
    expect(result.current.hasNextPage).toBe(true);

    await act(async () => {
      await result.current.fetchNextPage();
    });

    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));
    // Page 2: the server cursor is sent verbatim as the bare `cursor` param.
    expect(api.listFeed).toHaveBeenNthCalledWith(2, WS, {
      limit: 20,
      cursor: CURSOR_UUID,
    });
    // next_cursor:null terminates pagination.
    expect(result.current.hasNextPage).toBe(false);
  });
});
