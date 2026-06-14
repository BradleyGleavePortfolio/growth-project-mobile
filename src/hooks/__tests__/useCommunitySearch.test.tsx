/**
 * useCommunitySearch — hook behaviour tests for the v3-4 community search query.
 *
 * Verifies the query posture (mirrors the v3-2 classroom-feed harness):
 *   - DISABLED (no fetch) when no workspace id is known.
 *   - DISABLED (no fetch) when the term is empty or whitespace-only — the
 *     surface must never issue an unbounded "match everything" request.
 *   - ENABLED with a workspace id + non-empty term: calls search(workspaceId,
 *     { q }) with the TRIMMED term and no cursor on page 1.
 *   - Pagination: a page's nextCursor threads into page 2 as the `cursor`
 *     param; a null nextCursor stops further fetches.
 *
 * communitySearchApi is mocked so the tests are deterministic and never touch
 * the network.
 */
import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('../../api/communitySearchApi', () => ({
  communitySearchApi: { search: jest.fn() },
  SEARCH_PAGE_LIMIT: 20,
}));

import { communitySearchApi } from '../../api/communitySearchApi';
import type {
  SearchResponse,
  SearchResultRow,
} from '../../api/communitySearchApi';
import { useCommunitySearch } from '../useCommunitySearch';

const api = jest.mocked(communitySearchApi);

const WS = '11111111-1111-4111-8111-111111111111';

function row(overrides: Partial<SearchResultRow> = {}): SearchResultRow {
  return {
    id: 'res-1',
    kind: 'post',
    targetId: 'post-1',
    cohortId: null,
    authorId: null,
    excerpt: 'a matching excerpt',
    createdAt: '2026-03-01T00:00:00.000Z',
    ...overrides,
  };
}

function page(
  results: SearchResultRow[],
  nextCursor: string | null = null,
): SearchResponse {
  return { version: 1, query: 'q', results, nextCursor, tookMs: 3 };
}

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { Wrapper };
}

beforeEach(() => {
  (api.search as jest.Mock).mockReset();
  api.search.mockResolvedValue(page([]));
});

describe('useCommunitySearch — disabled postures (no network)', () => {
  it('does NOT fetch when no workspace id is known', async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(
      () => useCommunitySearch({ workspaceId: undefined, term: 'hello' }),
      { wrapper: Wrapper },
    );
    expect(api.search).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('does NOT fetch when the term is empty', async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(
      () => useCommunitySearch({ workspaceId: WS, term: '' }),
      { wrapper: Wrapper },
    );
    expect(api.search).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('does NOT fetch when the term is whitespace-only', async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(
      () => useCommunitySearch({ workspaceId: WS, term: '   ' }),
      { wrapper: Wrapper },
    );
    expect(api.search).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useCommunitySearch — enabled fetch + cursor pagination', () => {
  it('calls search with the TRIMMED term and no cursor on page 1', async () => {
    api.search.mockResolvedValue(page([row()]));
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(
      () => useCommunitySearch({ workspaceId: WS, term: '  hello  ' }),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.search).toHaveBeenLastCalledWith(WS, {
      q: 'hello',
      kind: undefined,
      cohortId: undefined,
      cursor: undefined,
    });
  });

  it('passes a kind + cohort scope through when provided', async () => {
    api.search.mockResolvedValue(page([]));
    const { Wrapper } = makeWrapper();
    renderHook(
      () =>
        useCommunitySearch({
          workspaceId: WS,
          term: 'plan',
          kind: 'event',
          cohortId: 'co-7',
        }),
      { wrapper: Wrapper },
    );
    await waitFor(() =>
      expect(api.search).toHaveBeenLastCalledWith(WS, {
        q: 'plan',
        kind: 'event',
        cohortId: 'co-7',
        cursor: undefined,
      }),
    );
  });

  it('threads nextCursor into page 2, then stops on null', async () => {
    api.search
      .mockResolvedValueOnce(page([row({ id: 'res-1' })], 'CUR2'))
      .mockResolvedValueOnce(page([row({ id: 'res-2' })], null));
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(
      () => useCommunitySearch({ workspaceId: WS, term: 'hello' }),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(true);

    await act(async () => {
      await result.current.fetchNextPage();
    });

    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));
    expect(api.search).toHaveBeenNthCalledWith(2, WS, {
      q: 'hello',
      kind: undefined,
      cohortId: undefined,
      cursor: 'CUR2',
    });
    expect(result.current.hasNextPage).toBe(false);
  });
});
