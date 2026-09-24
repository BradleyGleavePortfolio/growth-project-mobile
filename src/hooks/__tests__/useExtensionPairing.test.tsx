/**
 * useExtensionPairing — state-machine tests (v0.3 import, PR-M2).
 *
 * Covers every behaviour the operator intent and the security gates ride on:
 *   - flag-OFF (default `enabled`) is fully inert: zero network, stays idle,
 *   - mint success → `waiting` with the server code (expiry is server-only),
 *   - poll `paired` → terminal `paired` (the truthful mobile terminal),
 *   - poll `expired` → `expired` (the ONLY expiry signal; no client clock),
 *   - unknown / garbled / malformed status FAILS CLOSED (keeps waiting, is NEVER
 *     promoted to paired/complete),
 *   - 401/403 → `authExpired`, 404 → `unavailable`, ≥5 transient errors → `failed`,
 *   - single-flight: no duplicate mint intent while minting or waiting,
 *   - cancel is a LOCAL abandon (no server cancel), teardown on unmount,
 *   - background pause / foreground resume of polling,
 *   - telemetry NEVER carries the pairing code or a token (PII-free).
 *
 * The api transport + analytics are mocked; we assert the hook's orchestration.
 */
import { act, renderHook, cleanup } from '@testing-library/react-native';
import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';
import { AxiosError, AxiosHeaders } from 'axios';

jest.mock('../../api/extensionPairApi', () => ({
  extensionPairApi: { init: jest.fn(), status: jest.fn() },
}));
const mockTrack = jest.fn();
jest.mock('../../analytics/posthog.service', () => ({
  track: (...a: unknown[]) => mockTrack(...a),
}));

// The durable mirror (M5-C) is user-scoped, so the hook needs a coach identity.
// The real storage module runs against the AsyncStorage jest mock so that
// persistence, restoration, and scoping are exercised end to end, not stubbed.
let mockCurrentUserId: string | null = 'coach-1';
jest.mock('../useCurrentUser', () => ({
  useCurrentUser: () => (mockCurrentUserId ? { id: mockCurrentUserId, email: 'c@x.io' } : null),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { PAIRING_REASON_COPY, useExtensionPairing } from '../useExtensionPairing';
import { extensionPairApi } from '../../api/extensionPairApi';
import { AnalyticsEvents } from '../../analytics/events';
import {
  IMPORT_PAIRING_MIRROR_VERSION,
  importPairingMirrorKey,
  readImportPairingMirror,
} from '../../storage/importPairingMirror';

const mockInit = extensionPairApi.init as jest.Mock;
const mockStatus = extensionPairApi.status as jest.Mock;

/** Seed a session as if a previous process had minted it and then been killed. */
async function seedMirror(userId: string, over: Record<string, unknown> = {}) {
  await AsyncStorage.setItem(
    importPairingMirrorKey(userId),
    JSON.stringify({
      version: IMPORT_PAIRING_MIRROR_VERSION,
      userId,
      platformId: 'truecoach',
      code: '482913',
      expiresAt: '2026-07-27T10:15:00.000Z',
      idempotencyKey: 'seeded-key-0001',
      setupNonce: 'seeded-nonce-0001',
      ...over,
    }),
  );
}

/** AxiosError with an optional C1 error-envelope body (`{ code }`). */
function axiosError(status: number, data: Record<string, unknown> = {}): AxiosError {
  return new AxiosError(`status ${status}`, 'ERR', undefined, undefined, {
    status,
    statusText: String(status),
    data,
    headers: {},
    config: { headers: new AxiosHeaders() },
  });
}

/** A future ISO instant so codes are live (not locally expired). */
function futureExpiry(ms = 5 * 60 * 1000): string {
  return new Date(Date.now() + ms).toISOString();
}

let appStateHandler: ((s: AppStateStatus) => void) | null = null;

beforeEach(async () => {
  await AsyncStorage.clear();
  mockCurrentUserId = 'coach-1';
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

describe('useExtensionPairing — flag-off / no-slug fail closed', () => {
  it('is inert when disabled: no network, stays idle', async () => {
    const { result } = await renderHook(() => useExtensionPairing('truecoach', false));
    await act(async () => {
      result.current.start();
    });
    expect(mockInit).not.toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
  });

  it('defaults to the OFF kill switch (featureFlags.extensionImport is false in test env)', async () => {
    const { result } = await renderHook(() => useExtensionPairing('truecoach'));
    await act(async () => {
      result.current.start();
    });
    expect(mockInit).not.toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
  });

  it('does not mint when the platform slug is null', async () => {
    const { result } = await renderHook(() => useExtensionPairing(null, true));
    await act(async () => {
      result.current.start();
    });
    expect(mockInit).not.toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
  });
});

describe('useExtensionPairing — mint', () => {
  it('mints a code and moves to waiting with the server code', async () => {
    mockInit.mockResolvedValue({ data: { pairing_code: '482913', expires_at: futureExpiry() } });
    mockStatus.mockResolvedValue({ data: { status: 'pending' } });

    const { result } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      result.current.start();
    });

    expect(mockInit).toHaveBeenCalledWith('truecoach', expect.any(String), expect.any(String));
    expect(result.current.status).toBe('waiting');
    expect(result.current.code).toBe('482913');
    const names = mockTrack.mock.calls.map((c) => c[0]);
    expect(names).toContain(AnalyticsEvents.IMPORT_PAIRING_STARTED);
    expect(names).toContain(AnalyticsEvents.IMPORT_PAIRING_CODE_READY);
  });

  it('treats a mint response missing the code as a retryable failure', async () => {
    mockInit.mockResolvedValue({ data: { expires_at: futureExpiry() } });
    const { result } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      result.current.start();
    });
    expect(result.current.status).toBe('failed');
  });

  it('maps a 401 mint error to authExpired', async () => {
    mockInit.mockRejectedValue(axiosError(401));
    const { result } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      result.current.start();
    });
    expect(result.current.status).toBe('authExpired');
  });

  it('maps a 404 mint error to unavailable', async () => {
    mockInit.mockRejectedValue(axiosError(404));
    const { result } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      result.current.start();
    });
    expect(result.current.status).toBe('unavailable');
  });

  it('maps a generic mint error to failed', async () => {
    mockInit.mockRejectedValue(new Error('network down'));
    const { result } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      result.current.start();
    });
    expect(result.current.status).toBe('failed');
  });
});

describe('useExtensionPairing — single-flight / no duplicate intent', () => {
  it('mints once when start is called twice in the same tick', async () => {
    let resolveInit: (v: unknown) => void = () => {};
    mockInit.mockImplementation(() => new Promise((r) => { resolveInit = r; }));

    const { result } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      result.current.start();
      result.current.start();
      resolveInit({ data: { pairing_code: '111111', expires_at: futureExpiry() } });
    });
    expect(mockInit).toHaveBeenCalledTimes(1);
  });

  it('does not re-mint while already waiting', async () => {
    mockInit.mockResolvedValue({ data: { pairing_code: '222222', expires_at: futureExpiry() } });
    mockStatus.mockResolvedValue({ data: { status: 'pending' } });
    const { result } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      result.current.start();
    });
    expect(result.current.status).toBe('waiting');
    await act(async () => {
      result.current.start();
    });
    expect(mockInit).toHaveBeenCalledTimes(1);
  });
});

