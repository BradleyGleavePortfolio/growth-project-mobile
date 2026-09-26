/**
 * S12-B3 — useImportRunStatus / useImportedRoster behaviour:
 *   - disabled (no request, no listener) off-flag / no coach / no intent;
 *   - 404 → notFound (not known yet), undecodable or other-intent → unreadable;
 *   - stale-read: a failed refresh keeps the last reading, marked stale;
 *   - foreground re-read; polling stops once a recognised terminal is read;
 *   - roster mounts only with BOTH flags AND a settled run; pages by cursor.
 * The transport is mocked; importRunStatusApi's own 404 mapping is tested in
 * src/api/__tests__/importRunStatusApi.test.ts.
 */
import React from 'react';
import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';
import { renderHook, waitFor, act, cleanup } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const flags = { extensionImport: true, importReview: false };
jest.mock('../../config/featureFlags', () => ({
  get featureFlags() {
    return flags;
  },
}));

let mockUser: { id: string } | null = { id: 'coach-1' };
jest.mock('../useCurrentUser', () => ({ useCurrentUser: () => mockUser }));

jest.mock('../../api/importRunStatusApi', () => ({
  importRunStatusApi: { status: jest.fn(), roster: jest.fn() },
}));

import { importRunStatusApi } from '../../api/importRunStatusApi';
import { IMPORT_STATUS_POLL_MS, useImportRunStatus, useImportedRoster } from '../useImportRunStatus';

const statusFn = importRunStatusApi.status as jest.Mock;
const rosterFn = importRunStatusApi.roster as jest.Mock;
const INTENT = 'intent-1';

const reading = (over: Record<string, unknown> = {}) => ({
  kind: 'body',
  body: {
    intent_id: INTENT,
    status: 'running',
    mode: 'server',
    phase: 'discovering',
    reason_code: null,
    claimed_status: null,
    completed_at: null,
    started_at: null,
    ...over,
  },
});

const rosterPage = (ids: string[], next: string | null) => ({
  kind: 'body',
  body: {
    intent_id: INTENT,
    accounting: { staged: 2, reconstructed: 2, skipped: 0, failed: 0 },
    persons: ids.map((id) => ({ id, state: 'InvitePending', display_name: `P ${id}` })),
    page: { limit: 50, next_cursor: next, has_more: next !== null },
    roster_bridge_pending: true,
  },
});

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { Wrapper, qc };
}

let appStateHandler: ((s: AppStateStatus) => void) | null = null;
let addListener: jest.SpyInstance;

beforeEach(() => {
  flags.extensionImport = true;
  flags.importReview = false;
  mockUser = { id: 'coach-1' };
  statusFn.mockReset();
  rosterFn.mockReset();
  appStateHandler = null;
  addListener = jest.spyOn(AppState, 'addEventListener').mockImplementation((_e, cb) => {
    appStateHandler = cb as (s: AppStateStatus) => void;
    return { remove: jest.fn() } as unknown as NativeEventSubscription;
  });
});

afterEach(async () => {
  await cleanup();
  jest.restoreAllMocks();
});

describe('useImportRunStatus — disabled postures', () => {
  it.each([
    ['flag off', () => (flags.extensionImport = false), INTENT],
    ['no coach', () => (mockUser = null), INTENT],
    ['no intent', () => undefined, null],
  ])('%s → disabled, no request, no listener', async (_n, arrange, intent) => {
    arrange();
    const { Wrapper } = makeWrapper();
    const { result } = await renderHook(() => useImportRunStatus(intent), { wrapper: Wrapper });
    expect(result.current.view).toBe('disabled');
    expect(statusFn).not.toHaveBeenCalled();
    expect(addListener).not.toHaveBeenCalled();
  });
});

