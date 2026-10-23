/**
 * FX-872 (m#872 Opus B1-B5, Sol B1-B4): closed until the server says open, one block cache, closed chats leave the lists.
 */
import { act, renderHook } from '@testing-library/react-native';

jest.mock('../../../ui/haptics/haptics.service', () => ({
  HapticService: { warning: jest.fn(async () => undefined) },
}));
jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return { useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }) };
});
const mockPost = jest.fn(async () => ({ data: {} }));
const mockDelete = jest.fn(async () => ({ data: {} }));
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: {
    post: (...a: unknown[]) => mockPost(...(a as [])),
    delete: (...a: unknown[]) => mockDelete(...(a as [])),
    get: jest.fn(async () => ({ data: {} })),
  },
}));

import { queryClient } from '../../../services/queryClient';
import { useBlockedUsersStore } from '../../../store/blockedUsersStore';
import { messagesModerationApi } from '../../../api/messagesApi';
import { useConversationClosed, useServerAnswered } from '../ConversationClosed';
import { closedRefusals } from '../closedRefusal';
import { blockPlaced, blockLifted } from '../../../lib/blockSync';

const refusal = { isAxiosError: true, response: { status: 403, data: { error: 'BLOCKED', message: 'Messages cannot be sent to blocked users' } } };
const read = (over: Partial<{ isSuccess: boolean; isStale: boolean; isFetchedAfterMount: boolean }>) => ({
  isSuccess: false,
  isStale: true,
  isFetchedAfterMount: false,
  ...over,
});

beforeEach(() => {
  queryClient.clear();
  useBlockedUsersStore.setState({ blocked: [] });
  closedRefusals.clear('coach-1');
  closedRefusals.clear('client-1');
  mockPost.mockClear();
  mockDelete.mockClear();
});

describe('closed until the server says open', () => {
  it('nothing to type while the read is out; open once it answers; closed wins over ready', async () => {
    const { result, rerender } = await renderHook(({ ready }: { ready: boolean }) => useConversationClosed('coach-1', [], ready), {
      initialProps: { ready: false },
    });
    expect(result.current).toMatchObject({ closed: false, open: false });
    await rerender({ ready: true });
    expect(result.current).toMatchObject({ closed: false, open: true });
    await act(async () => useBlockedUsersStore.setState({ blocked: [{ id: 'coach-1', displayName: 'Roman', blockedAt: 'x' }] }));
    expect(result.current).toMatchObject({ closed: true, open: false });
  });

  it("the coaching row's own closed flag closes it for the person blocked (they get no refusal until they send)", async () => {
    const { result } = await renderHook(() => useConversationClosed('client-1', [], true, true));
    expect(result.current).toMatchObject({ closed: true, open: false });
  });

  it('a refused send is remembered: leaving and coming back stays closed, until the server row says open', async () => {
    const first = await renderHook(() => useConversationClosed('client-1', [], true));
    await act(async () => { first.result.current.close(refusal); });
    expect(first.result.current.closed).toBe(true);
    first.unmount();
    const again = await renderHook(({ row }: { row?: boolean }) => useConversationClosed('client-1', [], true, row), {
      initialProps: { row: undefined as boolean | undefined },
    });
    expect(again.result.current.closed).toBe(true);
    await again.rerender({ row: false });
    expect(again.result.current.closed).toBe(false);
  });

  it('useServerAnswered: cache restored at a cold start does not count; a fresh read does, and stays for the visit', async () => {
    const { result, rerender } = await renderHook(({ r }: { r: ReturnType<typeof read> }) => useServerAnswered(r), {
      initialProps: { r: read({ isSuccess: true, isStale: true, isFetchedAfterMount: false }) },
    });
    expect(result.current).toBe(false);
    await rerender({ r: read({ isSuccess: true, isFetchedAfterMount: true }) });
    expect(result.current).toBe(true);
    await rerender({ r: read({ isSuccess: true, isStale: true, isFetchedAfterMount: true }) });
    expect(result.current).toBe(true);
  });

  it('useServerAnswered: a failed read never opens', async () => {
    const { result } = await renderHook(() => useServerAnswered(read({ isSuccess: false, isFetchedAfterMount: true })));
    expect(result.current).toBe(false);
  });

  it('a closed refusal is not retried (no seconds with a box while it retries)', () => {
    const retry = queryClient.getDefaultOptions().queries?.retry as (n: number, e: unknown) => boolean;
    expect(retry(0, { response: { status: 404, data: { code: 'community.dm.not_found' } } })).toBe(false);
    expect(retry(0, { response: { status: 404, data: { code: 'community.post.not_found' } } })).toBe(false);
    expect(retry(0, new Error('Network Error'))).toBe(true);
  });
});

describe('one block cache (Opus B3)', () => {
  it('a block from any screen closes every screen; an unblock from any screen opens them all', async () => {
    const chat = await renderHook(() => useConversationClosed('coach-1', [], true));
    expect(chat.result.current.open).toBe(true);
    await act(async () => { await messagesModerationApi.block('coach-1'); });
    expect(chat.result.current.closed).toBe(true);
    expect(useBlockedUsersStore.getState().isBlocked('coach-1')).toBe(true);
    await act(async () => { await messagesModerationApi.unblock('coach-1'); });
    expect(chat.result.current.open).toBe(true);
  });

  it('an unblock clears a remembered refusal with that person', async () => {
    closedRefusals.add('coach-1');
    const chat = await renderHook(() => useConversationClosed('coach-1', [], true));
    expect(chat.result.current.closed).toBe(true);
    await act(async () => blockLifted('coach-1'));
    expect(chat.result.current.closed).toBe(false);
  });

  it('hydration replaces the local list: an unblock made elsewhere reopens here', async () => {
    useBlockedUsersStore.setState({ blocked: [{ id: 'coach-1', displayName: 'Roman', blockedAt: 'x' }] });
    await act(async () => useBlockedUsersStore.getState().addFromServer([], { replace: true }));
    expect(useBlockedUsersStore.getState().isBlocked('coach-1')).toBe(false);
  });
});

describe('closed chats leave the lists (owner 10-23 "Dissapear")', () => {
  it('on block the DM row and the coach inbox row drop from the cache at once; on unblock both read again', async () => {
    queryClient.setQueryData(['community', 'dms', 'ws-1'], [{ thread_id: 't1', other_user_id: 'client-1' }, { thread_id: 't2', other_user_id: 'x' }]);
    queryClient.setQueryData(['messaging', 'v2', 'coach-inbox', 'all'], {
      pages: [{ items: [{ thread_id: 'a', client_id: 'client-1' }, { thread_id: 'b', client_id: 'y' }], next_cursor: null, total_unread: 0 }],
      pageParams: [null],
    });
    blockPlaced('client-1');
    expect((queryClient.getQueryData(['community', 'dms', 'ws-1']) as { thread_id: string }[]).map((t) => t.thread_id)).toEqual(['t2']);
    const inbox = queryClient.getQueryData(['messaging', 'v2', 'coach-inbox', 'all']) as { pages: { items: { thread_id: string }[] }[] };
    expect(inbox.pages[0].items.map((t) => t.thread_id)).toEqual(['b']);
    blockLifted('client-1');
    expect(queryClient.getQueryState(['community', 'dms', 'ws-1'])?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(['messaging', 'v2', 'coach-inbox', 'all'])?.isInvalidated).toBe(true);
  });
});