describe('useExtensionPairing — poll lifecycle', () => {
  async function mintThenWaiting(statusSeq: () => void) {
    mockInit.mockResolvedValue({ data: { pairing_code: '482913', expires_at: futureExpiry() } });
    statusSeq();
    const hook = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      hook.result.current.start();
    });
    return hook;
  }

  it('promotes to paired when the poll returns paired', async () => {
    const { result } = await mintThenWaiting(() => mockStatus.mockResolvedValue({ data: { status: 'paired' } }));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2000);
    });
    expect(result.current.status).toBe('paired');
    expect(mockTrack.mock.calls.map((c) => c[0])).toContain(AnalyticsEvents.IMPORT_PAIRED);
  });

  it('moves to expired when the poll returns expired', async () => {
    const { result } = await mintThenWaiting(() => mockStatus.mockResolvedValue({ data: { status: 'expired' } }));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2000);
    });
    expect(result.current.status).toBe('expired');
  });

  it('FAILS CLOSED on an unknown status: stays waiting, never promoted to paired', async () => {
    const { result } = await mintThenWaiting(() => mockStatus.mockResolvedValue({ data: { status: 'definitely_paired' } }));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2000);
    });
    expect(result.current.status).toBe('waiting');
    expect(mockTrack.mock.calls.map((c) => c[0])).not.toContain(AnalyticsEvents.IMPORT_PAIRED);
  });

  it('FAILS CLOSED on a malformed (empty) status body: stays waiting', async () => {
    const { result } = await mintThenWaiting(() => mockStatus.mockResolvedValue({ data: {} }));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2000);
    });
    expect(result.current.status).toBe('waiting');
  });

  it('backs off then eventually pairs (bounded exponential backoff)', async () => {
    mockInit.mockResolvedValue({ data: { pairing_code: '482913', expires_at: futureExpiry() } });
    mockStatus
      .mockResolvedValueOnce({ data: { status: 'pending' } })
      .mockResolvedValueOnce({ data: { status: 'pending' } })
      .mockResolvedValue({ data: { status: 'paired' } });
    const { result } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      result.current.start();
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2000); // first poll → pending
      await jest.advanceTimersByTimeAsync(3000); // backoff 2000*1.5 → pending
      await jest.advanceTimersByTimeAsync(4500); // backoff → paired
    });
    expect(result.current.status).toBe('paired');
  });

  it('maps a 401 during polling to authExpired', async () => {
    const { result } = await mintThenWaiting(() => mockStatus.mockRejectedValue(axiosError(403)));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2000);
    });
    expect(result.current.status).toBe('authExpired');
  });

  it('maps a 404 during polling to unavailable', async () => {
    const { result } = await mintThenWaiting(() => mockStatus.mockRejectedValue(axiosError(404)));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2000);
    });
    expect(result.current.status).toBe('unavailable');
  });

  it('tolerates transient errors but fails after the cap of consecutive failures', async () => {
    const { result } = await mintThenWaiting(() => mockStatus.mockRejectedValue(axiosError(500)));
    await act(async () => {
      // 5 consecutive failures at growing backoff intervals.
      await jest.advanceTimersByTimeAsync(2000);
      await jest.advanceTimersByTimeAsync(3000);
      await jest.advanceTimersByTimeAsync(4500);
      await jest.advanceTimersByTimeAsync(6750);
      await jest.advanceTimersByTimeAsync(15000);
    });
    expect(result.current.status).toBe('failed');
  });

  it('ignores the client clock: a code whose server expires_at is already past stays waiting while polls say pending', async () => {
    // The server is the ONLY expiry authority — the hook never reads its own
    // clock, so a stale/past expires_at must NOT self-expire the code.
    mockInit.mockResolvedValue({ data: { pairing_code: '482913', expires_at: new Date(Date.now() - 60_000).toISOString() } });
    mockStatus.mockResolvedValue({ data: { status: 'pending' } });
    const { result } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      result.current.start();
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(60_000);
    });
    expect(result.current.status).toBe('waiting');
    expect(mockTrack.mock.calls.map((c) => c[0])).not.toContain(AnalyticsEvents.IMPORT_PAIRING_EXPIRED);
  });

  it('expires only when the server /status contract returns expired', async () => {
    mockInit.mockResolvedValue({ data: { pairing_code: '482913', expires_at: futureExpiry() } });
    mockStatus
      .mockResolvedValueOnce({ data: { status: 'pending' } })
      .mockResolvedValue({ data: { status: 'expired' } });
    const { result } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      result.current.start();
    });
    expect(result.current.status).toBe('waiting');
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2000); // first poll → pending
      await jest.advanceTimersByTimeAsync(3000); // next poll → expired
    });
    expect(result.current.status).toBe('expired');
    expect(mockTrack.mock.calls.map((c) => c[0])).toContain(AnalyticsEvents.IMPORT_PAIRING_EXPIRED);
  });

  it('stays waiting on repeated pending polls (never self-promotes)', async () => {
    mockInit.mockResolvedValue({ data: { pairing_code: '482913', expires_at: futureExpiry() } });
    mockStatus.mockResolvedValue({ data: { status: 'pending' } });
    const { result } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      result.current.start();
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2000);
      await jest.advanceTimersByTimeAsync(3000);
      await jest.advanceTimersByTimeAsync(4500);
    });
    expect(result.current.status).toBe('waiting');
    expect(mockTrack.mock.calls.map((c) => c[0])).not.toContain(AnalyticsEvents.IMPORT_PAIRED);
  });

  it('stops polling once paired (paired is terminal)', async () => {
    mockInit.mockResolvedValue({ data: { pairing_code: '482913', expires_at: futureExpiry() } });
    mockStatus.mockResolvedValue({ data: { status: 'paired' } });
    const { result } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      result.current.start();
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2000);
    });
    expect(result.current.status).toBe('paired');
    const callsAtPair = mockStatus.mock.calls.length;
    await act(async () => {
      await jest.advanceTimersByTimeAsync(30_000);
    });
    expect(mockStatus.mock.calls.length).toBe(callsAtPair);
    const pairedEvents = mockTrack.mock.calls.filter((c) => c[0] === AnalyticsEvents.IMPORT_PAIRED);
    expect(pairedEvents).toHaveLength(1);
  });

  it('stops polling once expired (expired is terminal)', async () => {
    mockInit.mockResolvedValue({ data: { pairing_code: '482913', expires_at: futureExpiry() } });
    mockStatus.mockResolvedValue({ data: { status: 'expired' } });
    const { result } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      result.current.start();
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2000);
    });
    expect(result.current.status).toBe('expired');
    const callsAtExpiry = mockStatus.mock.calls.length;
    await act(async () => {
      await jest.advanceTimersByTimeAsync(30_000);
    });
    expect(mockStatus.mock.calls.length).toBe(callsAtExpiry);
  });

  it('recovers: a transient error followed by pending resets the failure budget', async () => {
    mockInit.mockResolvedValue({ data: { pairing_code: '482913', expires_at: futureExpiry() } });
    mockStatus
      .mockRejectedValueOnce(axiosError(500))
      .mockRejectedValueOnce(axiosError(500))
      .mockResolvedValueOnce({ data: { status: 'pending' } })
      .mockRejectedValueOnce(axiosError(500))
      .mockRejectedValueOnce(axiosError(500))
      .mockResolvedValue({ data: { status: 'paired' } });
    const { result } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      result.current.start();
    });
    await act(async () => {
      // Five sparse failures never *consecutively* hit the cap because a pending
      // in the middle resets the counter — so we still pair, not fail.
      for (let i = 0; i < 6; i += 1) await jest.advanceTimersByTimeAsync(15_000);
    });
    expect(result.current.status).toBe('paired');
  });
});

