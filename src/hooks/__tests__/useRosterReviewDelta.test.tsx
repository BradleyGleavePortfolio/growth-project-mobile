/**
 * useRosterReviewDelta — roster-derived review delta tests (v0.3 import, PR-M3).
 *
 * Proves the ONLY honest progress signal mobile can show:
 *   - flag-OFF is fully inert: no roster load, flat zero delta,
 *   - baseline is snapshotted from the AUTHORITATIVE roster at journey start
 *     (load first, then snapshot — never a transient empty cache),
 *   - 3→5 yields delta 2; 3→3 yields delta 0 (calm still-running),
 *   - foreground resume re-loads the roster and recomputes the delta,
 *   - the baseline is USER-SCOPED: a second coach resets it (no cross-user leak),
 *   - a shrunk roster floors the delta at 0 (never negative, never invented).
 *
 * coachStore, useCurrentUser and AppState are mocked so we drive the roster and
 * lifecycle deterministically and assert the derived figure.
 */
import { act, renderHook, waitFor, cleanup } from '@testing-library/react-native';
import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';

const mockStore: {
  clients: Array<{ id: string }>;
  loadError: string | null;
  loadClients: jest.Mock;
} = {
  clients: [],
  loadError: null,
  loadClients: jest.fn(),
};
jest.mock('../../store/coachStore', () => ({
  useCoachStore: Object.assign(
    (selector: (s: typeof mockStore) => unknown) => selector(mockStore),
    { getState: () => mockStore },
  ),
}));

let mockUser: { id: string } | null = { id: 'coach-1' };
jest.mock('../useCurrentUser', () => ({
  useCurrentUser: () => mockUser,
}));

import { useRosterReviewDelta } from '../useRosterReviewDelta';

/** n distinct roster rows. */
function roster(n: number): Array<{ id: string }> {
  return Array.from({ length: n }, (_, i) => ({ id: `c${i}` }));
}

/** Make the next roster load succeed with exactly n rows (loadError cleared). */
function loadYields(n: number): void {
  mockStore.loadClients.mockImplementation(async () => {
    mockStore.loadError = null;
    mockStore.clients = roster(n);
  });
}

/** Make the next roster load fail: sets loadError, leaves clients untouched
 *  (mirrors coachStore, which keeps the prior roster on a failed read). */
function loadFails(): void {
  mockStore.loadClients.mockImplementation(async () => {
    mockStore.loadError = 'Could not load clients. Please try again.';
  });
}

/** A gated load that resolves to n rows only once release() is called — lets a
 *  test switch users while a load is in flight. */
function deferredLoad(n: number): () => void {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  mockStore.loadClients.mockImplementation(async () => {
    await gate;
    mockStore.loadError = null;
    mockStore.clients = roster(n);
  });
  return release;
}

let appStateHandler: ((s: AppStateStatus) => void) | null = null;
let appStateRemove: jest.Mock;
const foreground = () => act(() => appStateHandler?.('active'));

/** Wait until the baseline roster load has been issued AND its snapshot has
 *  settled, so a subsequent refresh/foreground compares against a real base. */
async function baselineSettled(): Promise<void> {
  await waitFor(() => expect(mockStore.loadClients).toHaveBeenCalledTimes(1));
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  mockStore.clients = [];
  mockStore.loadError = null;
  mockStore.loadClients.mockReset();
  mockUser = { id: 'coach-1' };
  appStateHandler = null;
  appStateRemove = jest.fn();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, cb) => {
    appStateHandler = cb;
    return { remove: appStateRemove } as NativeEventSubscription;
  });
});

afterEach(async () => {
  await cleanup();
  jest.restoreAllMocks();
});

describe('useRosterReviewDelta — flag-off containment', () => {
  it('is inert when disabled: no roster load, flat zero delta', async () => {
    loadYields(3);
    const { result } = await renderHook(() => useRosterReviewDelta(false));
    await foreground();
    expect(mockStore.loadClients).not.toHaveBeenCalled();
    expect(result.current.delta).toBe(0);
  });

  it('refresh() is a fail-closed no-op when disabled (no roster load)', async () => {
    loadYields(3);
    const { result } = await renderHook(() => useRosterReviewDelta(false));
    await act(async () => {
      result.current.refresh();
      await Promise.resolve();
    });
    expect(mockStore.loadClients).not.toHaveBeenCalled();
    expect(result.current.delta).toBe(0);
  });

  it('registers no AppState listener when disabled', async () => {
    await renderHook(() => useRosterReviewDelta(false));
    expect(AppState.addEventListener).not.toHaveBeenCalled();
  });
});

