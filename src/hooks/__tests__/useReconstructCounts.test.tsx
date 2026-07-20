/**
 * useReconstructCounts — hook behaviour tests (v0.3 extension-import review,
 * PR-M4). Verifies the honest, page-local counting posture:
 *   - DISABLED (no fetch, no listener) when the kill switch is OFF.
 *   - DISABLED when no coach id is known yet (fails closed before auth).
 *   - ENABLED: fetches BOTH canonical families and reports distinct entities
 *     LOADED SO FAR (page-local), never a total.
 *   - Cursor pagination: fetchMore threads the opaque next_cursor; a null cursor
 *     stops further fetches; counts accumulate deduped across pages.
 *   - Failure: a rejected fetch surfaces a typed errorKind with no data.
 *   - User isolation (Rule 15): a different coach id is a distinct query — one
 *     coach's pages never bleed into another's.
 *
 * importReviewApi + featureFlags + useCurrentUser are mocked so the tests are
 * deterministic and never touch the network.
 */
import React from 'react';
import {
  AppState,
  type AppStateStatus,
  type NativeEventSubscription,
} from 'react-native';
import { renderHook, waitFor, act, cleanup } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const flags = { extensionImport: true };
jest.mock('../../config/featureFlags', () => ({
  get featureFlags() {
    return flags;
  },
}));

let mockUser: { id: string } | null = { id: 'coach-1' };
jest.mock('../useCurrentUser', () => ({
  useCurrentUser: () => mockUser,
}));

jest.mock('../../api/importReviewApi', () => ({
  importReviewApi: { listEntities: jest.fn() },
  RECONSTRUCT_PAGE_LIMIT: 20,
}));

import { importReviewApi } from '../../api/importReviewApi';
import type { ReconstructEntitiesPage } from '../../types/importReview';
import { useReconstructCounts } from '../useReconstructCounts';

const listEntities = importReviewApi.listEntities as jest.Mock;

const uuid = (n: number) =>
  `${String(n).repeat(8)}-1111-4111-8111-111111111111`.slice(0, 36);

function page(
  family: 'workouts' | 'client_history',
  ids: number[],
  next_cursor: string | null = null,
  reasons: { code: string; message: string }[] = [],
): ReconstructEntitiesPage {
  const entities = ids.map((n) => ({ id: uuid(n), family }));
  return { family, entities, reasons, page_count: entities.length, next_cursor };
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

const workoutsOf = (r: { current: ReturnType<typeof useReconstructCounts> }) =>
  r.current.families.find((f) => f.family === 'workouts')!;
const clientHistoryOf = (r: { current: ReturnType<typeof useReconstructCounts> }) =>
  r.current.families.find((f) => f.family === 'client_history')!;

let appStateHandler: ((s: AppStateStatus) => void) | null = null;
let appStateRemove: jest.Mock;
const foreground = (s: AppStateStatus = 'active') =>
  act(() => appStateHandler?.(s));

beforeEach(() => {
  flags.extensionImport = true;
  mockUser = { id: 'coach-1' };
  listEntities.mockReset();
  listEntities.mockResolvedValue(page('workouts', []));
  appStateHandler = null;
  appStateRemove = jest.fn();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, cb) => {
    appStateHandler = cb as (s: AppStateStatus) => void;
    return { remove: appStateRemove } as NativeEventSubscription;
  });
});

afterEach(async () => {
  await cleanup();
  jest.restoreAllMocks();
});

describe('useReconstructCounts — disabled postures (no network)', () => {
  it('does NOT fetch when the kill switch is OFF', async () => {
    flags.extensionImport = false;
    const { Wrapper } = makeWrapper();
    const { result } = await renderHook(() => useReconstructCounts(), { wrapper: Wrapper });
    expect(result.current.enabled).toBe(false);
    expect(listEntities).not.toHaveBeenCalled();
  });

  it('does NOT fetch when no coach id is known yet', async () => {
    mockUser = null;
    const { Wrapper } = makeWrapper();
    const { result } = await renderHook(() => useReconstructCounts(), { wrapper: Wrapper });
    expect(result.current.enabled).toBe(false);
    expect(listEntities).not.toHaveBeenCalled();
  });
});

