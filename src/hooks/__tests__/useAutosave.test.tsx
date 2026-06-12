/**
 * useAutosave hook tests (MWB-4).
 *
 * Covers the behaviours the operator intent and the hard gates ride on:
 *   - debounced flush after an edit (no save on a same-value re-render),
 *   - mirror-write-FIRST (the kill-the-app durability line) before the network,
 *   - kill/replay: a mirrored batch on mount replays with the SAME key,
 *   - 409 fast-forward: the hook adopts the conflict's fresh token + index,
 *     clears the mirror, and calls onConflict,
 *   - idempotency-key reuse across a re-flush of the same buffered edit,
 *   - a network failure leaves the batch in the mirror and marks 'offline'
 *     (never a silent success),
 *   - flag-off (`enabled: false`) is fully inert: zero network, zero mirror.
 *
 * The API layer + mirror are mocked so no real axios / AsyncStorage fires; we
 * assert the hook's orchestration, not the transport.
 */

import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';

// ─── Mocks ───────────────────────────────────────────────────────────────────

jest.mock('../../api/workoutAutosaveApi', () => {
  // Re-create a minimal error class with the fields the hook branches on.
  // No TS parameter-properties here — explicit assignment keeps the mock
  // factory portable across babel transforms (no hoisted out-of-scope refs).
  class WorkoutAutosaveApiError extends Error {
    kind: string;
    status: number;
    conflict?: unknown;
    constructor(kind: string, status: number, message: string, conflict?: unknown) {
      super(message);
      this.kind = kind;
      this.status = status;
      this.conflict = conflict;
      this.name = 'WorkoutAutosaveApiError';
    }
    get isNetwork() {
      return this.kind === 'network';
    }
  }
  return {
    __esModule: true,
    WorkoutAutosaveApiError,
    workoutAutosaveApi: { autosave: jest.fn(), undo: jest.fn() },
  };
});

jest.mock('../../storage/autosaveMirror', () => ({
  __esModule: true,
  writeAutosaveMirror: jest.fn().mockResolvedValue(undefined),
  readAutosaveMirror: jest.fn().mockResolvedValue(null),
  clearAutosaveMirror: jest.fn().mockResolvedValue(undefined),
  // The keyed clear is the per-batch precise clear the queue relies on. Default
  // it to "cleared" (true) so a single-batch happy path behaves like the old
  // blanket clear; race tests override it to assert it is NOT called for a
  // superseded batch.
  clearAutosaveMirrorIfKey: jest.fn().mockResolvedValue(true),
}));

// NetInfo: capture the change listener so we can simulate offline→online
// transitions (the reconnect-replay path). Default unsubscribe is a no-op.
let mockNetInfoHandler: ((s: { isConnected: boolean | null }) => void) | null =
  null;
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: jest.fn(
      (cb: (s: { isConnected: boolean | null }) => void) => {
        mockNetInfoHandler = cb;
        return jest.fn();
      },
    ),
    fetch: jest.fn().mockResolvedValue({ isConnected: true }),
  },
}));

let mockKeyCounter = 0;
jest.mock('../../utils/idempotency', () => ({
  __esModule: true,
  generateIdempotencyKey: jest.fn(() => {
    mockKeyCounter += 1;
    return `idem-${mockKeyCounter}`;
  }),
}));

// AppState listener capture so we can simulate a background transition.
// We also expose a minimal `Platform` so that expo-modules-core's eager
// `ReactNativePlatform.select` read (Platform.ts) resolves during the
// jest-expo preset setup — without it the whole `react-native` mock leaves
// `Platform` undefined and the suite fails to run.
let mockAppStateHandler: ((s: string) => void) | null = null;
jest.mock('react-native', () => ({
  Platform: {
    OS: 'ios',
    select: (obj: Record<string, unknown>) =>
      'ios' in obj ? obj.ios : obj.default,
  },
  AppState: {
    addEventListener: jest.fn((_evt: string, cb: (s: string) => void) => {
      mockAppStateHandler = cb;
      return { remove: jest.fn() };
    }),
  },
}));

