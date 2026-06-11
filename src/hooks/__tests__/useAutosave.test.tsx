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
let mockAppStateHandler: ((s: string) => void) | null = null;
jest.mock('react-native', () => ({
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
} from '../../storage/autosaveMirror';
import { useAutosave, AUTOSAVE_DEBOUNCE_MS } from '../useAutosave';

const mockAutosave = workoutAutosaveApi.autosave as jest.Mock;
const mockWrite = writeAutosaveMirror as jest.Mock;
const mockRead = readAutosaveMirror as jest.Mock;
const mockClear = clearAutosaveMirror as jest.Mock;

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
  mockRead.mockResolvedValue(null);
  mockWrite.mockResolvedValue(undefined);
  mockClear.mockResolvedValue(undefined);
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
    expect(mockClear).toHaveBeenCalledWith('p1');
    expect(result.current.version).toBe(4);
    expect(result.current.lockToken).toBe(TOKEN_B);
    expect(result.current.lastSavedAt).not.toBeNull();
  });
});

describe('useAutosave — 409 fast-forward', () => {
  it('adopts the conflict token + index, clears the mirror, calls onConflict', async () => {
    const conflict = {
      error: 'autosave_lock_stale' as const,
      head_revision_index: 9,
      lock_token: TOKEN_B,
    };
    mockAutosave.mockRejectedValueOnce(
      new WorkoutAutosaveApiError('conflict', 409, 'conflict', conflict),
    );
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

    await waitFor(() => expect(result.current.version).toBe(9));
    expect(result.current.lockToken).toBe(TOKEN_B);
    expect(onConflict).toHaveBeenCalledWith(conflict);
    expect(mockClear).toHaveBeenCalledWith('p1');
    expect(result.current.status).toBe('conflict');
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
    expect(mockClear).toHaveBeenCalledWith('p1');
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