describe('useRosterReviewDelta — baseline + delta', () => {
  it('snapshots the baseline from the authoritative roster at journey start', async () => {
    loadYields(3);
    const { result } = await renderHook(() => useRosterReviewDelta(true));
    await waitFor(() => expect(mockStore.loadClients).toHaveBeenCalledWith('coach-1'));
    // Baseline captured against the loaded roster (3), not the empty cache → 0.
    expect(result.current.delta).toBe(0);
  });

  it('derives delta 2 when the roster grows 3→5 on foreground refresh', async () => {
    loadYields(3);
    const { result } = await renderHook(() => useRosterReviewDelta(true));
    await waitFor(() => expect(mockStore.loadClients).toHaveBeenCalledTimes(1));

    loadYields(5);
    await foreground();
    await waitFor(() => expect(result.current.delta).toBe(2));
  });

  it('stays at delta 0 when the roster is unchanged 3→3 (calm still-running)', async () => {
    loadYields(3);
    const { result } = await renderHook(() => useRosterReviewDelta(true));
    await waitFor(() => expect(mockStore.loadClients).toHaveBeenCalledTimes(1));

    await foreground();
    await waitFor(() => expect(mockStore.loadClients).toHaveBeenCalledTimes(2));
    expect(result.current.delta).toBe(0);
  });

  it('floors the delta at 0 if the roster shrinks below the baseline', async () => {
    loadYields(3);
    const { result } = await renderHook(() => useRosterReviewDelta(true));
    await waitFor(() => expect(mockStore.loadClients).toHaveBeenCalledTimes(1));

    loadYields(1);
    await foreground();
    await waitFor(() => expect(mockStore.loadClients).toHaveBeenCalledTimes(2));
    expect(result.current.delta).toBe(0);
  });

  it('recomputes via the imperative refresh() as well as foreground', async () => {
    loadYields(2);
    const { result } = await renderHook(() => useRosterReviewDelta(true));
    await baselineSettled();

    loadYields(6);
    await act(async () => {
      result.current.refresh();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.delta).toBe(4));
  });

  it('does not anchor a baseline on a failed load, then captures honestly on retry (Rule 18)', async () => {
    // Journey start fails: no baseline is anchored, delta stays a flat 0.
    loadFails();
    const { result } = await renderHook(() => useRosterReviewDelta(true));
    await waitFor(() => expect(mockStore.loadClients).toHaveBeenCalledTimes(1));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.delta).toBe(0);

    // Retry succeeds against a pre-existing roster of 4 — those are the BASELINE,
    // never four "new" clients (a failed-then-anchored-at-0 bug would show 4).
    loadYields(4);
    await foreground();
    await waitFor(() => expect(mockStore.loadClients).toHaveBeenCalledTimes(2));
    expect(result.current.delta).toBe(0);

    // Only genuine growth after the honest baseline counts: 4→6 = 2.
    loadYields(6);
    await foreground();
    await waitFor(() => expect(result.current.delta).toBe(2));
  });
});

describe('useRosterReviewDelta — user-scoped isolation', () => {
  it('resets the baseline when the authenticated user changes (no cross-user leak)', async () => {
    loadYields(3);
    const { result, rerender } = await renderHook(() => useRosterReviewDelta(true));
    await baselineSettled();
    expect(mockStore.loadClients).toHaveBeenCalledWith('coach-1');

    // coach-1's roster grows → delta 2.
    loadYields(5);
    await foreground();
    await waitFor(() => expect(result.current.delta).toBe(2));

    // A different coach signs in: baseline must reset and reload for coach-2.
    mockStore.loadClients.mockClear();
    loadYields(10);
    mockUser = { id: 'coach-2' };
    rerender(undefined);
    await waitFor(() => expect(mockStore.loadClients).toHaveBeenCalledWith('coach-2'));
    // coach-2's baseline is its own roster (10) → delta 0, NOT inherited from coach-1.
    await waitFor(() => expect(result.current.delta).toBe(0));
  });

  it('wipes the baseline and delta on sign-out (user → null), never leaking to the next session', async () => {
    loadYields(3);
    const { result, rerender } = await renderHook(() => useRosterReviewDelta(true));
    await baselineSettled();

    loadYields(7);
    await foreground();
    await waitFor(() => expect(result.current.delta).toBe(4));

    // Sign-out: user becomes null → the hook must reset to a flat zero delta and
    // issue no further roster loads.
    mockStore.loadClients.mockClear();
    mockUser = null;
    rerender(undefined);
    await waitFor(() => expect(result.current.delta).toBe(0));
    await foreground();
    expect(mockStore.loadClients).not.toHaveBeenCalled();
  });

  it('rejects a stale refresh whose user switched mid-flight (no tenant mix)', async () => {
    loadYields(2);
    const { result, rerender } = await renderHook(() => useRosterReviewDelta(true));
    await baselineSettled(); // coach-1 baseline = 2

    // A refresh is issued for coach-1 but gated so it cannot resolve yet. The
    // act is awaited so React does not leave a dangling scope that would defer
    // the coach-2 baseline effect below.
    const release = deferredLoad(50);
    await act(async () => {
      result.current.refresh();
      await Promise.resolve();
    });

    // coach-2 signs in while coach-1's load is still in flight; the baseline
    // effect re-fires and issues coach-2's own load.
    mockUser = { id: 'coach-2' };
    rerender(undefined);
    await waitFor(() => expect(mockStore.loadClients).toHaveBeenCalledWith('coach-2'));

    // On release, coach-1's stale load must be rejected; only coach-2's own
    // baseline (50) commits → delta 0, never coach-1's 50 − 2 = 48.
    await act(async () => {
      release();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.delta).toBe(0));
  });

  it('removes its AppState listener on unmount', async () => {
    loadYields(3);
    const { unmount } = await renderHook(() => useRosterReviewDelta(true));
    await baselineSettled(); // settle the load so unmount has no pending work
    expect(AppState.addEventListener).toHaveBeenCalled(); // a listener was registered
    const removedBefore = appStateRemove.mock.calls.length;
    await act(async () => {
      unmount();
    });
    // Unmount runs the hook's own teardown → exactly one further remove().
    expect(appStateRemove.mock.calls.length).toBe(removedBefore + 1);
  });
});