import {
  workoutAutosaveApi,
  WorkoutAutosaveApiError,
} from '../../api/workoutAutosaveApi';
import {
  writeAutosaveMirror,
  readAutosaveMirror,
  clearAutosaveMirror,
  clearAutosaveMirrorIfKey,
} from '../../storage/autosaveMirror';
import {
  useAutosave,
  AUTOSAVE_DEBOUNCE_MS,
  AUTOSAVE_SAVED_SETTLE_MS,
  AUTOSAVE_BACKOFF_BASE_MS,
  computeBackoffDelayMs,
} from '../useAutosave';

const mockAutosave = workoutAutosaveApi.autosave as jest.Mock;
const mockWrite = writeAutosaveMirror as jest.Mock;
const mockRead = readAutosaveMirror as jest.Mock;
const mockClear = clearAutosaveMirror as jest.Mock;
const mockClearIfKey = clearAutosaveMirrorIfKey as jest.Mock;

const TOKEN_A = '0000000000000000';
const TOKEN_B = 'feedfacefeedface';

interface Copy {
  n: number;
}

/** A trivial diff: any change to `n` emits one plan_meta-shaped op. */
const diff = (prev: Copy, next: Copy) =>
  prev.n === next.n
    ? []
    : ([{ op: 'plan_meta', meta: { name: `v${next.n}` } }] as never);