describe('useImportRunStatus — readings', () => {
  it('decodes a reading for the paired intent', async () => {
    statusFn.mockResolvedValue(reading());
    const { Wrapper } = makeWrapper();
    const { result } = await renderHook(() => useImportRunStatus(INTENT), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.view).toBe('reading'));
    expect(statusFn).toHaveBeenCalledWith(INTENT);
    expect(result.current.reading?.phase).toBe('discovering');
    expect(result.current.stale).toBe(false);
    expect(result.current.readAt).not.toBeNull();
  });

  it('404 → notFound (not known yet), never a reading', async () => {
    statusFn.mockResolvedValue({ kind: 'notFound' });
    const { Wrapper } = makeWrapper();
    const { result } = await renderHook(() => useImportRunStatus(INTENT), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.view).toBe('notFound'));
    expect(result.current.reading).toBeUndefined();
  });

  it('a body for another intent is discarded → unreadable', async () => {
    statusFn.mockResolvedValue(reading({ intent_id: 'someone-else' }));
    const { Wrapper } = makeWrapper();
    const { result } = await renderHook(() => useImportRunStatus(INTENT), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.view).toBe('unreadable'));
    expect(result.current.reading).toBeUndefined();
  });

  it('first-read transport failure → error (not known), no reading', async () => {
    statusFn.mockRejectedValue(new Error('offline'));
    const { Wrapper } = makeWrapper();
    const { result } = await renderHook(() => useImportRunStatus(INTENT), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.view).toBe('error'));
    expect(result.current.reading).toBeUndefined();
  });

  it('a failed refresh keeps the last reading marked stale', async () => {
    statusFn.mockResolvedValueOnce(reading({ status: 'failed', phase: null, reason_code: 'transfer_failed' }));
    const { Wrapper } = makeWrapper();
    const { result } = await renderHook(() => useImportRunStatus(INTENT), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.view).toBe('reading'));
    const firstReadAt = result.current.readAt;
    statusFn.mockRejectedValue(new Error('offline'));
    await act(async () => {
      result.current.refresh();
    });
    await waitFor(() => expect(result.current.stale).toBe(true));
    expect(result.current.reading?.status).toBe('failed');
    expect(result.current.readAt).toBe(firstReadAt);
  });

  it('a later 404 replaces an earlier reading (fresh answer, not stale)', async () => {
    statusFn.mockResolvedValueOnce(reading());
    const { Wrapper } = makeWrapper();
    const { result } = await renderHook(() => useImportRunStatus(INTENT), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.view).toBe('reading'));
    statusFn.mockResolvedValue({ kind: 'notFound' });
    await act(async () => {
      result.current.refresh();
    });
    await waitFor(() => expect(result.current.view).toBe('notFound'));
    expect(result.current.reading).toBeUndefined();
    expect(result.current.stale).toBe(false);
  });

  it('re-reads on app foreground', async () => {
    statusFn.mockResolvedValue(reading());
    const { Wrapper } = makeWrapper();
    const { result } = await renderHook(() => useImportRunStatus(INTENT), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.view).toBe('reading'));
    const calls = statusFn.mock.calls.length;
    await act(async () => appStateHandler?.('active'));
    await waitFor(() => expect(statusFn.mock.calls.length).toBe(calls + 1));
  });

  it('polls while open and stops once a recognised terminal is read', async () => {
    jest.useFakeTimers();
    try {
      statusFn.mockResolvedValueOnce(reading()).mockResolvedValue(reading({ status: 'complete', phase: null }));
      const { Wrapper } = makeWrapper();
      const { result } = await renderHook(() => useImportRunStatus(INTENT), { wrapper: Wrapper });
      await waitFor(() => expect(result.current.view).toBe('reading'));
      expect(statusFn).toHaveBeenCalledTimes(1);
      await act(async () => {
        jest.advanceTimersByTime(IMPORT_STATUS_POLL_MS + 10);
      });
      await waitFor(() => expect(result.current.reading?.status).toBe('complete'));
      expect(statusFn).toHaveBeenCalledTimes(2);
      await act(async () => {
        jest.advanceTimersByTime(IMPORT_STATUS_POLL_MS * 3);
      });
      expect(statusFn).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('useImportedRoster — flag + settle gating and pagination', () => {
  it('importReview OFF (default) → disabled, no request', async () => {
    const { Wrapper } = makeWrapper();
    const { result } = await renderHook(() => useImportedRoster(INTENT, true), { wrapper: Wrapper });
    expect(result.current.view).toBe('disabled');
    expect(rosterFn).not.toHaveBeenCalled();
  });

  it('importReview ON but run not settled → disabled', async () => {
    flags.importReview = true;
    const { Wrapper } = makeWrapper();
    const { result } = await renderHook(() => useImportedRoster(INTENT, false), { wrapper: Wrapper });
    expect(result.current.view).toBe('disabled');
    expect(rosterFn).not.toHaveBeenCalled();
  });

  it('extensionImport OFF → disabled even with importReview ON', async () => {
    flags.importReview = true;
    flags.extensionImport = false;
    const { Wrapper } = makeWrapper();
    const { result } = await renderHook(() => useImportedRoster(INTENT, true), { wrapper: Wrapper });
    expect(result.current.view).toBe('disabled');
    expect(rosterFn).not.toHaveBeenCalled();
  });

  it('loads, dedupes and follows the server cursor', async () => {
    flags.importReview = true;
    rosterFn.mockImplementation((_i: string, cursor?: string) =>
      Promise.resolve(cursor === 'C2' ? rosterPage(['b', 'c'], null) : rosterPage(['a', 'b'], 'C2')),
    );
    const { Wrapper } = makeWrapper();
    const { result } = await renderHook(() => useImportedRoster(INTENT, true), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.view).toBe('page'));
    expect(rosterFn).toHaveBeenCalledWith(INTENT, undefined);
    expect(result.current.hasMore).toBe(true);
    expect(result.current.rosterBridgePending).toBe(true);
    await act(async () => {
      result.current.fetchMore();
    });
    await waitFor(() => expect(result.current.persons.map((p) => p.id)).toEqual(['a', 'b', 'c']));
    expect(rosterFn).toHaveBeenCalledWith(INTENT, 'C2');
    expect(result.current.hasMore).toBe(false);
    expect(result.current.incomplete).toBe(false);
  });

  it('empty first page with a cursor keeps hasMore; the next page’s people then appear', async () => {
    flags.importReview = true;
    rosterFn.mockImplementation((_i: string, cursor?: string) =>
      Promise.resolve(cursor === 'C2' ? rosterPage(['a'], null) : rosterPage([], 'C2')),
    );
    const { Wrapper } = makeWrapper();
    const { result } = await renderHook(() => useImportedRoster(INTENT, true), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.view).toBe('page'));
    expect(result.current.persons).toEqual([]);
    expect(result.current.hasMore).toBe(true);
    expect(result.current.incomplete).toBe(false);
    await act(async () => {
      result.current.fetchMore();
    });
    await waitFor(() => expect(result.current.persons.map((p) => p.id)).toEqual(['a']));
    expect(rosterFn).toHaveBeenCalledWith(INTENT, 'C2');
    expect(result.current.hasMore).toBe(false);
  });

  it('S11-E unclassified reaches the view verbatim; absent stays null', async () => {
    flags.importReview = true;
    const withU = rosterPage(['a'], null);
    (withU.body.accounting as Record<string, number>).unclassified = 5;
    rosterFn.mockResolvedValue(withU);
    const { Wrapper } = makeWrapper();
    const { result } = await renderHook(() => useImportedRoster(INTENT, true), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.view).toBe('page'));
    expect(result.current.accounting?.unclassified).toBe(5);

    rosterFn.mockResolvedValue(rosterPage(['a'], null));
    const w2 = makeWrapper();
    const r2 = await renderHook(() => useImportedRoster(INTENT, true), { wrapper: w2.Wrapper });
    await waitFor(() => expect(r2.result.current.view).toBe('page'));
    expect(r2.result.current.accounting?.unclassified).toBeNull();
  });

  it('404 → notFound; undecodable → unreadable (never an empty list)', async () => {
    flags.importReview = true;
    rosterFn.mockResolvedValue({ kind: 'notFound' });
    const { Wrapper } = makeWrapper();
    const { result } = await renderHook(() => useImportedRoster(INTENT, true), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.view).toBe('notFound'));
    expect(result.current.persons).toEqual([]);

    rosterFn.mockResolvedValue({ kind: 'body', body: { nope: true } });
    const w2 = makeWrapper();
    const r2 = await renderHook(() => useImportedRoster(INTENT, true), { wrapper: w2.Wrapper });
    await waitFor(() => expect(r2.result.current.view).toBe('unreadable'));
  });

  it('an undecodable later page marks the list incomplete and keeps loaded rows', async () => {
    flags.importReview = true;
    rosterFn.mockImplementation((_i: string, cursor?: string) =>
      Promise.resolve(cursor === 'C2' ? { kind: 'body', body: 'garbage' } : rosterPage(['a'], 'C2')),
    );
    const { Wrapper } = makeWrapper();
    const { result } = await renderHook(() => useImportedRoster(INTENT, true), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.view).toBe('page'));
    await act(async () => {
      result.current.fetchMore();
    });
    await waitFor(() => expect(result.current.incomplete).toBe(true));
    expect(result.current.persons.map((p) => p.id)).toEqual(['a']);
    expect(result.current.hasMore).toBe(false);
  });
});
