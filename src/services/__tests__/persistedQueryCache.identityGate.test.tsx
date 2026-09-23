/**
 * S6-P1 — identity-bound persisted query cache: REQUIRED post-fix suite.
 *
 * Real composition: real `queryClient`, real `createIdentityPersistence`
 * (pinned @tanstack persist primitives over the AsyncStorage jest mock), real
 * `PersistedQueryCacheGate`. Nothing in the persistence path is mocked.
 *
 * Exit criteria pinned here (parent S6-P1 decisions):
 *   - no anonymous shared-key restore or write for authenticated state,
 *   - A→B replacement WITHOUT a normal signOut: no frame renders A's private
 *     data under B; A's deferred restore cannot land after replacement,
 *   - a queued/throttled OLD storage write is fenced at the actual write, not
 *     merely at persistClient entry,
 *   - clearing happens before new private children can observe old memory,
 *   - normal same-user restore works, normal logout leaves nothing behind,
 *   - the restoring phase is bounded (no deadlock on a hung storage read).
 */
import React from 'react';
import { act, render, cleanup } from '@testing-library/react-native';
import { Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider, dehydrate, useQuery } from '@tanstack/react-query';

import {
  queryClient,
  persisterKeyForUser,
  createIdentityPersistence,
  QUERY_CACHE_BUSTER,
  QUERY_CACHE_KEY_PREFIX,
} from '../queryClient';
import {
  PersistedQueryCacheGate,
  PERSISTED_CACHE_RESTORE_TIMEOUT_MS,
  PERSISTED_CACHE_DRAIN_TIMEOUT_MS,
} from '../PersistedQueryCacheGate';

const ME = ['me'] as const;
const A = { id: 'user-A', email: 'a@example.com', secret: 'A-private' };
const B = { id: 'user-B', email: 'b@example.com', secret: 'B-private' };
const KEY_A = persisterKeyForUser('user-A');
const KEY_B = persisterKeyForUser('user-B');
const ANON_KEY = `${QUERY_CACHE_KEY_PREFIX}:anonymous`;

function blobWith(key: readonly unknown[], data: unknown, extra: Record<string, unknown> = {}): string {
  const tmp = new QueryClient();
  tmp.setQueryData(key, data);
  for (const [k, v] of Object.entries(extra)) tmp.setQueryData([k], v);
  return JSON.stringify({ buster: QUERY_CACHE_BUSTER, timestamp: Date.now(), clientState: dehydrate(tmp) });
}
async function blobQueries(storageKey: string): Promise<Array<{ queryKey: unknown; data: unknown }>> {
  const raw = await AsyncStorage.getItem(storageKey);
  if (!raw) return [];
  const parsed = JSON.parse(raw) as { clientState: { queries: Array<{ queryKey: unknown; state: { data: unknown } }> } };
  return parsed.clientState.queries.map((q) => ({ queryKey: q.queryKey, data: q.state.data }));
}

/** Records, per render, which identity the child is rendered for and what it can see. */
const frames: Array<{ session: string; me: unknown }> = [];
function PrivateProbe({ session }: { session: string }) {
  const { data } = useQuery({ queryKey: ME, queryFn: () => new Promise<never>(() => {}), staleTime: Infinity });
  frames.push({ session, me: data ?? queryClient.getQueryData(ME) });
  return <Text testID={`private-${session}`}>{data ? JSON.stringify(data) : 'none'}</Text>;
}
function Harness({ userId }: { userId: string | null }) {
  return (
    <QueryClientProvider client={queryClient}>
      <PersistedQueryCacheGate userId={userId}>
        <PrivateProbe session={userId ?? 'anon'} />
      </PersistedQueryCacheGate>
    </QueryClientProvider>
  );
}

let getItemSpy: jest.SpyInstance;
let setItemSpy: jest.SpyInstance;
// Underlying mock storage implementation, captured BEFORE the spies are
// installed (S6-A-P2-B04): a `.bind(AsyncStorage)` taken inside a test would
// bind the spy itself, so a delayed implementation that "delegates" through it
// would re-enter itself and create a second unreleased Promise.
let realGetItem: typeof AsyncStorage.getItem;
let realSetItem: typeof AsyncStorage.setItem;