describe('useReconstructCounts — enabled fetch + page-local counts', () => {
  it('fetches both canonical families with a bounded limit and no cursor on page 1', async () => {
    listEntities.mockImplementation((family: 'workouts' | 'client_history') =>
      Promise.resolve(page(family, [1])),
    );
    const { Wrapper } = makeWrapper();
    const { result } = await renderHook(() => useReconstructCounts(), { wrapper: Wrapper });

    await waitFor(() => expect(workoutsOf(result).hasData).toBe(true));
    expect(listEntities).toHaveBeenCalledWith('workouts', { limit: 20 });
    expect(listEntities).toHaveBeenCalledWith('client_history', { limit: 20 });
    expect(result.current.families.map((f) => f.family).sort()).toEqual([
      'client_history',
      'workouts',
    ]);
  });

  it('reports distinct entities loaded so far (page-local), deduped', async () => {
    listEntities.mockImplementation((family: 'workouts' | 'client_history') =>
      family === 'workouts'
        ? Promise.resolve(page('workouts', [1, 2, 2]))
        : Promise.resolve(page('client_history', [])),
    );
    const { Wrapper } = makeWrapper();
    const { result } = await renderHook(() => useReconstructCounts(), { wrapper: Wrapper });
    await waitFor(() => expect(workoutsOf(result).hasData).toBe(true));
    // [1,2,2] → 2 distinct, never 3, and never a claimed total.
    expect(workoutsOf(result).count).toBe(2);
  });

  it('surfaces stable reasons deduped by code', async () => {
    listEntities.mockImplementation((family: 'workouts' | 'client_history') =>
      Promise.resolve(
        page(family, [1], null, [
          { code: 'partial', message: 'Some rows were unreadable.' },
          { code: 'partial', message: 'dup code — dropped' },
        ]),
      ),
    );
    const { Wrapper } = makeWrapper();
    const { result } = await renderHook(() => useReconstructCounts(), { wrapper: Wrapper });
    await waitFor(() => expect(workoutsOf(result).hasData).toBe(true));
    expect(workoutsOf(result).reasons).toHaveLength(1);
    expect(workoutsOf(result).reasons[0].code).toBe('partial');
  });

  it('paginates: fetchMore threads the opaque cursor and accumulates deduped counts', async () => {
    listEntities.mockImplementation(
      (family: 'workouts' | 'client_history', opts: { cursor?: string } = {}) => {
        if (family !== 'workouts') return Promise.resolve(page('client_history', []));
        return opts.cursor === 'CUR'
          ? Promise.resolve(page('workouts', [3], null))
          : Promise.resolve(page('workouts', [1, 2], 'CUR'));
      },
    );
    const { Wrapper } = makeWrapper();
    const { result } = await renderHook(() => useReconstructCounts(), { wrapper: Wrapper });

    await waitFor(() => expect(workoutsOf(result).hasData).toBe(true));
    expect(workoutsOf(result).count).toBe(2);
    expect(workoutsOf(result).hasMore).toBe(true);

    await act(async () => {
      workoutsOf(result).fetchMore();
    });

    await waitFor(() => expect(workoutsOf(result).count).toBe(3));
    expect(listEntities).toHaveBeenCalledWith('workouts', { limit: 20, cursor: 'CUR' });
    expect(workoutsOf(result).hasMore).toBe(false);
  });
});

describe('useReconstructCounts — failure', () => {
  it('surfaces a typed errorKind with no data on a rejected fetch', async () => {
    listEntities.mockImplementation((family: 'workouts' | 'client_history') =>
      family === 'workouts'
        ? Promise.reject(Object.assign(new Error('boom'), { kind: 'server' }))
        : Promise.resolve(page('client_history', [])),
    );
    const { Wrapper } = makeWrapper();
    const { result } = await renderHook(() => useReconstructCounts(), { wrapper: Wrapper });
    await waitFor(() => expect(workoutsOf(result).errorKind).toBe('server'));
    expect(workoutsOf(result).hasData).toBe(false);
    expect(workoutsOf(result).count).toBe(0);
  });
});