describe('useExtensionPairing — cancel / retry / teardown', () => {
  it('cancel is a local abandon → cancelled, with the cancel event', async () => {
    mockInit.mockResolvedValue({ data: { pairing_code: '482913', expires_at: futureExpiry() } });
    mockStatus.mockResolvedValue({ data: { status: 'pending' } });
    const { result } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      result.current.start();
    });
    await act(async () => {
      result.current.cancel();
    });
    expect(result.current.status).toBe('cancelled');
    expect(result.current.code).toBeNull();
    expect(mockTrack.mock.calls.map((c) => c[0])).toContain(AnalyticsEvents.IMPORT_PAIRING_CANCELLED);
  });

  it('retry re-mints after a failure', async () => {
    mockInit.mockRejectedValueOnce(new Error('down'));
    const { result } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      result.current.start();
    });
    expect(result.current.status).toBe('failed');
    mockInit.mockResolvedValue({ data: { pairing_code: '999999', expires_at: futureExpiry() } });
    mockStatus.mockResolvedValue({ data: { status: 'pending' } });
    await act(async () => {
      result.current.retry();
    });
    expect(result.current.status).toBe('waiting');
    expect(mockInit).toHaveBeenCalledTimes(2);
  });

  it('retry re-mints from an expired terminal', async () => {
    mockInit.mockResolvedValue({ data: { pairing_code: '111111', expires_at: futureExpiry() } });
    mockStatus.mockResolvedValue({ data: { status: 'expired' } });
    const { result } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      result.current.start();
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2000);
    });
    expect(result.current.status).toBe('expired');
    mockInit.mockResolvedValue({ data: { pairing_code: '222222', expires_at: futureExpiry() } });
    mockStatus.mockResolvedValue({ data: { status: 'pending' } });
    await act(async () => {
      result.current.retry();
    });
    expect(result.current.status).toBe('waiting');
    expect(result.current.code).toBe('222222');
    expect(mockInit).toHaveBeenCalledTimes(2);
  });

  it('retry re-mints from a cancelled state', async () => {
    mockInit.mockResolvedValue({ data: { pairing_code: '111111', expires_at: futureExpiry() } });
    mockStatus.mockResolvedValue({ data: { status: 'pending' } });
    const { result } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      result.current.start();
    });
    await act(async () => {
      result.current.cancel();
    });
    expect(result.current.status).toBe('cancelled');
    mockInit.mockResolvedValue({ data: { pairing_code: '333333', expires_at: futureExpiry() } });
    await act(async () => {
      result.current.retry();
    });
    expect(result.current.status).toBe('waiting');
    expect(result.current.code).toBe('333333');
  });

  it('cancel while still minting drops the intent to cancelled with no code', async () => {
    let resolveInit: (v: unknown) => void = () => {};
    mockInit.mockImplementation(() => new Promise((r) => { resolveInit = r; }));
    const { result } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      result.current.start();
    });
    expect(result.current.status).toBe('minting');
    await act(async () => {
      result.current.cancel();
      resolveInit({ data: { pairing_code: '482913', expires_at: futureExpiry() } });
    });
    expect(result.current.status).toBe('cancelled');
    expect(result.current.code).toBeNull();
    expect(mockTrack.mock.calls.map((c) => c[0])).toContain(AnalyticsEvents.IMPORT_PAIRING_CANCELLED);
  });

  it('cancel from idle is a no-op that emits no cancel event', async () => {
    const { result } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      result.current.cancel();
    });
    expect(result.current.status).toBe('cancelled');
    expect(mockTrack.mock.calls.map((c) => c[0])).not.toContain(AnalyticsEvents.IMPORT_PAIRING_CANCELLED);
  });

  it('does not throw / no late setState after unmount tears down timers', async () => {
    mockInit.mockResolvedValue({ data: { pairing_code: '482913', expires_at: futureExpiry() } });
    mockStatus.mockResolvedValue({ data: { status: 'pending' } });
    const { result, unmount } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      result.current.start();
    });
    expect(result.current.status).toBe('waiting');
    await act(async () => {
      await unmount();
    });
    // Advancing past several poll intervals must not throw or promote.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(30000);
    });
    expect(mockStatus).not.toHaveBeenCalled();
  });
});

describe('useExtensionPairing — background / foreground', () => {
  it('pauses polling in the background and resumes on foreground', async () => {
    mockInit.mockResolvedValue({ data: { pairing_code: '482913', expires_at: futureExpiry() } });
    mockStatus.mockResolvedValue({ data: { status: 'pending' } });
    const { result } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      result.current.start();
    });
    // Background: timers cleared, no polling.
    await act(async () => {
      appStateHandler?.('background');
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(10000);
    });
    const callsWhileBackgrounded = mockStatus.mock.calls.length;
    // Foreground: resumes a poll promptly.
    mockStatus.mockResolvedValue({ data: { status: 'paired' } });
    await act(async () => {
      appStateHandler?.('active');
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(result.current.status).toBe('paired');
    expect(mockStatus.mock.calls.length).toBeGreaterThan(callsWhileBackgrounded);
  });

  it('keeps the code alive (stays waiting) while backgrounded', async () => {
    mockInit.mockResolvedValue({ data: { pairing_code: '482913', expires_at: futureExpiry() } });
    mockStatus.mockResolvedValue({ data: { status: 'pending' } });
    const { result } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      result.current.start();
    });
    await act(async () => {
      appStateHandler?.('background');
      await jest.advanceTimersByTimeAsync(10000);
    });
    expect(result.current.status).toBe('waiting');
    expect(result.current.code).toBe('482913');
  });

  it('foregrounding resumes polling; a server expired terminal on the resume poll resolves to expired', async () => {
    mockInit.mockResolvedValue({ data: { pairing_code: '482913', expires_at: futureExpiry() } });
    mockStatus.mockResolvedValue({ data: { status: 'pending' } });
    const { result } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      result.current.start();
    });
    // Background BEFORE the poll timer can fire, so no poll runs while hidden.
    await act(async () => {
      appStateHandler?.('background');
      await jest.advanceTimersByTimeAsync(5000);
    });
    expect(result.current.status).toBe('waiting');
    // On foreground the resumed poll hits the server, which now reports expired.
    mockStatus.mockResolvedValue({ data: { status: 'expired' } });
    await act(async () => {
      appStateHandler?.('active');
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(result.current.status).toBe('expired');
    expect(mockTrack.mock.calls.map((c) => c[0])).toContain(AnalyticsEvents.IMPORT_PAIRING_EXPIRED);
  });
});

describe('useExtensionPairing — single-flight poll (no concurrent /status)', () => {
  it('a foreground resume while a poll is in flight issues only ONE /status request', async () => {
    mockInit.mockResolvedValue({ data: { pairing_code: '482913', expires_at: futureExpiry() } });
    // First poll parks in flight; later polls resolve pending.
    let resolveStatus: (v: unknown) => void = () => {};
    mockStatus.mockImplementationOnce(() => new Promise((r) => { resolveStatus = r; }));
    mockStatus.mockResolvedValue({ data: { status: 'pending' } });

    const { result } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      result.current.start();
    });
    // Fire the first poll: it awaits the parked /status promise (in flight).
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2000);
    });
    expect(mockStatus).toHaveBeenCalledTimes(1);

    // Foreground while that poll is still outstanding must NOT fire a second one.
    await act(async () => {
      appStateHandler?.('active');
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(mockStatus).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('waiting');

    // Settle the in-flight poll → the guard releases and polling continues.
    await act(async () => {
      resolveStatus({ data: { status: 'pending' } });
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(3000);
    });
    expect(mockStatus.mock.calls.length).toBeGreaterThan(1);
    expect(result.current.status).toBe('waiting');
  });

  it('releases the guard on a poll error so a later poll can still run', async () => {
    mockInit.mockResolvedValue({ data: { pairing_code: '482913', expires_at: futureExpiry() } });
    let rejectStatus: (e: unknown) => void = () => {};
    mockStatus.mockImplementationOnce(() => new Promise((_res, rej) => { rejectStatus = rej; }));
    mockStatus.mockResolvedValue({ data: { status: 'pending' } });

    const { result } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      result.current.start();
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2000);
    });
    expect(mockStatus).toHaveBeenCalledTimes(1);

    // A concurrent trigger during the in-flight poll still issues no duplicate.
    await act(async () => {
      appStateHandler?.('active');
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(mockStatus).toHaveBeenCalledTimes(1);

    // The in-flight poll fails transiently: guard must release, backoff scheduled.
    await act(async () => {
      rejectStatus(axiosError(500));
    });
    expect(result.current.status).toBe('waiting');
    await act(async () => {
      await jest.advanceTimersByTimeAsync(3000);
    });
    expect(mockStatus.mock.calls.length).toBeGreaterThan(1);
    expect(result.current.status).toBe('waiting');
  });

  it('a stale in-flight poll from an abandoned code cannot mutate the re-minted session', async () => {
    mockInit.mockResolvedValueOnce({ data: { pairing_code: '111111', expires_at: futureExpiry() } });
    let resolveStale: (v: unknown) => void = () => {};
    mockStatus.mockImplementationOnce(() => new Promise((r) => { resolveStale = r; }));

    const { result } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      result.current.start();
    });
    // First poll goes in flight against code 111111, then the code is abandoned.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2000);
    });
    await act(async () => {
      result.current.cancel();
    });
    expect(result.current.status).toBe('cancelled');

    // Re-mint a fresh code and resume polling on the new session.
    mockInit.mockResolvedValueOnce({ data: { pairing_code: '222222', expires_at: futureExpiry() } });
    mockStatus.mockResolvedValue({ data: { status: 'pending' } });
    await act(async () => {
      result.current.retry();
    });
    expect(result.current.code).toBe('222222');

    // The OLD poll now resolves as `paired`: it must be discarded, never promote
    // the new session, and must not leave the poll guard stuck.
    await act(async () => {
      resolveStale({ data: { status: 'paired' } });
    });
    expect(result.current.status).toBe('waiting');
    expect(result.current.code).toBe('222222');
    expect(mockTrack.mock.calls.map((c) => c[0])).not.toContain(AnalyticsEvents.IMPORT_PAIRED);

    // The re-minted session keeps polling normally (guard was not leaked).
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2000);
    });
    expect(result.current.status).toBe('waiting');
    expect(mockStatus.mock.calls.length).toBeGreaterThan(1);
  });
});

