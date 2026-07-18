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

const mockStore: { clients: Array<{ id: string }>; loadClients: jest.Mock } = {
  clients: [],
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

/** Make the next roster load resolve to a roster of exactly n rows. */
function loadYields(n: number): void {
  mockStore.loadClients.mockImplementation(async () => {
    mockStore.clients = roster(n);
  });
}

let appStateHandler: ((s: AppStateStatus) => void) | null = null;
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
  mockStore.loadClients.mockReset();
  mockUser = { id: 'coach-1' };
  appStateHandler = null;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, cb) => {
    appStateHandler = cb;
    return { remove: jest.fn() } as NativeEventSubscription;
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
});