describe('useReconstructCounts — user isolation (Rule 15)', () => {
  it('keys the query by coach id so a second coach starts clean', async () => {
    listEntities.mockImplementation((family: 'workouts' | 'client_history') =>
      family === 'workouts'
        ? Promise.resolve(page('workouts', [1, 2, 3]))
        : Promise.resolve(page('client_history', [])),
    );
    const { Wrapper } = makeWrapper();
    const { result, rerender } = await renderHook(() => useReconstructCounts(), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(workoutsOf(result).count).toBe(3));

    // A different coach signs in: the query key changes, so the new coach does
    // NOT inherit coach-1's count of 3.
    listEntities.mockImplementation((family: 'workouts' | 'client_history') =>
      family === 'workouts'
        ? Promise.resolve(page('workouts', [9]))
        : Promise.resolve(page('client_history', [])),
    );
    mockUser = { id: 'coach-2' };
    rerender({});
    await waitFor(() => expect(workoutsOf(result).count).toBe(1));
  });

  it('does not show the first coach\'s count while the second coach is still loading', async () => {
    listEntities.mockImplementation((family: 'workouts' | 'client_history') =>
      family === 'workouts'
        ? Promise.resolve(page('workouts', [1, 2, 3]))
        : Promise.resolve(page('client_history', [])),
    );
    const { Wrapper } = makeWrapper();
    const { result, rerender } = await renderHook(() => useReconstructCounts(), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(workoutsOf(result).count).toBe(3));

    // coach-2's fetch is held open: its query key is fresh, so there is no
    // cached page to borrow — the count must not read 3 in the interim.
    let release!: () => void;
    listEntities.mockImplementation((family: 'workouts' | 'client_history') =>
      family === 'workouts'
        ? new Promise((res) => {
            release = () => res(page('workouts', [9]));
          })
        : Promise.resolve(page('client_history', [])),
    );
    mockUser = { id: 'coach-2' };
    rerender({});
    await waitFor(() => expect(workoutsOf(result).isLoading).toBe(true));
    expect(workoutsOf(result).count).toBe(0);
    expect(workoutsOf(result).hasData).toBe(false);
    await act(async () => {
      release();
    });
    await waitFor(() => expect(workoutsOf(result).count).toBe(1));
  });
});

describe('useReconstructCounts — refresh, stale, and recovery', () => {
  it('keeps prior data visible and flags an error when a refresh fails (stale, not blank)', async () => {
    listEntities.mockResolvedValue(page('client_history', []));
    listEntities.mockImplementation((family: 'workouts' | 'client_history') =>
      family === 'workouts'
        ? Promise.resolve(page('workouts', [1, 2, 3]))
        : Promise.resolve(page('client_history', [])),
    );
    const { Wrapper } = makeWrapper();
    const { result } = await renderHook(() => useReconstructCounts(), { wrapper: Wrapper });
    await waitFor(() => expect(workoutsOf(result).count).toBe(3));

    // The next fetch fails. React Query retains the last good pages, so the
    // count must stay 3 while errorKind surfaces the failure.
    listEntities.mockImplementation((family: 'workouts' | 'client_history') =>
      family === 'workouts'
        ? Promise.reject(Object.assign(new Error('down'), { kind: 'network' }))
        : Promise.resolve(page('client_history', [])),
    );
    await act(async () => {
      result.current.refresh();
    });
    await waitFor(() => expect(workoutsOf(result).errorKind).toBe('network'));
    expect(workoutsOf(result).count).toBe(3);
    expect(workoutsOf(result).hasData).toBe(true);
  });

  it('recovers on retry after a failed first load (no permanent zero)', async () => {
    listEntities.mockImplementation((family: 'workouts' | 'client_history') =>
      family === 'workouts'
        ? Promise.reject(Object.assign(new Error('boom'), { kind: 'server' }))
        : Promise.resolve(page('client_history', [])),
    );
    const { Wrapper } = makeWrapper();
    const { result } = await renderHook(() => useReconstructCounts(), { wrapper: Wrapper });
    await waitFor(() => expect(workoutsOf(result).errorKind).toBe('server'));
    expect(workoutsOf(result).hasData).toBe(false);

    listEntities.mockImplementation((family: 'workouts' | 'client_history') =>
      family === 'workouts'
        ? Promise.resolve(page('workouts', [1, 2]))
        : Promise.resolve(page('client_history', [])),
    );
    await act(async () => {
      workoutsOf(result).retry();
    });
    await waitFor(() => expect(workoutsOf(result).count).toBe(2));
    expect(workoutsOf(result).errorKind).toBeNull();
  });

  it('fails families independently — one family\'s error never blanks the other', async () => {
    listEntities.mockImplementation((family: 'workouts' | 'client_history') =>
      family === 'workouts'
        ? Promise.reject(Object.assign(new Error('boom'), { kind: 'server' }))
        : Promise.resolve(page('client_history', [7, 8])),
    );
    const { Wrapper } = makeWrapper();
    const { result } = await renderHook(() => useReconstructCounts(), { wrapper: Wrapper });
    await waitFor(() => expect(clientHistoryOf(result).count).toBe(2));
    expect(workoutsOf(result).errorKind).toBe('server');
    expect(workoutsOf(result).hasData).toBe(false);
    expect(clientHistoryOf(result).errorKind).toBeNull();
  });
});