describe('useExtensionPairing — PII-free telemetry', () => {
  it('never emits the pairing code or a token in any tracked event', async () => {
    mockInit.mockResolvedValue({ data: { pairing_code: '482913', expires_at: futureExpiry() } });
    mockStatus.mockResolvedValue({ data: { status: 'paired' } });
    const { result } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      result.current.start();
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2000);
    });
    expect(result.current.status).toBe('paired');
    mockTrack.mock.calls.forEach(([, props]) => {
      const serialized = JSON.stringify(props ?? {});
      expect(serialized).not.toContain('482913');
      expect(serialized).not.toMatch(/\b\d{6}\b/);
      expect(serialized).not.toMatch(/token|password|secret|bearer/i);
    });
  });

  it('attaches only the platform slug to the started event', async () => {
    mockInit.mockResolvedValue({ data: { pairing_code: '482913', expires_at: futureExpiry() } });
    mockStatus.mockResolvedValue({ data: { status: 'pending' } });
    const { result } = await renderHook(() => useExtensionPairing('everfit', true));
    await act(async () => {
      result.current.start();
    });
    const started = mockTrack.mock.calls.find((c) => c[0] === AnalyticsEvents.IMPORT_PAIRING_STARTED);
    expect(started?.[1]).toEqual({ platform: 'everfit' });
  });

  it('emits started before code_ready, and code_ready exactly once', async () => {
    mockInit.mockResolvedValue({ data: { pairing_code: '482913', expires_at: futureExpiry() } });
    mockStatus.mockResolvedValue({ data: { status: 'pending' } });
    const { result } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      result.current.start();
    });
    const names = mockTrack.mock.calls.map((c) => c[0]);
    const startedIdx = names.indexOf(AnalyticsEvents.IMPORT_PAIRING_STARTED);
    const readyIdx = names.indexOf(AnalyticsEvents.IMPORT_PAIRING_CODE_READY);
    expect(startedIdx).toBeGreaterThanOrEqual(0);
    expect(readyIdx).toBeGreaterThan(startedIdx);
    expect(names.filter((n) => n === AnalyticsEvents.IMPORT_PAIRING_CODE_READY)).toHaveLength(1);
  });

  it('emits a failed event carrying only a coarse reason — no code or token', async () => {
    mockInit.mockRejectedValue(new Error('network down'));
    const { result } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      result.current.start();
    });
    expect(result.current.status).toBe('failed');
    const failed = mockTrack.mock.calls.find((c) => c[0] === AnalyticsEvents.IMPORT_PAIRING_FAILED);
    expect(failed?.[1]).toEqual({ platform: 'truecoach', reason: 'network' });
    const serialized = JSON.stringify(failed?.[1] ?? {});
    expect(serialized).not.toMatch(/token|secret|bearer/i);
  });

  it('tags an auth failure with the auth reason (still no code)', async () => {
    mockInit.mockRejectedValue(axiosError(401));
    const { result } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      result.current.start();
    });
    const failed = mockTrack.mock.calls.find((c) => c[0] === AnalyticsEvents.IMPORT_PAIRING_FAILED);
    expect(failed?.[1]).toEqual({ platform: 'truecoach', reason: 'auth' });
  });

  it('attaches only the platform slug to the expired event', async () => {
    mockInit.mockResolvedValue({ data: { pairing_code: '482913', expires_at: futureExpiry() } });
    mockStatus.mockResolvedValue({ data: { status: 'expired' } });
    const { result } = await renderHook(() => useExtensionPairing('everfit', true));
    await act(async () => {
      result.current.start();
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2000);
    });
    const expired = mockTrack.mock.calls.find((c) => c[0] === AnalyticsEvents.IMPORT_PAIRING_EXPIRED);
    expect(expired?.[1]).toEqual({ platform: 'everfit' });
  });
});

/**
 * M5-C — durability across process death.
 *
 * The import flow deliberately sends the coach out of the app to a browser, so
 * being killed mid-pairing is an ordinary event. Before M5-C the code lived only
 * in useState: the coach came back to the intro screen while a live server-side
 * session stayed open with no way to see or abandon it.
 */