function okResponse(over: Partial<{ head: number; token: string }> = {}) {
  return {
    head_revision_index: over.head ?? 1,
    lock_token: over.token ?? TOKEN_B,
    saved_at: '2026-01-01T00:00:00.000Z',
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  mockKeyCounter = 0;
  mockAppStateHandler = null;
  mockNetInfoHandler = null;
  mockRead.mockResolvedValue(null);
  mockWrite.mockResolvedValue(undefined);
  mockClear.mockResolvedValue(undefined);
  mockClearIfKey.mockResolvedValue(true);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('useAutosave — debounce + happy path', () => {
  it('does not fire on an unchanged value', async () => {
    const value = { n: 0 };
    renderHook(() =>
      useAutosave<Copy>({
        planId: 'p1',
        value,
        diff,
        baseRevisionIndex: 0,
        lockToken: TOKEN_A,
      }),
    );
    await act(async () => {
      jest.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS + 50);
    });
    expect(mockAutosave).not.toHaveBeenCalled();
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('writes the mirror BEFORE the network and advances on 200', async () => {
    const order: string[] = [];
    mockWrite.mockImplementation(async () => {
      order.push('mirror');
    });
    mockAutosave.mockImplementation(async () => {
      order.push('network');
      return okResponse({ head: 4, token: TOKEN_B });
    });

    const { result, rerender } = renderHook(
      ({ value }: { value: Copy }) =>
        useAutosave<Copy>({
          planId: 'p1',
          value,
          diff,
          baseRevisionIndex: 0,
          lockToken: TOKEN_A,
        }),
      { initialProps: { value: { n: 0 } } },
    );

    rerender({ value: { n: 1 } });
    await act(async () => {
      jest.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS + 10);
    });
    await waitFor(() => expect(result.current.status).toBe('saved'));

    expect(order).toEqual(['mirror', 'network']);
    // The queue clears the confirmed batch's mirror entry BY KEY (precise
    // per-batch clear), not via a blanket clear that could delete a newer
    // batch's entry — the in-flight-coalescing P0 fix.
    expect(mockClearIfKey).toHaveBeenCalledWith('p1', 'idem-1');
    expect(mockClear).not.toHaveBeenCalled();
    expect(result.current.version).toBe(4);
    expect(result.current.lockToken).toBe(TOKEN_B);
    expect(result.current.lastSavedAt).not.toBeNull();
  });

  it('settles the saved confirmation back to idle after the settle delay (pill hides)', async () => {
    mockAutosave.mockResolvedValueOnce(okResponse({ head: 1, token: TOKEN_B }));

    const { result, rerender } = renderHook(
      ({ value }: { value: Copy }) =>
        useAutosave<Copy>({
          planId: 'p1',
          value,
          diff,
          baseRevisionIndex: 0,
          lockToken: TOKEN_A,
        }),
      { initialProps: { value: { n: 0 } } },
    );

    rerender({ value: { n: 1 } });
    await act(async () => {
      jest.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS + 10);
    });
    await waitFor(() => expect(result.current.status).toBe('saved'));

    // Just before the settle delay elapses the confirmation is still showing.
    await act(async () => {
      jest.advanceTimersByTime(AUTOSAVE_SAVED_SETTLE_MS - 100);
    });
    expect(result.current.status).toBe('saved');

    // Once the settle delay elapses the status returns to idle (pill hides).
    await act(async () => {
      jest.advanceTimersByTime(200);
    });
    await waitFor(() => expect(result.current.status).toBe('idle'));
    // The last-saved timestamp is preserved — only the visible state settled.
    expect(result.current.lastSavedAt).not.toBeNull();
  });
});

describe('useAutosave — 409 rebase (P0: first-409 must not drop edits)', () => {
  it('adopts the conflict token + index, calls onConflict, then rebases + re-sends the local ops on the fresh head', async () => {
    const conflict = {
      error: 'autosave_lock_stale' as const,
      head_revision_index: 9,
      lock_token: TOKEN_B,
    };
    // First send 409s (the by-design first-autosave bootstrap conflict); the
    // rebased re-send then lands a 200 on the fresh head.
    mockAutosave
      .mockRejectedValueOnce(
        new WorkoutAutosaveApiError('conflict', 409, 'conflict', conflict),
      )
      .mockResolvedValueOnce(okResponse({ head: 10, token: TOKEN_A }));
    const onConflict = jest.fn();

    const { result, rerender } = renderHook(
      ({ value }: { value: Copy }) =>
        useAutosave<Copy>({
          planId: 'p1',
          value,
          diff,
          baseRevisionIndex: 0,
          lockToken: TOKEN_A,
          onConflict,
        }),
      { initialProps: { value: { n: 0 } } },
    );

    rerender({ value: { n: 1 } });
    await act(async () => {
      jest.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS + 10);
    });

    // The conflict body is adopted and surfaced to the caller for its refetch.
    await waitFor(() => expect(onConflict).toHaveBeenCalledWith(conflict));

    // The local ops are NOT dropped — the hook re-diffs them onto the fresh head
    // and re-sends. The rebased re-send carries the adopted token/index and the
    // SAME idempotency key (one logical edit, dedupable transport).
    await waitFor(() => expect(mockAutosave).toHaveBeenCalledTimes(2));
    const firstCall = mockAutosave.mock.calls[0][0];
    const rebaseCall = mockAutosave.mock.calls[1][0];
    expect(rebaseCall.idempotencyKey).toBe(firstCall.idempotencyKey);
    expect(rebaseCall.body.base_revision_index).toBe(9);
    expect(rebaseCall.body.lock_token).toBe(TOKEN_B);
    expect(rebaseCall.body.ops).toEqual([
      { op: 'plan_meta', meta: { name: 'v1' } },
    ]);

    // After the rebased 200, the save settles and the baseline advances to the
    // server's response — never on the bare 409.
    await waitFor(() => expect(result.current.status).toBe('saved'));
    expect(result.current.version).toBe(10);
    expect(result.current.lockToken).toBe(TOKEN_A);
    // Only the keyed clear is used (no blanket clear that could nuke a newer
    // batch). The mirror is cleared for the confirmed batch's key after the 200.
    expect(mockClear).not.toHaveBeenCalled();
    expect(mockClearIfKey).toHaveBeenCalledWith('p1', firstCall.idempotencyKey);
  });

  it('does NOT advance the diff baseline across repeated 409s (only a 200 advances it)', async () => {
    const conflict1 = {
      error: 'autosave_lock_stale' as const,
      head_revision_index: 5,
      lock_token: TOKEN_B,
    };
    const conflict2 = {
      error: 'autosave_lock_stale' as const,
      head_revision_index: 6,
      lock_token: TOKEN_A,
    };
    // Two 409s in a row, then a 200. Each 409 rebases + re-sends; the baseline
    // (lastSavedValueRef) must NOT advance until the 200 — so every rebased
    // re-send still carries the original op set.
    mockAutosave
      .mockRejectedValueOnce(
        new WorkoutAutosaveApiError('conflict', 409, 'c1', conflict1),
      )
      .mockRejectedValueOnce(
        new WorkoutAutosaveApiError('conflict', 409, 'c2', conflict2),
      )
      .mockResolvedValueOnce(okResponse({ head: 7, token: TOKEN_B }));

    const { result, rerender } = renderHook(
      ({ value }: { value: Copy }) =>
        useAutosave<Copy>({
          planId: 'p1',
          value,
          diff,
          baseRevisionIndex: 0,
          lockToken: TOKEN_A,
        }),
      { initialProps: { value: { n: 0 } } },
    );

    rerender({ value: { n: 1 } });
    await act(async () => {
      jest.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS + 10);
    });

    // Three sends total: original + two rebased re-sends.
    await waitFor(() => expect(mockAutosave).toHaveBeenCalledTimes(3));
    // Every send carries the SAME ops (baseline never advanced on a 409) and the
    // SAME idempotency key (one logical edit).
    const key0 = mockAutosave.mock.calls[0][0].idempotencyKey;
    for (const [arg] of mockAutosave.mock.calls) {
      expect(arg.body.ops).toEqual([{ op: 'plan_meta', meta: { name: 'v1' } }]);
      expect(arg.idempotencyKey).toBe(key0);
    }
    // The second rebase adopts the second conflict's head/token.
    expect(mockAutosave.mock.calls[2][0].body.base_revision_index).toBe(6);
    expect(mockAutosave.mock.calls[2][0].body.lock_token).toBe(TOKEN_A);

    await waitFor(() => expect(result.current.status).toBe('saved'));
    expect(result.current.version).toBe(7);
  });
});