beforeEach(async () => {
  jest.useFakeTimers();
  await AsyncStorage.clear();
  queryClient.clear();
  frames.length = 0;
  realGetItem = AsyncStorage.getItem.bind(AsyncStorage);
  realSetItem = AsyncStorage.setItem.bind(AsyncStorage);
  getItemSpy = jest.spyOn(AsyncStorage, 'getItem');
  setItemSpy = jest.spyOn(AsyncStorage, 'setItem');
});
afterEach(async () => {
  // Global exit criterion: the shared anonymous key is never read or written.
  const touched = [...getItemSpy.mock.calls, ...setItemSpy.mock.calls].map((c) => String(c[0]));
  expect(touched.filter((k) => k === ANON_KEY || k === QUERY_CACHE_KEY_PREFIX)).toEqual([]);
  await cleanup();
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const settle = async (ms = 0) => {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
};

describe('normal same-user restore', () => {
  it('restores A from A\'s own key, renders children only after restore, persists back to A\'s key, restores again on cold remount', async () => {
    await AsyncStorage.setItem(KEY_A, blobWith(ME, A));
    // Hold A's own read so the restoring phase is observable (the awaited render
    // would otherwise flush the in-memory mock read before the assertion).
    let releaseA: (() => void) | null = null;
    const realGet = realGetItem; // underlying mock storage, not the spy
    getItemSpy.mockImplementation(async (k: string) => {
      if (k === KEY_A && !releaseA) {
        await new Promise<void>((res) => {
          releaseA = res;
        });
      }
      return realGet(k);
    });
    const r = await render(<Harness userId="user-A" />);
    expect(r.queryByTestId('private-user-A')).toBeNull(); // restoring phase, no private frame yet
    expect(releaseA).not.toBeNull(); // A's own key is being read
    (releaseA as unknown as () => void)();
    await settle();
    expect(r.getByTestId('private-user-A').props.children).toContain('A-private');
    expect(frames.every((f) => f.session !== 'user-A' || f.me === undefined || (f.me as typeof A).id === 'user-A')).toBe(true);

    await act(async () => {
      queryClient.setQueryData(['extra'], { n: 1 });
    });
    await settle(1100);
    expect(await blobQueries(KEY_A)).toEqual(
      expect.arrayContaining([expect.objectContaining({ data: A }), expect.objectContaining({ data: { n: 1 } })]),
    );
    await r.unmount();
    queryClient.clear();
    const again = await render(<Harness userId="user-A" />);
    await settle();
    expect(again.getByTestId('private-user-A').props.children).toContain('A-private');
  });
});

describe('A → B replacement without a normal signOut', () => {
  it('never renders A\'s private data under B, clears before B\'s children mount, and B restores from B\'s key only', async () => {
    await AsyncStorage.setItem(KEY_A, blobWith(ME, A));
    await AsyncStorage.setItem(KEY_B, blobWith(ME, B));
    const r = await render(<Harness userId="user-A" />);
    await settle();
    expect(queryClient.getQueryData(ME)).toEqual(A);

    // Hold B's own read so the A-gone / B-not-yet phase is observable after the
    // awaited rerender (which otherwise flushes B's restore from the mock).
    let releaseB: (() => void) | null = null;
    const realGet = realGetItem; // underlying mock storage, not the spy
    getItemSpy.mockImplementation(async (k: string) => {
      if (k === KEY_B && !releaseB) {
        await new Promise<void>((res) => {
          releaseB = res;
        });
      }
      return realGet(k);
    });
    await r.rerender(<Harness userId="user-B" />);
    // After the identity change, before B's restore completes: A's children are gone and no B child exists yet.
    expect(r.queryByTestId('private-user-A')).toBeNull();
    expect(r.queryByTestId('private-user-B')).toBeNull();
    expect(releaseB).not.toBeNull(); // B's own key is being read
    (releaseB as unknown as () => void)();
    await settle();
    expect(r.getByTestId('private-user-B').props.children).toContain('B-private');
    expect(queryClient.getQueryData(ME)).toEqual(B);
    const bFrames = frames.filter((f) => f.session === 'user-B');
    expect(bFrames.length).toBeGreaterThan(0);
    expect(bFrames.some((f) => JSON.stringify(f.me ?? '').includes('A-private'))).toBe(false);
    // Nothing of A was written to B's key, and A's key still holds A only.
    await settle(1100);
    expect(JSON.stringify(await blobQueries(KEY_B))).not.toContain('A-private');
    expect(JSON.stringify(await blobQueries(KEY_A))).not.toContain('B-private');
  });

  it('a deferred OLD restore resolving after replacement hydrates nothing', async () => {
    await AsyncStorage.setItem(KEY_A, blobWith(ME, A));
    await AsyncStorage.setItem(KEY_B, blobWith(ME, B));
    let releaseA: (() => void) | null = null;
    const realGet = realGetItem; // underlying mock storage, not the spy
    getItemSpy.mockImplementation(async (k: string) => {
      if (k === KEY_A && !releaseA) {
        await new Promise<void>((res) => {
          releaseA = res;
        });
      }
      return realGet(k);
    });
    const r = await render(<Harness userId="user-A" />);
    await settle();
    expect(r.queryByTestId('private-user-A')).toBeNull(); // still restoring A (read held)

    await r.rerender(<Harness userId="user-B" />); // replacement lands first
    await settle();
    expect(r.getByTestId('private-user-B').props.children).toContain('B-private');

    (releaseA as unknown as () => void)(); // A's read finally resolves
    await settle(50);
    expect(queryClient.getQueryData(ME)).toEqual(B);
    expect(JSON.stringify(queryClient.getQueryCache().getAll().map((q) => q.state.data))).not.toContain('A-private');
    await settle(1100);
    expect(JSON.stringify(await blobQueries(KEY_B))).not.toContain('A-private');
  });

  it('a queued/throttled OLD storage write is dropped at the actual write after retirement (not just at persistClient entry)', async () => {
    await AsyncStorage.setItem(KEY_A, blobWith(ME, A));
    const r = await render(<Harness userId="user-A" />);
    await settle();
    // First event → immediate write (throttle idle). Second → queued ~1 s.
    await act(async () => {
      queryClient.setQueryData(['warm'], 1);
    });
    await settle(5);
    const writesToAAfterWarm = setItemSpy.mock.calls.filter((c) => c[0] === KEY_A).length;
    await act(async () => {
      queryClient.setQueryData(['queued-under-A'], 'should-never-persist');
    });
    // Retire A (replacement) before the queued write fires.
    await r.rerender(<Harness userId="user-B" />);
    await settle();
    await settle(1500); // the library's throttled op fires now — into the fenced storage
    const writesToAAfter = setItemSpy.mock.calls.filter((c) => c[0] === KEY_A).length;
    expect(writesToAAfter).toBe(writesToAAfterWarm);
    expect(JSON.stringify(await blobQueries(KEY_A))).not.toContain('should-never-persist');
    expect(JSON.stringify(await blobQueries(KEY_B))).not.toContain('should-never-persist');
  });

  it('an in-flight OLD storage write is drained before the replacement identity is committed', async () => {
    await AsyncStorage.setItem(KEY_A, blobWith(ME, A));
    const r = await render(<Harness userId="user-A" />);
    await settle();
    let releaseWrite: (() => void) | null = null;
    const realSet = realSetItem; // underlying mock storage, not the spy
    setItemSpy.mockImplementation(async (k: string, v: string) => {
      if (k === KEY_A && !releaseWrite) {
        await new Promise<void>((res) => {
          releaseWrite = res;
        });
      }
      return realSet(k, v);
    });
    await act(async () => {
      queryClient.setQueryData(['slow-write'], 1); // immediate write, now hanging inside storage
    });
    await settle(5);
    expect(releaseWrite).not.toBeNull();
    await r.rerender(<Harness userId="user-B" />);
    await settle(50);
    // The write is genuinely outstanding, so B is not yet committed: no B frame may exist.
    expect(r.queryByTestId('private-user-B')).toBeNull();
    (releaseWrite as unknown as () => void)();
    await settle(50);
    expect(r.getByTestId('private-user-B')).toBeTruthy();
  });
});

describe('A → logged out (null) with delayed OLD operations', () => {
  it('a deferred OLD restore resolving after logout hydrates nothing into the unauthenticated session', async () => {
    await AsyncStorage.setItem(KEY_A, blobWith(ME, A));
    const seededWrites = setItemSpy.mock.calls.length; // the fixture seed above went through the spy
    let releaseA: (() => void) | null = null;
    const realGet = realGetItem; // underlying mock storage, not the spy
    getItemSpy.mockImplementation(async (k: string) => {
      if (k === KEY_A && !releaseA) {
        await new Promise<void>((res) => {
          releaseA = res;
        });
      }
      return realGet(k);
    });
    const r = await render(<Harness userId="user-A" />);
    await settle();
    await r.rerender(<Harness userId={null} />);
    await settle(50);
    expect(r.getByTestId('private-anon').props.children).toBe('none');
    (releaseA as unknown as () => void)();
    await settle(50);
    expect(queryClient.getQueryData(ME)).toBeUndefined();
    expect(frames.filter((f) => f.session === 'anon').every((f) => f.me === undefined)).toBe(true);
    expect(setItemSpy.mock.calls.slice(seededWrites).filter((c) => String(c[0]).startsWith(QUERY_CACHE_KEY_PREFIX))).toEqual([]);
  });

  it('a queued/throttled OLD write is dropped after logout and the retired identity\'s key is purged', async () => {
    await AsyncStorage.setItem(KEY_A, blobWith(ME, A));
    const r = await render(<Harness userId="user-A" />);
    await settle();
    await act(async () => {
      queryClient.setQueryData(['warm'], 1);
    });
    await settle(5);
    await act(async () => {
      queryClient.setQueryData(['queued-under-A'], 'should-never-persist');
    });
    await r.rerender(<Harness userId={null} />);
    await settle(50);
    const writesAfterLogout = setItemSpy.mock.calls.length;
    await settle(1500); // throttled op fires into the fenced storage
    expect(setItemSpy.mock.calls.length).toBe(writesAfterLogout);
    // Explicit logout lifecycle: retired identity's key is gone (drain → purge), nothing to resurrect.
    expect(await AsyncStorage.getItem(KEY_A)).toBeNull();
  });

  it('an OLD write still in flight when the bounded drain expires cannot recreate the blob after logout purge (fail-closed)', async () => {
    await AsyncStorage.setItem(KEY_A, blobWith(ME, A));
    const r = await render(<Harness userId="user-A" />);
    await settle();
    let releaseWrite: (() => void) | null = null;
    const realSet = realSetItem; // underlying mock storage, not the spy
    setItemSpy.mockImplementation(async (k: string, v: string) => {
      if (k === KEY_A && !releaseWrite) {
        await new Promise<void>((res) => {
          releaseWrite = res;
        });
      }
      return realSet(k, v); // the bytes DO land — the write was never stopped
    });
    const removeItemSpy = jest.spyOn(AsyncStorage, 'removeItem');
    await act(async () => {
      queryClient.setQueryData(['slow-write'], 'A-slow');
    });
    await settle(5);
    expect(releaseWrite).not.toBeNull();
    await r.rerender(<Harness userId={null} />);
    await settle(PERSISTED_CACHE_DRAIN_TIMEOUT_MS + 50);
    // Drain expired: unauthenticated children render with the purge done, write still outstanding.
    expect(r.getByTestId('private-anon').props.children).toBe('none');
    expect(await AsyncStorage.getItem(KEY_A)).toBeNull();
    (releaseWrite as unknown as () => void)(); // old completion lands AFTER the purge
    await settle(50);
    // Fail-closed: the retired identity's fenced storage removes what it just wrote.
    expect(removeItemSpy.mock.calls.some((c) => c[0] === KEY_A)).toBe(true);
    expect(await AsyncStorage.getItem(KEY_A)).toBeNull();
    expect(setItemSpy.mock.calls.filter((c) => String(c[0]).startsWith(QUERY_CACHE_KEY_PREFIX) && c[0] !== KEY_A)).toEqual([]);
  });
});

describe('gate unmount during a suspended transition (S6-A-01)', () => {
  it('unmounting mid-drain (A → B) invalidates the transition: B is never read or subscribed and nothing is written after the unmount', async () => {
    await AsyncStorage.setItem(KEY_A, blobWith(ME, A));
    await AsyncStorage.setItem(KEY_B, blobWith(ME, B));
    const seededWrites = setItemSpy.mock.calls.length; // the two fixture seeds above went through the spy
    const r = await render(<Harness userId="user-A" />);
    await settle();
    expect(queryClient.getQueryData(ME)).toEqual(A);
    // Hold one of A's writes in flight so B's transition suspends in its bounded drain.
    let releaseWrite: (() => void) | null = null;
    const realSet = realSetItem; // underlying mock storage, not the spy
    setItemSpy.mockImplementation(async (k: string, v: string) => {
      if (k === KEY_A && !releaseWrite) {
        await new Promise<void>((res) => {
          releaseWrite = res;
        });
      }
      return realSet(k, v);
    });
    await act(async () => {
      queryClient.setQueryData(['slow-write'], 'A-slow');
    });
    await settle(5);
    expect(releaseWrite).not.toBeNull();
    await r.rerender(<Harness userId="user-B" />);
    await settle(5); // B's transition is awaiting A's drain; activeRef is null here
    expect(getItemSpy.mock.calls.filter((c) => c[0] === KEY_B)).toEqual([]);
    // e.g. BiometricUnlockGate removes the navigator children while the transition is suspended.
    await r.unmount();
    const writesAtUnmount = setItemSpy.mock.calls.length;
    (releaseWrite as unknown as () => void)(); // A's old write lands after the unmount
    await settle(PERSISTED_CACHE_DRAIN_TIMEOUT_MS + 50);
    // The suspended body never continued: B's key was never read, no persistence for B exists.
    expect(getItemSpy.mock.calls.filter((c) => c[0] === KEY_B)).toEqual([]);
    expect(setItemSpy.mock.calls.slice(seededWrites).filter((c) => c[0] === KEY_B)).toEqual([]);
    // No orphan subscription: a later cache event on the shared client persists nothing.
    await act(async () => {
      queryClient.setQueryData(ME, { ...A, id: 'user-C', secret: 'C-private' });
    });
    await settle(1500);
    expect(setItemSpy.mock.calls.length).toBe(writesAtUnmount);
    expect(JSON.stringify(await blobQueries(KEY_B))).not.toContain('C-private');
    expect(JSON.stringify(await blobQueries(KEY_A))).not.toContain('C-private');
  });
});

describe('logout and unauthenticated state', () => {
  it('A → null clears memory before unauthenticated children render and persists nothing afterwards', async () => {
    await AsyncStorage.setItem(KEY_A, blobWith(ME, A));
    const r = await render(<Harness userId="user-A" />);
    await settle();
    expect(queryClient.getQueryData(ME)).toEqual(A);
    await r.rerender(<Harness userId={null} />);
    await settle();
    expect(r.getByTestId('private-anon').props.children).toBe('none');
    expect(frames.filter((f) => f.session === 'anon').some((f) => f.me !== undefined)).toBe(false);
    const before = setItemSpy.mock.calls.length;
    await act(async () => {
      queryClient.setQueryData(['anon-thing'], 1);
    });
    await settle(1500);
    expect(setItemSpy.mock.calls.length).toBe(before); // logged-out state is never persisted
  });

  it('unauthenticated from cold start never reads any persisted cache key', async () => {
    await AsyncStorage.setItem(KEY_A, blobWith(ME, A));
    const r = await render(<Harness userId={null} />);
    await settle();
    expect(r.getByTestId('private-anon')).toBeTruthy();
    expect(getItemSpy.mock.calls.filter((c) => String(c[0]).startsWith(QUERY_CACHE_KEY_PREFIX))).toEqual([]);
  });
});

describe('bounded restoring phase', () => {
  it('renders children with an empty cache after PERSISTED_CACHE_RESTORE_TIMEOUT_MS when storage hangs (no deadlock)', async () => {
    getItemSpy.mockImplementation(() => new Promise<never>(() => {}));
    const r = await render(<Harness userId="user-A" />);
    await settle(PERSISTED_CACHE_RESTORE_TIMEOUT_MS - 1);
    expect(r.queryByTestId('private-user-A')).toBeNull();
    await settle(2);
    expect(r.getByTestId('private-user-A').props.children).toBe('none');
  });

  it('a restore completing AFTER the timeout is discarded (explicit: no stale hydrate over the live session) while new writes persist', async () => {
    await AsyncStorage.setItem(KEY_A, blobWith(ME, { ...A, stale: true }));
    let release: (() => void) | null = null;
    const realGet = realGetItem; // underlying mock storage, not the spy
    getItemSpy.mockImplementation(async (k: string) => {
      if (k === KEY_A && !release) {
        await new Promise<void>((res) => {
          release = res;
        });
      }
      return realGet(k);
    });
    const r = await render(<Harness userId="user-A" />);
    await settle(PERSISTED_CACHE_RESTORE_TIMEOUT_MS + 1);
    expect(r.getByTestId('private-user-A').props.children).toBe('none');
    await act(async () => {
      queryClient.setQueryData(['fresh'], 'fresh-A'); // live session data
    });
    (release as unknown as () => void)(); // stale read completes late
    await settle(50);
    expect(queryClient.getQueryData(ME)).toBeUndefined(); // fenced at the restore→hydrate boundary
    expect(queryClient.getQueryData(['fresh'])).toBe('fresh-A');
    await settle(1500);
    const persisted = JSON.stringify(await blobQueries(KEY_A));
    expect(persisted).toContain('fresh-A');
    expect(persisted).not.toContain('"stale":true');
  });

  it('the timeout never commits an identity other than the requested one', async () => {
    getItemSpy.mockImplementation(() => new Promise<never>(() => {}));
    const r = await render(<Harness userId="user-A" />);
    await settle(PERSISTED_CACHE_RESTORE_TIMEOUT_MS / 2);
    await r.rerender(<Harness userId="user-B" />); // replaced mid-wait
    await settle(PERSISTED_CACHE_RESTORE_TIMEOUT_MS / 2 + 5); // A's timer would have fired here
    expect(r.queryByTestId('private-user-A')).toBeNull();
    expect(r.queryByTestId('private-user-B')).toBeNull(); // B's own bounded wait still running
    await settle(PERSISTED_CACHE_RESTORE_TIMEOUT_MS / 2 + 5);
    expect(r.getByTestId('private-user-B').props.children).toBe('none');
  });
});

describe('createIdentityPersistence (unit, real primitives)', () => {
  it('retire() before the read resolves reports retired and hydrates nothing; retire is idempotent', async () => {
    await AsyncStorage.setItem(KEY_A, blobWith(ME, A));
    let release: (() => void) | null = null;
    const realGet = realGetItem; // underlying mock storage, not the spy
    getItemSpy.mockImplementation(async (k: string) => {
      // Only the first KEY_A read is held; the release must not arm a second, unreleased wait.
      if (k === KEY_A && release === null) await new Promise<void>((res) => { release = res; });
      return realGet(k);
    });
    const p = createIdentityPersistence('user-A');
    const restoring = p.restore();
    // restore() defers the actual read by one microtask; retire only once the
    // read is really in flight so the restore→hydrate fence is what is tested.
    for (let i = 0; i < 10 && release === null; i += 1) await Promise.resolve();
    expect(release).not.toBeNull();
    p.retire();
    p.retire();
    (release as unknown as () => void)();
    expect(await restoring).toBe('retired');
    expect(queryClient.getQueryData(ME)).toBeUndefined();
    expect(p.isRetired()).toBe(true);
  });

  it('restore() reports restored/empty and only subscribes when not retired', async () => {
    const empty = createIdentityPersistence('user-B');
    expect(await empty.restore()).toBe('empty');
    empty.retire();
    await AsyncStorage.setItem(KEY_A, blobWith(ME, A));
    const p = createIdentityPersistence('user-A');
    expect(await p.restore()).toBe('restored');
    expect(queryClient.getQueryData(ME)).toEqual(A);
    // The fixture seed above went through the spy; only writes AFTER retirement count.
    const writesBeforeRetire = setItemSpy.mock.calls.length;
    p.retire();
    queryClient.setQueryData(['after-retire'], 1);
    await settle(1500);
    expect(setItemSpy.mock.calls.slice(writesBeforeRetire).filter((c) => c[0] === KEY_A)).toEqual([]);
  });

  it('restore({ timeoutMs }) reports timeout, subscribes, and discards the late completion at the hydrate boundary', async () => {
    await AsyncStorage.setItem(KEY_A, blobWith(ME, A));
    let release: (() => void) | null = null;
    const realGet = realGetItem; // underlying mock storage, not the spy
    getItemSpy.mockImplementation(async (k: string) => {
      if (k === KEY_A) await new Promise<void>((res) => { release = res; });
      return realGet(k);
    });
    const p = createIdentityPersistence('user-A');
    const restoring = p.restore({ timeoutMs: 100 });
    await settle(101);
    expect(await restoring).toBe('timeout');
    (release as unknown as () => void)();
    await settle(10);
    expect(queryClient.getQueryData(ME)).toBeUndefined();
    queryClient.setQueryData(['live'], 1);
    await settle(1500);
    expect(setItemSpy.mock.calls.filter((c) => c[0] === KEY_A).length).toBeGreaterThan(0);
    p.retire();
  });

  it('drain() resolves only after the in-flight storage write has actually completed', async () => {
    const p = createIdentityPersistence('user-A');
    expect(await p.restore()).toBe('empty');
    let release: (() => void) | null = null;
    const realSet = realSetItem; // underlying mock storage, not the spy
    setItemSpy.mockImplementation(async (k: string, v: string) => {
      if (k === KEY_A && !release) await new Promise<void>((res) => { release = res; });
      return realSet(k, v);
    });
    queryClient.setQueryData(['x'], 1);
    await settle(5);
    p.retire();
    let drained = false;
    const draining = p.drain().then((outcome) => {
      expect(outcome).toBe('drained');
      drained = true;
    });
    await settle(50);
    expect(drained).toBe(false);
    (release as unknown as () => void)();
    await draining;
    expect(drained).toBe(true);
  });

  it('drain({ timeoutMs }) reports timeout (never a silent success) and a write completing after retirement is removed again', async () => {
    const p = createIdentityPersistence('user-A');
    expect(await p.restore()).toBe('empty');
    let release: (() => void) | null = null;
    const realSet = realSetItem; // underlying mock storage, not the spy
    setItemSpy.mockImplementation(async (k: string, v: string) => {
      if (k === KEY_A && !release) await new Promise<void>((res) => { release = res; });
      return realSet(k, v);
    });
    const removeItemSpy = jest.spyOn(AsyncStorage, 'removeItem');
    queryClient.setQueryData(['x'], 1);
    await settle(5);
    p.retire();
    const draining = p.drain({ timeoutMs: 100 });
    await settle(101);
    expect(await draining).toBe('timeout');
    (release as unknown as () => void)();
    await settle(10);
    expect(removeItemSpy.mock.calls.some((c) => c[0] === KEY_A)).toBe(true);
    expect(await AsyncStorage.getItem(KEY_A)).toBeNull();
  });
});