describe('useExtensionPairing — durable pairing session (M5-C)', () => {
  it('persists the minted session under the signed-in coach key', async () => {
    mockInit.mockResolvedValue({
      data: { pairing_code: '482913', expires_at: '2026-07-27T10:15:00.000Z' },
    });
    mockStatus.mockResolvedValue({ data: { status: 'pending' } });

    const { result } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      result.current.start();
    });

    const stored = await readImportPairingMirror('coach-1');
    expect(stored).toEqual({
      version: IMPORT_PAIRING_MIRROR_VERSION,
      userId: 'coach-1',
      platformId: 'truecoach',
      code: '482913',
      // Rule 16: the server's stamp is kept verbatim, never re-derived locally.
      expiresAt: '2026-07-27T10:15:00.000Z',
      idempotencyKey: mockInit.mock.calls[0][1],
      setupNonce: mockInit.mock.calls[0][2],
    });
  });

  it('never mints blind while the coach identity is still unknown (no user, no network)', async () => {
    // A mint that cannot be mirrored is exactly the orphaned-session hazard the
    // mirror exists to prevent, and a blind mint would server-expire a session
    // the coach may already be typing into the extension. Inside
    // CoachNavigator the identity always resolves, so this is a bounded wait.
    mockCurrentUserId = null;
    mockInit.mockResolvedValue({ data: { pairing_code: '482913', expires_at: 'x' } });
    mockStatus.mockResolvedValue({ data: { status: 'pending' } });
    const { result } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      result.current.start();
      await jest.advanceTimersByTimeAsync(50);
    });
    expect(mockInit).not.toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
    expect(await AsyncStorage.getAllKeys()).toEqual([]);
  });

  it('mints once the identity resolves after a start() that arrived while it was unknown', async () => {
    // Real composition: useCurrentUser() is null on its first render and only
    // resolves after an async storage read. The panel's mount-effect start()
    // must be deferred to that moment, not dropped and not executed blind.
    mockCurrentUserId = null;
    mockInit.mockResolvedValue({ data: { pairing_code: '777777', expires_at: 'x' } });
    mockStatus.mockResolvedValue({ data: { status: 'pending' } });
    const { result, rerender } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      result.current.start();
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(mockInit).not.toHaveBeenCalled();

    mockCurrentUserId = 'coach-1';
    await act(async () => {
      rerender({});
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(mockInit).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('waiting');
    expect(result.current.code).toBe('777777');
    expect((await readImportPairingMirror('coach-1'))?.code).toBe('777777');
  });

  it('restores a killed session into waiting and polls immediately', async () => {
    await seedMirror('coach-1');
    mockStatus.mockResolvedValue({ data: { status: 'pending' } });

    const { result } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });

    expect(result.current.status).toBe('waiting');
    expect(result.current.code).toBe('482913');
    // Restoration is not a mint: no second server-side session is opened.
    expect(mockInit).not.toHaveBeenCalled();
    expect(mockStatus).toHaveBeenCalledWith('482913');
    expect(mockTrack.mock.calls.map((c) => c[0])).toContain(
      AnalyticsEvents.IMPORT_PAIRING_RESTORED,
    );
  });

  it('restores a killed session when the coach identity resolves ASYNCHRONOUSLY (null on first render)', async () => {
    // The production timing (S6-A2 / S6-B-3): first render has no user, the
    // panel calls start() immediately, then the user arrives. The restore must
    // win and no second server-side session may be opened.
    await seedMirror('coach-1');
    mockCurrentUserId = null;
    mockInit.mockResolvedValue({ data: { pairing_code: '999999', expires_at: 'x' } });
    mockStatus.mockResolvedValue({ data: { status: 'pending' } });

    const { result, rerender } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      result.current.start(); // what ExtensionPairingPanel does on mount
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(result.current.status).toBe('idle');
    expect(mockInit).not.toHaveBeenCalled();
    expect(mockStatus).not.toHaveBeenCalled();

    mockCurrentUserId = 'coach-1';
    await act(async () => {
      rerender({});
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(result.current.status).toBe('waiting');
    expect(result.current.code).toBe('482913');
    expect(mockInit).not.toHaveBeenCalled();
    expect(mockStatus).toHaveBeenCalledWith('482913');
    expect(mockTrack.mock.calls.map((c) => c[0])).toContain(
      AnalyticsEvents.IMPORT_PAIRING_RESTORED,
    );
  });

  it('never shows a session minted for another platform under this one: discards it and mints afresh', async () => {
    await seedMirror('coach-1', { platformId: 'trainerize', code: '424242' });
    mockInit.mockResolvedValue({ data: { pairing_code: '131313', expires_at: 'x' } });
    mockStatus.mockResolvedValue({ data: { status: 'pending' } });

    const { result } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      result.current.start();
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(mockStatus).not.toHaveBeenCalledWith('424242');
    expect(mockInit).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('waiting');
    expect(result.current.code).toBe('131313');
    expect(mockTrack.mock.calls.map((c) => c[0])).not.toContain(
      AnalyticsEvents.IMPORT_PAIRING_RESTORED,
    );
    // The superseded record is replaced by the new session, not left behind.
    expect((await readImportPairingMirror('coach-1'))?.platformId).toBe('truecoach');
  });

  it('leaves a mirrored session untouched when mounted without a platform slug', async () => {
    // Nothing can mint without a slug, so nothing supersedes the record; it
    // must survive for the mount that does carry the right platform.
    await seedMirror('coach-1', { platformId: 'trainerize' });
    const { result } = await renderHook(() => useExtensionPairing(null, true));
    await act(async () => {
      result.current.start();
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(result.current.status).toBe('idle');
    expect(mockInit).not.toHaveBeenCalled();
    expect(mockStatus).not.toHaveBeenCalled();
    expect((await readImportPairingMirror('coach-1'))?.platformId).toBe('trainerize');
  });

  it('restores a session whose stored expiry is long past — the server decides', async () => {
    // Rule 16. A client-clock check here would silently strand a session the
    // server may still consider live; instead we poll and let /status answer.
    await seedMirror('coach-1', { expiresAt: '2001-01-01T00:00:00.000Z' });
    mockStatus.mockResolvedValue({ data: { status: 'expired' } });

    const { result } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });

    expect(mockStatus).toHaveBeenCalledWith('482913');
    expect(result.current.status).toBe('expired');
  });

  it('never restores another coach\'s session', async () => {
    await seedMirror('coach-2', { code: '999999' });
    mockStatus.mockResolvedValue({ data: { status: 'pending' } });
    const { result } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(result.current.status).toBe('idle');
    expect(mockStatus).not.toHaveBeenCalled();
  });

  it.each<[string, Record<string, unknown>]>([
    ['a drifted schema version', { version: IMPORT_PAIRING_MIRROR_VERSION + 1 }],
    ['a v1 payload (no setup nonce)', { version: 1, setupNonce: undefined }],
    ['a cross-user payload', { userId: 'coach-2' }],
    ['an empty code', { code: '' }],
  ])('ignores %s and stays idle', async (_label, over) => {
    await seedMirror('coach-1', over);
    const { result } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(result.current.status).toBe('idle');
    expect(mockStatus).not.toHaveBeenCalled();
  });

  it('ignores an unparseable record and stays idle', async () => {
    await AsyncStorage.setItem(importPairingMirrorKey('coach-1'), '{not json');
    const { result } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(result.current.status).toBe('idle');
    expect(await AsyncStorage.getItem(importPairingMirrorKey('coach-1'))).toBeNull();
  });

  it('reads no storage at all when the kill switch is OFF', async () => {
    await seedMirror('coach-1');
    const { result } = await renderHook(() => useExtensionPairing('truecoach', false));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(result.current.status).toBe('idle');
    expect(mockStatus).not.toHaveBeenCalled();
    // The record survives untouched: a flag-off build must not destroy state a
    // flag-on build would need.
    expect(await AsyncStorage.getItem(importPairingMirrorKey('coach-1'))).not.toBeNull();
  });

  it('defers a start() that raced hydration instead of dropping it', async () => {
    // ExtensionPairingPanel calls start() from its own mount effect, which fires
    // before the async mirror read resolves. Minting there would open a second
    // server-side session on top of the one being restored.
    mockInit.mockResolvedValue({ data: { pairing_code: '777777', expires_at: 'x' } });
    mockStatus.mockResolvedValue({ data: { status: 'pending' } });
    const { result } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      result.current.start();
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(mockInit).toHaveBeenCalledTimes(1);
    expect(result.current.code).toBe('777777');
  });

  it('cancel is a durable local abandon: the record is erased', async () => {
    mockInit.mockResolvedValue({ data: { pairing_code: '482913', expires_at: 'x' } });
    mockStatus.mockResolvedValue({ data: { status: 'pending' } });
    const { result } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      result.current.start();
    });
    expect(await readImportPairingMirror('coach-1')).not.toBeNull();

    await act(async () => {
      result.current.cancel();
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(result.current.status).toBe('cancelled');
    expect(await readImportPairingMirror('coach-1')).toBeNull();
  });

  it.each<['paired' | 'expired', string]>([
    ['paired', 'paired'],
    ['expired', 'expired'],
  ])('erases the record when the server reports %s', async (wire, expected) => {
    mockInit.mockResolvedValue({ data: { pairing_code: '482913', expires_at: 'x' } });
    mockStatus.mockResolvedValue({ data: { status: wire } });
    const { result } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      result.current.start();
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2000);
    });
    expect(result.current.status).toBe(expected);
    expect(await readImportPairingMirror('coach-1')).toBeNull();
  });

  it('does not persist a mint that never produced a code', async () => {
    mockInit.mockResolvedValue({ data: { expires_at: 'x' } });
    const { result } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      result.current.start();
    });
    expect(result.current.status).toBe('failed');
    expect(await readImportPairingMirror('coach-1')).toBeNull();
  });

  it('still shows the code when the durable write fails', async () => {
    // Degraded durability must not become a dead flow.
    const spy = jest
      .spyOn(AsyncStorage, 'setItem')
      .mockRejectedValueOnce(new Error('disk full'));
    mockInit.mockResolvedValue({ data: { pairing_code: '482913', expires_at: 'x' } });
    mockStatus.mockResolvedValue({ data: { status: 'pending' } });
    const { result } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      result.current.start();
    });
    expect(result.current.status).toBe('waiting');
    expect(result.current.code).toBe('482913');
    spy.mockRestore();
  });
});

/**
 * Same-mount identity change. RootNavigator replaces the whole coach tree on
 * sign-out/sign-in, so in the shipped app a mounted hook only sees A→null (the
 * sign-out window before the tree swaps). The hook nevertheless owns its
 * session by coach id so that A→null and A→B are safe by construction: the
 * old owner's code, key and poll are retired in memory (their storage record
 * is left alone — sign-out wipes it), and a /pair/init that lands after the
 * change is never shown or mirrored under the new owner.
 */