describe('useAutosave — offline leaves the batch to replay', () => {
  it('marks offline and does NOT clear the mirror on a network error', async () => {
    mockAutosave.mockRejectedValueOnce(
      new WorkoutAutosaveApiError('network', 0, 'offline'),
    );
    const { result, rerender } = renderHook(
      ({ value }: { value: Copy }) =>
        useAutosave<Copy>({
          planId: 'p1',
          value,
          diff,
          baseRevisionIndex: 0,
          lockToken: TOKEN_A,
        }),
      { initialProps: { value: { n: 0 } } },
    );
    rerender({ value: { n: 1 } });
    await act(async () => {
      jest.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS + 10);
    });
    await waitFor(() => expect(result.current.status).toBe('offline'));
    expect(mockWrite).toHaveBeenCalled();
    expect(mockClear).not.toHaveBeenCalled();
    expect(result.current.hasPending).toBe(true);
  });
});

describe('useAutosave — kill/replay via the mirror', () => {
  it('replays a mirrored batch on mount with the SAME idempotency key', async () => {
    mockRead.mockResolvedValueOnce({
      version: 1,
      planId: 'p1',
      idempotencyKey: 'survivor-key',
      queuedAtMs: 123,
      batch: {
        base_revision_index: 2,
        lock_token: TOKEN_A,
        cause: 'autosave',
        ops: [{ op: 'plan_meta', meta: { name: 'kept' } }],
      },
    });
    mockAutosave.mockResolvedValueOnce(okResponse({ head: 3, token: TOKEN_B }));

    const { result } = renderHook(() =>
      useAutosave<Copy>({
        planId: 'p1',
        value: { n: 0 },
        diff,
        baseRevisionIndex: 2,
        lockToken: TOKEN_A,
      }),
    );

    await waitFor(() => expect(mockAutosave).toHaveBeenCalled());
    const callArg = mockAutosave.mock.calls[0][0];
    expect(callArg.idempotencyKey).toBe('survivor-key');
    await waitFor(() => expect(result.current.status).toBe('saved'));
    expect(mockClearIfKey).toHaveBeenCalledWith('p1', 'survivor-key');
  });
});

