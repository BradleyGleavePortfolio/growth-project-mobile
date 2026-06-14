/**
 * useVoiceFeed — hook behaviour tests for the v3-3 read-only voice feed.
 * Mirrors useClassroomFeed.test.tsx: disabled postures + bounded cursor paging.
 */
import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const flags = { communityVoiceNotes: true };
jest.mock('../../config/featureFlags', () => ({
  get featureFlags() {
    return flags;
  },
}));

jest.mock('../../api/communityVoiceApi', () => ({
  communityVoiceApi: { listFeed: jest.fn() },
  VOICE_PAGE_LIMIT: 20,
}));

import { communityVoiceApi } from '../../api/communityVoiceApi';
import { useVoiceFeed } from '../useVoiceFeed';

const api = jest.mocked(communityVoiceApi);
const WS = '11111111-1111-4111-8111-111111111111';
const CURSOR = '99999999-9999-4999-8999-999999999999';

function page(notes: unknown[], next_cursor: string | null = null) {
  return { voice_notes: notes, next_cursor };
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
  flags.communityVoiceNotes = true;
  (api.listFeed as jest.Mock).mockReset();
  api.listFeed.mockResolvedValue(page([]));
});

describe('useVoiceFeed — disabled postures (no network)', () => {
  it('does NOT fetch when no workspace id is known (null)', async () => {
    const { Wrapper } = makeWrapper();
    const { result } = await renderHook(() => useVoiceFeed({ workspaceId: null }), {
      wrapper: Wrapper,
    });
    expect(api.listFeed).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('does NOT fetch when the communityVoiceNotes flag is OFF', async () => {
    flags.communityVoiceNotes = false;
    const { Wrapper } = makeWrapper();
    const { result } = await renderHook(() => useVoiceFeed({ workspaceId: WS }), {
      wrapper: Wrapper,
    });
    expect(api.listFeed).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useVoiceFeed — enabled fetch + cursor pagination', () => {
  it('calls listFeed with a bounded page limit, no cursor on page 1', async () => {
    api.listFeed.mockResolvedValue(page([{ id: 'n1' }]));
    const { Wrapper } = makeWrapper();
    const { result } = await renderHook(() => useVoiceFeed({ workspaceId: WS }), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.listFeed).toHaveBeenLastCalledWith(WS, { limit: 20 });
  });

  it('passes a cohort scope through', async () => {
    const { Wrapper } = makeWrapper();
    await renderHook(() => useVoiceFeed({ workspaceId: WS, cohortId: 'co-7' }), {
      wrapper: Wrapper,
    });
    await waitFor(() =>
      expect(api.listFeed).toHaveBeenLastCalledWith(WS, {
        limit: 20,
        cohortId: 'co-7',
      }),
    );
  });

  it('threads next_cursor into page 2, then stops on null', async () => {
    api.listFeed
      .mockResolvedValueOnce(page([{ id: 'n1' }], CURSOR))
      .mockResolvedValueOnce(page([{ id: 'n2' }], null));
    const { Wrapper } = makeWrapper();
    const { result } = await renderHook(() => useVoiceFeed({ workspaceId: WS }), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(true);

    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));
    expect(api.listFeed).toHaveBeenNthCalledWith(2, WS, {
      limit: 20,
      cursor: CURSOR,
    });
    expect(result.current.hasNextPage).toBe(false);
  });
});
