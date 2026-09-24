/**
 * useExtensionPairing — bounded first-identity wait (S6 R3 reimplementation).
 *
 * R2 finding S6-R2-A-01: when the coach identity never resolved (the shim
 * identity cache was unreadable after a fresh login), a deferred start() kept
 * the panel on "Preparing your secure pairing code…" indefinitely. The wait is
 * now bounded by IDENTITY_WAIT_MS and settles to the honest, retryable
 * `identityUnavailable` terminal — with no mint and no storage write.
 *
 * Two compositions are covered:
 *   1. the REAL useCurrentUser → lib/userCache → AsyncStorage shim chain with
 *      an empty store (the identity genuinely never resolves), and
 *   2. a controlled identity stub for the transitions (late resolution, retry,
 *      and the A→null sign-out window, which must NOT arm the timer).
 */
import { act, renderHook, cleanup } from '@testing-library/react-native';
import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('../../api/extensionPairApi', () => ({
  extensionPairApi: { init: jest.fn(), status: jest.fn() },
}));
const mockTrack = jest.fn();
jest.mock('../../analytics/posthog.service', () => ({
  track: (...a: unknown[]) => mockTrack(...a),
}));
jest.mock('../../services/sentry', () => ({ setSentryUser: jest.fn() }));

// Controlled identity: `undefined` means "use the REAL useCurrentUser".
let mockCurrentUserId: string | null | undefined;
jest.mock('../useCurrentUser', () => {
  const real = jest.requireActual('../useCurrentUser') as typeof import('../useCurrentUser');
  return {
    ...real,
    useCurrentUser: () => {
      if (mockCurrentUserId === undefined) return real.useCurrentUser();
      return mockCurrentUserId ? { id: mockCurrentUserId, email: 'c@x.io' } : null;
    },
  };
});

import { useExtensionPairing, IDENTITY_WAIT_MS } from '../useExtensionPairing';
import { extensionPairApi } from '../../api/extensionPairApi';
import { AnalyticsEvents } from '../../analytics/events';
import { readImportPairingMirror } from '../../storage/importPairingMirror';

const mockInit = extensionPairApi.init as jest.Mock;
const mockStatus = extensionPairApi.status as jest.Mock;

let appStateHandler: ((s: AppStateStatus) => void) | null = null;

beforeEach(async () => {
  await AsyncStorage.clear();
  mockCurrentUserId = undefined;
  jest.useFakeTimers();
  mockInit.mockReset();
  mockStatus.mockReset();
  mockTrack.mockClear();
  appStateHandler = null;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, cb) => {
    appStateHandler = cb;
    return { remove: jest.fn() } as NativeEventSubscription;
  });
});

afterEach(async () => {
  jest.clearAllTimers();
  jest.useRealTimers();
  await cleanup();
  jest.restoreAllMocks();
});

describe('bounded identity wait — real useCurrentUser over an empty identity store', () => {
  it('settles to identityUnavailable after IDENTITY_WAIT_MS instead of preparing forever; no mint, no storage', async () => {
    mockInit.mockResolvedValue({ data: { pairing_code: '482913', expires_at: 'x' } });
    const { result } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      result.current.start();
      await jest.advanceTimersByTimeAsync(IDENTITY_WAIT_MS - 1);
    });
    expect(result.current.status).toBe('idle'); // still within the bound
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2);
    });
    expect(result.current.status).toBe('identityUnavailable');
    expect(result.current.code).toBeNull();
    expect(mockInit).not.toHaveBeenCalled();
    expect(await AsyncStorage.getAllKeys()).toEqual([]);
    const failed = mockTrack.mock.calls.find((c) => c[0] === AnalyticsEvents.IMPORT_PAIRING_FAILED);
    expect(failed?.[1]).toEqual({ platform: 'truecoach', reason: 'identity' });
    expect(appStateHandler).not.toBeNull(); // the hook is otherwise fully mounted
  });

  it('retry from identityUnavailable is a visible new bounded wait, still without a blind mint', async () => {
    const { result } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      result.current.start();
      await jest.advanceTimersByTimeAsync(IDENTITY_WAIT_MS + 1);
    });
    expect(result.current.status).toBe('identityUnavailable');
    await act(async () => {
      result.current.retry();
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(result.current.status).toBe('idle');
    await act(async () => {
      await jest.advanceTimersByTimeAsync(IDENTITY_WAIT_MS + 1);
    });
    expect(result.current.status).toBe('identityUnavailable');
    expect(mockInit).not.toHaveBeenCalled();
  });

  it('does not fire after unmount (timer torn down)', async () => {
    const { result, unmount } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      result.current.start();
      await jest.advanceTimersByTimeAsync(10);
    });
    await unmount();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(IDENTITY_WAIT_MS + 10);
    });
    expect(mockTrack.mock.calls.find((c) => c[0] === AnalyticsEvents.IMPORT_PAIRING_FAILED)).toBeUndefined();
  });
});