describe('useAutosave — background force-flush', () => {
  it('flushes immediately when the app backgrounds (no debounce wait)', async () => {
    mockAutosave.mockResolvedValueOnce(okResponse());
    const { rerender } = renderHook(
      ({ value }: { value: Copy }) =>
        useAutosave<Copy>({
          planId: 'p1',
          value,
          diff,
          baseRevisionIndex: 0,
          lockToken: TOKEN_A,
        }),
      { initialProps: { value: { n: 0 } } },
    );
    rerender({ value: { n: 1 } });
    // Background BEFORE the debounce elapses — should still flush.
    await act(async () => {
      mockAppStateHandler?.('background');
    });
    await waitFor(() => expect(mockAutosave).toHaveBeenCalled());
  });
});

describe('useAutosave — flag-off invariance', () => {
  it('is fully inert with enabled:false (zero network, zero mirror)', async () => {
    const { rerender } = renderHook(
      ({ value }: { value: Copy }) =>
        useAutosave<Copy>({
          planId: 'p1',
          value,
          diff,
          baseRevisionIndex: 0,
          lockToken: TOKEN_A,
          enabled: false,
        }),
      { initialProps: { value: { n: 0 } } },
    );
    rerender({ value: { n: 1 } });
    await act(async () => {
      jest.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS + 100);
      mockAppStateHandler?.('background');
    });
    expect(mockAutosave).not.toHaveBeenCalled();
    expect(mockWrite).not.toHaveBeenCalled();
    expect(mockRead).not.toHaveBeenCalled();
  });
});

// ─── A small deferred so a test can hold a request "in flight" deterministically.
function defer<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useAutosave — P0: in-flight coalescing must not drop the latest edit', () => {
  it('queues a second edit made while a save is in flight and sends it after the first 200, clearing only the first batch by key', async () => {
    // Hold the FIRST request open so a second edit lands while it is in flight.
    const first = defer<ReturnType<typeof okResponse>>();
    mockAutosave
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(okResponse({ head: 2, token: TOKEN_A }));

    // The first batch's 200 tries to clear by its key (idem-1) but the mirror is
    // now owned by the second batch (idem-2), so the keyed clear returns false:
    // the second batch's mirror entry is preserved (the dropped-edit P0 fix).
    mockClearIfKey.mockImplementation(async (_planId: string, key: string) =>
      key === 'idem-1' ? false : true,
    );

    const { result, rerender } = renderHook(
      ({ value }: { value: Copy }) =>
        useAutosave<Copy>({
          planId: 'p1',
          value,
          diff,
          baseRevisionIndex: 0,
          lockToken: TOKEN_A,
        }),
      { initialProps: { value: { n: 0 } } },
    );

    // First edit → debounce → first request starts (and stays in flight).
    rerender({ value: { n: 1 } });
    await act(async () => {
      jest.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS + 10);
    });
    await waitFor(() => expect(mockAutosave).toHaveBeenCalledTimes(1));
    expect(mockAutosave.mock.calls[0][0].idempotencyKey).toBe('idem-1');
    expect(mockAutosave.mock.calls[0][0].body.ops).toEqual([
      { op: 'plan_meta', meta: { name: 'v1' } },
    ]);

    // SECOND edit while the first is still in flight → must be queued, NOT merged
    // into the in-flight batch, and must carry its OWN fresh key + mirror entry.
    rerender({ value: { n: 2 } });
    await act(async () => {
      jest.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS + 10);
    });
    // Still only one network call — the second batch is parked in pendingNext.
    expect(mockAutosave).toHaveBeenCalledTimes(1);
    expect(result.current.hasPending).toBe(true);
    // The second batch was mirrored under its own fresh key (idem-2), overwriting
    // the first batch's mirror entry on disk.
    const lastMirror = mockWrite.mock.calls[mockWrite.mock.calls.length - 1][0];
    expect(lastMirror.idempotencyKey).toBe('idem-2');

    // Resolve the first request. Its 200 clears ONLY its own key (which no longer
    // owns the mirror → false), then drains the queued second batch.
    await act(async () => {
      first.resolve(okResponse({ head: 1, token: TOKEN_B }));
    });

    await waitFor(() => expect(mockAutosave).toHaveBeenCalledTimes(2));
    // The first batch's keyed clear was attempted (and declined — newer batch
    // owns the mirror), proving we never blanket-cleared the second batch.
    expect(mockClearIfKey).toHaveBeenCalledWith('p1', 'idem-1');
    expect(mockClear).not.toHaveBeenCalled();
    // The queued second edit was actually sent — and it sees the FULL delta from
    // the first batch's saved snapshot (n:1) up to n:2.
    const secondCall = mockAutosave.mock.calls[1][0];
    expect(secondCall.idempotencyKey).toBe('idem-2');
    expect(secondCall.body.ops).toEqual([
      { op: 'plan_meta', meta: { name: 'v2' } },
    ]);
    // The second batch's 200 then clears its own key (now owns the mirror → true).
    await waitFor(() => expect(result.current.status).toBe('saved'));
    expect(mockClearIfKey).toHaveBeenCalledWith('p1', 'idem-2');
    expect(result.current.version).toBe(2);
    expect(result.current.hasPending).toBe(false);
  });
});