describe('useExtensionPairing — session ownership across identity changes', () => {
  it('A→null (sign-out window): retires the code and stops polling, touching no storage', async () => {
    await seedMirror('coach-1');
    mockStatus.mockResolvedValue({ data: { status: 'pending' } });
    const { result, rerender } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(result.current.status).toBe('waiting');
    const pollsBefore = mockStatus.mock.calls.length;

    mockCurrentUserId = null;
    await act(async () => {
      rerender({});
    });
    await act(async () => {
      // > 3 × POLL_MAX_MS: any surviving poll timer would have fired by now.
      await jest.advanceTimersByTimeAsync(45_000);
    });
    expect(result.current.status).toBe('idle');
    expect(result.current.code).toBeNull();
    expect(mockStatus.mock.calls.length).toBe(pollsBefore);
    expect(mockInit).not.toHaveBeenCalled();
    // Coach A's record is A's; the hook neither clears nor rewrites it here.
    expect((await readImportPairingMirror('coach-1'))?.code).toBe('482913');
  });

  it('A→B: never shows A’s code to B; hydrates B’s own session and leaves A’s record alone', async () => {
    await seedMirror('coach-1', { code: '111111' });
    await seedMirror('coach-2', { code: '222222', idempotencyKey: 'b-key' });
    mockStatus.mockResolvedValue({ data: { status: 'pending' } });
    const { result, rerender } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(result.current.code).toBe('111111');

    mockCurrentUserId = 'coach-2';
    await act(async () => {
      rerender({});
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(result.current.status).toBe('waiting');
    expect(result.current.code).toBe('222222');
    expect(mockInit).not.toHaveBeenCalled();
    expect(mockStatus).toHaveBeenCalledWith('222222');
    expect((await readImportPairingMirror('coach-1'))?.code).toBe('111111');
    expect((await readImportPairingMirror('coach-2'))?.code).toBe('222222');
  });

  it('A→B with no session for B: carries the live intent forward and mints for B only', async () => {
    await seedMirror('coach-1', { code: '111111' });
    mockStatus.mockResolvedValue({ data: { status: 'pending' } });
    mockInit.mockResolvedValue({ data: { pairing_code: '222222', expires_at: 'x' } });
    const { result, rerender } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(result.current.code).toBe('111111');

    mockCurrentUserId = 'coach-2';
    await act(async () => {
      rerender({});
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(mockInit).toHaveBeenCalledTimes(1);
    expect(result.current.code).toBe('222222');
    expect((await readImportPairingMirror('coach-2'))).toMatchObject({
      userId: 'coach-2',
      code: '222222',
    });
    expect((await readImportPairingMirror('coach-1'))?.code).toBe('111111');
  });

  it('a /pair/init that lands after the identity changed is discarded, not mirrored under the new coach', async () => {
    let resolveInit: (v: unknown) => void = () => {};
    mockInit.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveInit = resolve;
        }),
    );
    mockStatus.mockResolvedValue({ data: { status: 'pending' } });
    const { result, rerender } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      result.current.start();
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(result.current.status).toBe('minting');
    expect(mockInit).toHaveBeenCalledTimes(1);

    // B signs in on the same mount while A's mint is still outstanding; B has
    // no pending session, so a fresh mint for B is issued (second init call).
    mockInit.mockResolvedValueOnce({ data: { pairing_code: '222222', expires_at: 'x' } });
    mockCurrentUserId = 'coach-2';
    await act(async () => {
      rerender({});
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(mockInit).toHaveBeenCalledTimes(2);
    expect(result.current.code).toBe('222222');

    // A's late response arrives: it must not replace B's code or B's record.
    await act(async () => {
      resolveInit({ data: { pairing_code: '111111', expires_at: 'x' } });
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(result.current.code).toBe('222222');
    expect((await readImportPairingMirror('coach-2'))?.code).toBe('222222');
    expect(await readImportPairingMirror('coach-1')).toBeNull();
  });

  it('A’s /pair/init rejecting 401 while B’s mint is pending neither ends B’s session nor releases B’s guard', async () => {
    let rejectInitA: (e: unknown) => void = () => {};
    let resolveInitB: (v: unknown) => void = () => {};
    mockInit
      .mockImplementationOnce(() => new Promise((_r, reject) => { rejectInitA = reject; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveInitB = resolve; }));
    mockStatus.mockResolvedValue({ data: { status: 'pending' } });
    const removeSpy = jest.spyOn(AsyncStorage, 'removeItem');

    const { result, rerender } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      result.current.start();
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(result.current.status).toBe('minting');

    // B signs in on the same mount; B's record was minted for another platform,
    // so it is dropped and a fresh mint for B is issued and stays pending.
    await seedMirror('coach-2', { code: '999999', idempotencyKey: 'b-old', platformId: 'trainerize' });
    mockCurrentUserId = 'coach-2';
    await act(async () => {
      rerender({});
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(mockInit).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe('minting');
    const removesBefore = removeSpy.mock.calls.length;

    // A's stale attempt rejects with 401: B must stay minting, no authExpired,
    // no mirror clear for B, and B's single-flight guard must remain held.
    await act(async () => {
      rejectInitA(axiosError(401));
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(result.current.status).toBe('minting');
    expect(removeSpy.mock.calls.length).toBe(removesBefore);
    await act(async () => {
      result.current.start(); // would be a third mint if the stale finally had freed the guard
    });
    expect(mockInit).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveInitB({ data: { pairing_code: '222222', expires_at: 'x' } });
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(result.current.status).toBe('waiting');
    expect(result.current.code).toBe('222222');
    expect((await readImportPairingMirror('coach-2'))?.code).toBe('222222');
    expect(mockTrack.mock.calls.map((c) => c[0])).not.toContain(AnalyticsEvents.IMPORT_PAIRING_FAILED);
    removeSpy.mockRestore();
  });

  it('same coach cancel→retry: the retry mints at once and the cancelled attempt’s late settle is inert', async () => {
    let settleFirst: { resolve: (v: unknown) => void; reject: (e: unknown) => void } | null = null;
    let resolveSecond: (v: unknown) => void = () => {};
    mockInit
      .mockImplementationOnce(() => new Promise((resolve, reject) => { settleFirst = { resolve, reject }; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));
    mockStatus.mockResolvedValue({ data: { status: 'pending' } });

    const { result } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      result.current.start();
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(result.current.status).toBe('minting');
    await act(async () => {
      result.current.cancel();
    });
    expect(result.current.status).toBe('cancelled');

    // Retry is a new intent and must not be blocked by the abandoned request.
    await act(async () => {
      result.current.start();
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(mockInit).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe('minting');

    // The cancelled attempt now resolves with a code: it must not become the
    // live session, must not be mirrored, and must not free the retry's guard.
    await act(async () => {
      settleFirst!.resolve({ data: { pairing_code: '111111', expires_at: 'x' } });
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(result.current.status).toBe('minting');
    expect(result.current.code).toBeNull();
    expect((await readImportPairingMirror('coach-1'))?.code ?? null).toBeNull();
    await act(async () => {
      result.current.start();
    });
    expect(mockInit).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveSecond({ data: { pairing_code: '222222', expires_at: 'x' } });
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(result.current.status).toBe('waiting');
    expect(result.current.code).toBe('222222');
    expect((await readImportPairingMirror('coach-1'))?.code).toBe('222222');
  });

  it('a mirror write that completes after A signed out is removed again, not left on disk', async () => {
    mockInit.mockResolvedValue({ data: { pairing_code: '111111', expires_at: 'x' } });
    // Hold the mint's setItem open so sign-out (and its key sweep) happens
    // while the write is still in flight; the write then lands afterwards.
    const realSetItem = AsyncStorage.setItem.bind(AsyncStorage);
    let releaseWrite: () => void = () => {};
    const gate = new Promise<void>((resolve) => { releaseWrite = resolve; });
    const setSpy = jest.spyOn(AsyncStorage, 'setItem').mockImplementation(async (k, v) => {
      if (k.startsWith('import_pairing_session:')) await gate;
      return realSetItem(k, v);
    });

    const { result, rerender } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      result.current.start();
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(result.current.status).toBe('minting'); // code never shown before it is on disk

    // signOut(): identity → null, and the sweep removes A's (not yet written) key.
    mockCurrentUserId = null;
    await act(async () => {
      rerender({});
    });
    await AsyncStorage.removeItem('import_pairing_session:coach-1');

    await act(async () => {
      releaseWrite();
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(result.current.status).toBe('idle');
    expect(result.current.code).toBeNull();
    expect(await readImportPairingMirror('coach-1')).toBeNull();
    setSpy.mockRestore();
  });
});

/**
 * Rule 19 — one coach intent may never open two server-side sessions, however
 * many times the response is lost.
 */
describe('useExtensionPairing — idempotency key (R19)', () => {
  it('sends an Idempotency-Key with every mint', async () => {
    mockInit.mockResolvedValue({ data: { pairing_code: '482913', expires_at: 'x' } });
    mockStatus.mockResolvedValue({ data: { status: 'pending' } });
    const { result } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      result.current.start();
    });
    expect(mockInit.mock.calls[0][1]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('replays the SAME key when retrying after a transient network failure', async () => {
    mockInit.mockRejectedValueOnce(new Error('connection reset'));
    mockInit.mockResolvedValueOnce({ data: { pairing_code: '482913', expires_at: 'x' } });
    mockStatus.mockResolvedValue({ data: { status: 'pending' } });

    const { result } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      result.current.start();
    });
    expect(result.current.status).toBe('failed');
    await act(async () => {
      result.current.retry();
    });
    expect(mockInit).toHaveBeenCalledTimes(2);
    expect(mockInit.mock.calls[1][1]).toBe(mockInit.mock.calls[0][1]);
  });

  it('mints a FRESH key after a genuinely new intent (cancel, then start)', async () => {
    mockInit.mockResolvedValue({ data: { pairing_code: '482913', expires_at: 'x' } });
    mockStatus.mockResolvedValue({ data: { status: 'pending' } });
    const { result } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      result.current.start();
    });
    await act(async () => {
      result.current.cancel();
    });
    await act(async () => {
      result.current.start();
    });
    expect(mockInit).toHaveBeenCalledTimes(2);
    expect(mockInit.mock.calls[1][1]).not.toBe(mockInit.mock.calls[0][1]);
  });

  it('replays the persisted key after a process death mid-intent', async () => {
    // The kill happened between /pair/init and its reply; the retry must carry
    // the original key so the backend can dedupe rather than mint a second code.
    await seedMirror('coach-1', { idempotencyKey: 'survived-the-kill' });
    mockStatus.mockResolvedValue({ data: { status: 'expired' } });
    mockInit.mockResolvedValue({ data: { pairing_code: '555555', expires_at: 'x' } });

    const { result } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(result.current.status).toBe('expired');
  });
});

/**
 * C1 setup correlation (UX-03b; contract 2.0.0-c1-s1.1 @ a0ea1bea). The
 * `setup_nonce` is minted with the Rule 19 key, persisted BEFORE /pair/init and
 * replayed on a same-intent retry; the two contract error codes map to
 * contract-named reasons; `import_intent_id` is correlation only. Code and
 * nonce never reach analytics.
 */
describe('useExtensionPairing — C1 setup_nonce / import_intent_id correlation', () => {
  const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it('sends a uuid setup_nonce distinct from the idempotency key on every mint', async () => {
    mockInit.mockResolvedValue({ data: { pairing_code: '482913', expires_at: 'x' } });
    mockStatus.mockResolvedValue({ data: { status: 'pending' } });
    const { result } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      result.current.start();
    });
    const [, key, nonce] = mockInit.mock.calls[0];
    expect(nonce).toMatch(UUID_V4);
    expect(nonce).not.toBe(key);
  });

  it('persists the nonce BEFORE /pair/init is answered (pre-init record, code null)', async () => {
    let resolveInit: (v: unknown) => void = () => {};
    mockInit.mockImplementationOnce(() => new Promise((resolve) => { resolveInit = resolve; }));
    mockStatus.mockResolvedValue({ data: { status: 'pending' } });
    const { result } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      result.current.start();
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(result.current.status).toBe('minting');
    expect(mockInit).toHaveBeenCalledTimes(1);
    const preInit = await readImportPairingMirror('coach-1');
    expect(preInit).toEqual({
      version: IMPORT_PAIRING_MIRROR_VERSION,
      userId: 'coach-1',
      platformId: 'truecoach',
      code: null,
      expiresAt: null,
      idempotencyKey: mockInit.mock.calls[0][1],
      setupNonce: mockInit.mock.calls[0][2],
    });

    await act(async () => {
      resolveInit({ data: { pairing_code: '482913', expires_at: 'x' } });
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(result.current.code).toBe('482913');
    expect((await readImportPairingMirror('coach-1'))?.setupNonce).toBe(mockInit.mock.calls[0][2]);
  });

  it('replays the SAME nonce (and key) when retrying after a transient failure', async () => {
    mockInit.mockRejectedValueOnce(new Error('connection reset'));
    mockInit.mockResolvedValueOnce({ data: { pairing_code: '482913', expires_at: 'x' } });
    mockStatus.mockResolvedValue({ data: { status: 'pending' } });
    const { result } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      result.current.start();
    });
    expect(result.current.status).toBe('failed');
    expect(result.current.reason).toBeNull();
    await act(async () => {
      result.current.retry();
    });
    expect(mockInit).toHaveBeenCalledTimes(2);
    expect(mockInit.mock.calls[1][2]).toBe(mockInit.mock.calls[0][2]);
    expect(mockInit.mock.calls[1][1]).toBe(mockInit.mock.calls[0][1]);
  });

  it('mints a FRESH nonce after a genuinely new intent (cancel, then start)', async () => {
    mockInit.mockResolvedValue({ data: { pairing_code: '482913', expires_at: 'x' } });
    mockStatus.mockResolvedValue({ data: { status: 'pending' } });
    const { result } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      result.current.start();
    });
    await act(async () => {
      result.current.cancel();
    });
    await act(async () => {
      result.current.start();
    });
    expect(mockInit).toHaveBeenCalledTimes(2);
    expect(mockInit.mock.calls[1][2]).not.toBe(mockInit.mock.calls[0][2]);
  });

  it('E01: a pre-init record left by a kill between init and its reply replays the nonce on relaunch', async () => {
    await seedMirror('coach-1', {
      code: null,
      expiresAt: null,
      idempotencyKey: 'key-survived-the-kill',
      setupNonce: 'nonce-survived-the-kill',
    });
    mockInit.mockResolvedValue({ data: { pairing_code: '555555', expires_at: 'x' } });
    mockStatus.mockResolvedValue({ data: { status: 'pending' } });
    const { result } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      result.current.start(); // the panel's mount start, racing hydration
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(mockInit).toHaveBeenCalledTimes(1);
    expect(mockInit).toHaveBeenCalledWith('truecoach', 'key-survived-the-kill', 'nonce-survived-the-kill');
    expect(result.current.status).toBe('waiting');
    expect(result.current.code).toBe('555555');
    // Nothing was restored (there was no code), so no RESTORED event is claimed.
    expect(mockTrack.mock.calls.map((c) => c[0])).not.toContain(AnalyticsEvents.IMPORT_PAIRING_RESTORED);
    // The new code is now on disk under the same intent.
    expect((await readImportPairingMirror('coach-1'))?.code).toBe('555555');
  });

  it('a pre-init record for ANOTHER platform is discarded, not replayed', async () => {
    await seedMirror('coach-1', {
      code: null,
      expiresAt: null,
      platformId: 'trainerize',
      setupNonce: 'other-platform-nonce',
    });
    mockInit.mockResolvedValue({ data: { pairing_code: '555555', expires_at: 'x' } });
    mockStatus.mockResolvedValue({ data: { status: 'pending' } });
    const { result } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      result.current.start();
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(mockInit).toHaveBeenCalledTimes(1);
    expect(mockInit.mock.calls[0][2]).not.toBe('other-platform-nonce');
    expect(result.current.code).toBe('555555');
  });

  describe('409 setup_nonce_conflict', () => {
    it('discards the nonce, fails with reason conflict, and the retry is a new intent', async () => {
      mockInit.mockRejectedValueOnce(axiosError(409, { code: 'setup_nonce_conflict', message: 'x' }));
      mockInit.mockResolvedValueOnce({ data: { pairing_code: '482913', expires_at: 'x' } });
      mockStatus.mockResolvedValue({ data: { status: 'pending' } });
      const { result } = await renderHook(() => useExtensionPairing('truecoach', true));
      await act(async () => {
        result.current.start();
      });
      expect(result.current.status).toBe('failed');
      expect(result.current.reason).toBe('conflict');
      expect(result.current.code).toBeNull();
      expect(await readImportPairingMirror('coach-1')).toBeNull();

      await act(async () => {
        result.current.retry();
      });
      expect(mockInit).toHaveBeenCalledTimes(2);
      expect(mockInit.mock.calls[1][2]).not.toBe(mockInit.mock.calls[0][2]);
      expect(mockInit.mock.calls[1][1]).not.toBe(mockInit.mock.calls[0][1]);
      expect(result.current.status).toBe('waiting');
      expect(result.current.reason).toBeNull();
    });

    it('tracks a failed event with reason conflict and no nonce or code', async () => {
      mockInit.mockRejectedValue(axiosError(409, { code: 'setup_nonce_conflict' }));
      const { result } = await renderHook(() => useExtensionPairing('truecoach', true));
      await act(async () => {
        result.current.start();
      });
      const failed = mockTrack.mock.calls.find((c) => c[0] === AnalyticsEvents.IMPORT_PAIRING_FAILED);
      expect(failed?.[1]).toEqual({ platform: 'truecoach', reason: 'conflict' });
      const nonce = mockInit.mock.calls[0][2] as string;
      expect(JSON.stringify(mockTrack.mock.calls)).not.toContain(nonce);
    });

    it('a 409 WITHOUT the contracted code is a generic failure that keeps the intent', async () => {
      mockInit.mockRejectedValueOnce(axiosError(409));
      mockInit.mockResolvedValueOnce({ data: { pairing_code: '482913', expires_at: 'x' } });
      mockStatus.mockResolvedValue({ data: { status: 'pending' } });
      const { result } = await renderHook(() => useExtensionPairing('truecoach', true));
      await act(async () => {
        result.current.start();
      });
      expect(result.current.status).toBe('failed');
      expect(result.current.reason).toBeNull();
      await act(async () => {
        result.current.retry();
      });
      expect(mockInit.mock.calls[1][2]).toBe(mockInit.mock.calls[0][2]);
    });
  });

  describe('410 setup_challenge_unavailable', () => {
    it('is expired-class: status expired with reason challengeUnavailable, mirror cleared, nonce retired', async () => {
      mockInit.mockRejectedValueOnce(axiosError(410, { code: 'setup_challenge_unavailable' }));
      mockInit.mockResolvedValueOnce({ data: { pairing_code: '482913', expires_at: 'x' } });
      mockStatus.mockResolvedValue({ data: { status: 'pending' } });
      const { result } = await renderHook(() => useExtensionPairing('truecoach', true));
      await act(async () => {
        result.current.start();
      });
      expect(result.current.status).toBe('expired');
      expect(result.current.reason).toBe('challengeUnavailable');
      expect(result.current.code).toBeNull();
      expect(await readImportPairingMirror('coach-1')).toBeNull();
      const names = mockTrack.mock.calls.map((c) => c[0]);
      expect(names).toContain(AnalyticsEvents.IMPORT_PAIRING_EXPIRED);
      expect(names).not.toContain(AnalyticsEvents.IMPORT_PAIRING_FAILED);

      await act(async () => {
        result.current.retry();
      });
      expect(mockInit).toHaveBeenCalledTimes(2);
      expect(mockInit.mock.calls[1][2]).not.toBe(mockInit.mock.calls[0][2]);
      expect(result.current.status).toBe('waiting');
    });

    it('a 410 WITHOUT the contracted code is a generic failure', async () => {
      mockInit.mockRejectedValue(axiosError(410));
      const { result } = await renderHook(() => useExtensionPairing('truecoach', true));
      await act(async () => {
        result.current.start();
      });
      expect(result.current.status).toBe('failed');
      expect(result.current.reason).toBeNull();
    });
  });

  it('exposes fact → remedy copy for each contract-named reason', () => {
    expect(PAIRING_REASON_COPY.challengeUnavailable.message).toBe(
      'Your code is no longer valid; your setup is kept',
    );
    expect(PAIRING_REASON_COPY.challengeUnavailable.remedy).toBe('Get a new code');
    expect(PAIRING_REASON_COPY.conflict.remedy).toBe('Get a new code');
    expect(Object.keys(PAIRING_REASON_COPY).sort()).toEqual(['challengeUnavailable', 'conflict']);
  });

  describe('import_intent_id (correlation only)', () => {
    it('captures the id from the init reply, mirrors it, and never lets it drive status', async () => {
      mockInit.mockResolvedValue({
        data: { pairing_code: '482913', expires_at: 'x', import_intent_id: 'ii-0001' },
      });
      mockStatus.mockResolvedValue({ data: { status: 'pending' } });
      const { result } = await renderHook(() => useExtensionPairing('truecoach', true));
      await act(async () => {
        result.current.start();
      });
      expect(result.current.status).toBe('waiting');
      expect(result.current.importIntentId).toBe('ii-0001');
      expect((await readImportPairingMirror('coach-1'))?.importIntentId).toBe('ii-0001');
    });

    it('captures the id from a status reply and keeps polling on pending', async () => {
      mockInit.mockResolvedValue({ data: { pairing_code: '482913', expires_at: 'x' } });
      mockStatus.mockResolvedValue({ data: { status: 'pending', import_intent_id: 'ii-0002' } });
      const { result } = await renderHook(() => useExtensionPairing('truecoach', true));
      await act(async () => {
        result.current.start();
      });
      expect(result.current.importIntentId).toBeNull();
      await act(async () => {
        await jest.advanceTimersByTimeAsync(2000);
      });
      expect(result.current.status).toBe('waiting');
      // Snapshot publishes on the next transition; the ref already holds it.
      await act(async () => {
        result.current.cancel();
      });
      expect(result.current.status).toBe('cancelled');
      expect(result.current.importIntentId).toBe('ii-0002');
    });

    it('an import_intent_id alone never promotes to paired (fail closed)', async () => {
      mockInit.mockResolvedValue({ data: { pairing_code: '482913', expires_at: 'x', import_intent_id: 'ii-0003' } });
      mockStatus.mockResolvedValue({ data: { import_intent_id: 'ii-0003' } }); // no status
      const { result } = await renderHook(() => useExtensionPairing('truecoach', true));
      await act(async () => {
        result.current.start();
      });
      await act(async () => {
        await jest.advanceTimersByTimeAsync(2000);
      });
      expect(result.current.status).toBe('waiting');
    });

    it('a malformed id is dropped, not surfaced', async () => {
      mockInit.mockResolvedValue({ data: { pairing_code: '482913', expires_at: 'x', import_intent_id: 42 } });
      mockStatus.mockResolvedValue({ data: { status: 'pending' } });
      const { result } = await renderHook(() => useExtensionPairing('truecoach', true));
      await act(async () => {
        result.current.start();
      });
      expect(result.current.importIntentId).toBeNull();
      expect((await readImportPairingMirror('coach-1'))?.importIntentId).toBeUndefined();
    });

    it('is reset for a new intent', async () => {
      mockInit.mockResolvedValueOnce({ data: { pairing_code: '482913', expires_at: 'x', import_intent_id: 'ii-0004' } });
      mockInit.mockResolvedValueOnce({ data: { pairing_code: '999999', expires_at: 'x' } });
      mockStatus.mockResolvedValue({ data: { status: 'pending' } });
      const { result } = await renderHook(() => useExtensionPairing('truecoach', true));
      await act(async () => {
        result.current.start();
      });
      expect(result.current.importIntentId).toBe('ii-0004');
      await act(async () => {
        result.current.cancel();
      });
      await act(async () => {
        result.current.start();
      });
      expect(result.current.code).toBe('999999');
      expect(result.current.importIntentId).toBeNull();
    });
  });

  it('never emits the nonce, key, or code in any tracked event across the whole flow', async () => {
    mockInit.mockRejectedValueOnce(axiosError(409, { code: 'setup_nonce_conflict' }));
    mockInit.mockResolvedValueOnce({ data: { pairing_code: '482913', expires_at: 'x', import_intent_id: 'ii-9' } });
    mockStatus.mockResolvedValue({ data: { status: 'paired' } });
    const { result } = await renderHook(() => useExtensionPairing('truecoach', true));
    await act(async () => {
      result.current.start();
    });
    await act(async () => {
      result.current.retry();
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2000);
    });
    expect(result.current.status).toBe('paired');
    const serialized = JSON.stringify(mockTrack.mock.calls);
    for (const call of mockInit.mock.calls) {
      expect(serialized).not.toContain(call[1]);
      expect(serialized).not.toContain(call[2]);
    }
    expect(serialized).not.toContain('482913');
    expect(serialized).not.toContain('ii-9');
  });

  it('keeps the public return shape the panel destructures', async () => {
    const { result } = await renderHook(() => useExtensionPairing('truecoach', true));
    const { status, code, supportReference, start, retry, cancel } = result.current;
    expect(status).toBe('idle');
    expect(code).toBeNull();
    expect(supportReference).toBeNull();
    expect(typeof start).toBe('function');
    expect(typeof retry).toBe('function');
    expect(typeof cancel).toBe('function');
    expect(result.current.importIntentId).toBeNull();
    expect(result.current.reason).toBeNull();
  });
});