describe('useReconstructCounts — pagination termination + dedupe', () => {
  it('stops paging on a null next_cursor and makes fetchMore a no-op', async () => {
    listEntities.mockImplementation((family: 'workouts' | 'client_history') =>
      Promise.resolve(page(family, family === 'workouts' ? [1, 2] : [], null)),
    );
    const { Wrapper } = makeWrapper();
    const { result } = await renderHook(() => useReconstructCounts(), { wrapper: Wrapper });
    await waitFor(() => expect(workoutsOf(result).count).toBe(2));
    expect(workoutsOf(result).hasMore).toBe(false);

    const before = listEntities.mock.calls.length;
    await act(async () => {
      workoutsOf(result).fetchMore();
    });
    expect(listEntities.mock.calls.length).toBe(before);
  });

  it('dedupes entity ids that repeat across page boundaries', async () => {
    listEntities.mockImplementation(
      (family: 'workouts' | 'client_history', opts: { cursor?: string } = {}) => {
        if (family !== 'workouts') return Promise.resolve(page('client_history', []));
        return opts.cursor === 'CUR'
          ? Promise.resolve(page('workouts', [2, 3], null)) // 2 repeats page 1
          : Promise.resolve(page('workouts', [1, 2], 'CUR'));
      },
    );
    const { Wrapper } = makeWrapper();
    const { result } = await renderHook(() => useReconstructCounts(), { wrapper: Wrapper });
    await waitFor(() => expect(workoutsOf(result).count).toBe(2));
    await act(async () => {
      workoutsOf(result).fetchMore();
    });
    // pages carry ids [1,2] then [2,3] → 3 distinct, never 4.
    await waitFor(() => expect(workoutsOf(result).count).toBe(3));
  });
});

describe('useReconstructCounts — foreground refresh listener', () => {
  it('re-fetches both families when the app returns to the foreground', async () => {
    listEntities.mockImplementation((family: 'workouts' | 'client_history') =>
      Promise.resolve(page(family, family === 'workouts' ? [1] : [2])),
    );
    const { Wrapper } = makeWrapper();
    const { result } = await renderHook(() => useReconstructCounts(), { wrapper: Wrapper });
    await waitFor(() => expect(workoutsOf(result).hasData).toBe(true));

    const before = listEntities.mock.calls.length;
    await foreground('active');
    await waitFor(() => expect(listEntities.mock.calls.length).toBeGreaterThan(before));
    expect(listEntities).toHaveBeenCalledWith('workouts', { limit: 20 });
    expect(listEntities).toHaveBeenCalledWith('client_history', { limit: 20 });
  });

  it('ignores background/inactive transitions (no churn of requests)', async () => {
    listEntities.mockImplementation((family: 'workouts' | 'client_history') =>
      Promise.resolve(page(family, [1])),
    );
    const { Wrapper } = makeWrapper();
    const { result } = await renderHook(() => useReconstructCounts(), { wrapper: Wrapper });
    await waitFor(() => expect(workoutsOf(result).hasData).toBe(true));

    const before = listEntities.mock.calls.length;
    await foreground('background');
    await foreground('inactive');
    expect(listEntities.mock.calls.length).toBe(before);
  });

  it('removes its AppState listener on unmount', async () => {
    const { Wrapper } = makeWrapper();
    const { result, unmount } = await renderHook(() => useReconstructCounts(), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(workoutsOf(result).hasData).toBe(true));
    expect(AppState.addEventListener).toHaveBeenCalled();
    const before = appStateRemove.mock.calls.length;
    await act(async () => {
      unmount();
    });
    expect(appStateRemove.mock.calls.length).toBe(before + 1);
  });

  it('registers no AppState listener when disabled (kill switch off)', async () => {
    flags.extensionImport = false;
    (AppState.addEventListener as jest.Mock).mockClear();
    const { Wrapper } = makeWrapper();
    const { result } = await renderHook(() => useReconstructCounts(), { wrapper: Wrapper });
    expect(result.current.enabled).toBe(false);
    expect(AppState.addEventListener).not.toHaveBeenCalled();
    expect(listEntities).not.toHaveBeenCalled();
  });
});