describe('useAutosave — P1: stable flush on unmount captures the latest edit', () => {
  it('writes the latest edit to the mirror on immediate unmount (no stale closure)', async () => {
    // Keep the request open: the point of this test is the mirror-FIRST capture
    // on unmount, not the network round-trip.
    const open = defer<ReturnType<typeof okResponse>>();
    mockAutosave.mockReturnValue(open.promise);

    const { rerender, unmount } = renderHook(
      ({ value }: { value: Copy }) =>
        useAutosave<Copy>({
          planId: 'p1',
          value,
          diff,
          baseRevisionIndex: 0,
          lockToken: TOKEN_A,
        }),
      { initialProps: { value: { n: 0 } } },
    );

    // Edit, then unmount IMMEDIATELY — before the debounce elapses. The stable
    // flush in the unmount cleanup must read latestValueRef (n:5), not a stale
    // closure that would see n:0 and compute no diff.
    rerender({ value: { n: 5 } });
    await act(async () => {
      unmount();
    });

    // The latest edit was mirrored on the way out (the kill-the-app guarantee).
    expect(mockWrite).toHaveBeenCalled();
    const mirrored = mockWrite.mock.calls[mockWrite.mock.calls.length - 1][0];
    expect(mirrored.batch.ops).toEqual([
      { op: 'plan_meta', meta: { name: 'v5' } },
    ]);
  });
});

describe('useAutosave — P1: aborts the obsolete request on unmount, retains the mirror', () => {
  it('aborts the in-flight network call on unmount and keeps the batch in the mirror for replay', async () => {
    let capturedSignal: AbortSignal | undefined;
    const open = defer<ReturnType<typeof okResponse>>();
    mockAutosave.mockImplementation(async (arg: { signal?: AbortSignal }) => {
      capturedSignal = arg.signal;
      return open.promise;
    });

    const { rerender, unmount } = renderHook(
      ({ value }: { value: Copy }) =>
        useAutosave<Copy>({
          planId: 'p1',
          value,
          diff,
          baseRevisionIndex: 0,
          lockToken: TOKEN_A,
        }),
      { initialProps: { value: { n: 0 } } },
    );

    // Drive a request into flight.
    rerender({ value: { n: 1 } });
    await act(async () => {
      jest.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS + 10);
    });
    await waitFor(() => expect(mockAutosave).toHaveBeenCalledTimes(1));
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal?.aborted).toBe(false);

    // A clear baseline: the mirror was written for this batch and never cleared
    // (the request is still open).
    const writesBefore = mockWrite.mock.calls.length;
    expect(writesBefore).toBeGreaterThan(0);

    // Unmount mid-flight → the obsolete network request is aborted (the batch is
    // already durable on disk), and the mirror is NOT cleared.
    await act(async () => {
      unmount();
    });
    await waitFor(() => expect(capturedSignal?.aborted).toBe(true));
    expect(mockClearIfKey).not.toHaveBeenCalled();
    expect(mockClear).not.toHaveBeenCalled();
  });
});