describe('bounded identity wait — transitions', () => {
  it('identity arriving within the bound cancels the timer and mints the deferred intent', async () => {
    mockCurrentUserId = null;
    mockInit.mockResolvedValue({ data: { pairing_code: '777777', expires_at: 'x' } });
    mockStatus.mockResolvedValue({ data: { status: 'pending' } });
    const { result, rerender } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      result.current.start();
      await jest.advanceTimersByTimeAsync(IDENTITY_WAIT_MS / 2);
    });
    mockCurrentUserId = 'coach-1';
    await act(async () => {
      rerender({});
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(result.current.status).toBe('waiting');
    expect(result.current.code).toBe('777777');
    await act(async () => {
      await jest.advanceTimersByTimeAsync(IDENTITY_WAIT_MS * 2);
    });
    expect(result.current.status).toBe('waiting'); // the bounded-wait timer never fired
    expect(mockTrack.mock.calls.find((c) => c[0] === AnalyticsEvents.IMPORT_PAIRING_FAILED)).toBeUndefined();
  });

  it('identity arriving AFTER the bound supersedes identityUnavailable and mints once', async () => {
    mockCurrentUserId = null;
    mockInit.mockResolvedValue({ data: { pairing_code: '555555', expires_at: 'x' } });
    mockStatus.mockResolvedValue({ data: { status: 'pending' } });
    const { result, rerender } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      result.current.start();
      await jest.advanceTimersByTimeAsync(IDENTITY_WAIT_MS + 1);
    });
    expect(result.current.status).toBe('identityUnavailable');
    mockCurrentUserId = 'coach-1';
    await act(async () => {
      rerender({});
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(mockInit).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('waiting');
    expect((await readImportPairingMirror('coach-1'))?.code).toBe('555555');
  });

  it('A→null (sign-out window) after a resolved identity does NOT arm the bounded wait: stays idle', async () => {
    mockCurrentUserId = 'coach-1';
    mockInit.mockResolvedValue({ data: { pairing_code: '482913', expires_at: 'x' } });
    mockStatus.mockResolvedValue({ data: { status: 'pending' } });
    const { result, rerender } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      result.current.start();
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(result.current.status).toBe('waiting');
    mockCurrentUserId = null;
    await act(async () => {
      rerender({});
      await jest.advanceTimersByTimeAsync(IDENTITY_WAIT_MS * 3);
    });
    expect(result.current.status).toBe('idle');
    expect(mockTrack.mock.calls.find((c) => c[0] === AnalyticsEvents.IMPORT_PAIRING_FAILED)).toBeUndefined();
  });

  it('cancel from identityUnavailable is a plain local cancel', async () => {
    mockCurrentUserId = null;
    const { result } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      result.current.start();
      await jest.advanceTimersByTimeAsync(IDENTITY_WAIT_MS + 1);
    });
    await act(async () => {
      result.current.cancel();
    });
    expect(result.current.status).toBe('cancelled');
    expect(mockInit).not.toHaveBeenCalled();
  });
});