describe('useAutosave — P1: bounded backoff + NetInfo reconnect replay', () => {
  it('exposes a capped, jittered backoff schedule', () => {
    // Deterministic (no jitter) center values: 1s,2s,4s,8s,16s, capped at 16s.
    const noJitter = () => 0.5; // maps to jitterFactor 1.0
    expect(computeBackoffDelayMs(0, noJitter)).toBe(AUTOSAVE_BACKOFF_BASE_MS);
    expect(computeBackoffDelayMs(1, noJitter)).toBe(2000);
    expect(computeBackoffDelayMs(2, noJitter)).toBe(4000);
    expect(computeBackoffDelayMs(3, noJitter)).toBe(8000);
    expect(computeBackoffDelayMs(4, noJitter)).toBe(16000);
    // Cap holds beyond the ramp.
    expect(computeBackoffDelayMs(9, noJitter)).toBe(16000);
    // Jitter stays within ±25% of the center value.
    const lo = computeBackoffDelayMs(0, () => 0); // 1 - 0.25
    const hi = computeBackoffDelayMs(0, () => 1); // 1 + 0.25 (random()->~1)
    expect(lo).toBeGreaterThanOrEqual(Math.round(AUTOSAVE_BACKOFF_BASE_MS * 0.75));
    expect(hi).toBeLessThanOrEqual(Math.round(AUTOSAVE_BACKOFF_BASE_MS * 1.25));
  });

  it('schedules a backoff retry after a network error, then retries when the timer fires', async () => {
    mockAutosave
      .mockRejectedValueOnce(new WorkoutAutosaveApiError('network', 0, 'offline'))
      .mockResolvedValueOnce(okResponse({ head: 1, token: TOKEN_B }));

    const { result, rerender } = renderHook(
      ({ value }: { value: Copy }) =>
        useAutosave<Copy>({
          planId: 'p1',
          value,
          diff,
          baseRevisionIndex: 0,
          lockToken: TOKEN_A,
        }),
      { initialProps: { value: { n: 0 } } },
    );

    rerender({ value: { n: 1 } });
    await act(async () => {
      jest.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS + 10);
    });
    // First send failed transiently → offline, batch retained, backoff armed.
    await waitFor(() => expect(result.current.status).toBe('offline'));
    expect(mockAutosave).toHaveBeenCalledTimes(1);
    expect(result.current.hasPending).toBe(true);

    // Advance past the first backoff delay (≤ 1s * 1.25 = 1250ms) — the retry
    // fires and the second response lands a 200.
    await act(async () => {
      jest.advanceTimersByTime(AUTOSAVE_BACKOFF_BASE_MS * 2);
    });
    await waitFor(() => expect(mockAutosave).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.status).toBe('saved'));
    expect(result.current.version).toBe(1);
  });

  it('replays immediately on a NetInfo offline→online reconnect transition', async () => {
    mockAutosave
      .mockRejectedValueOnce(new WorkoutAutosaveApiError('network', 0, 'offline'))
      .mockResolvedValueOnce(okResponse({ head: 1, token: TOKEN_B }));

    const { result, rerender } = renderHook(
      ({ value }: { value: Copy }) =>
        useAutosave<Copy>({
          planId: 'p1',
          value,
          diff,
          baseRevisionIndex: 0,
          lockToken: TOKEN_A,
        }),
      { initialProps: { value: { n: 0 } } },
    );

    rerender({ value: { n: 1 } });
    await act(async () => {
      jest.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS + 10);
    });
    await waitFor(() => expect(result.current.status).toBe('offline'));
    expect(mockAutosave).toHaveBeenCalledTimes(1);

    // Simulate the radio dropping then coming back. The offline→online edge
    // resets the backoff and replays the pending batch immediately.
    await act(async () => {
      mockNetInfoHandler?.({ isConnected: false });
    });
    await act(async () => {
      mockNetInfoHandler?.({ isConnected: true });
    });
    await waitFor(() => expect(mockAutosave).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.status).toBe('saved'));
  });
});
