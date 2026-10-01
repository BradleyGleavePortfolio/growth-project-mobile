/**
 * PR-HK-2.a — healthKitSyncService tests.
 *
 * Stubs the client (requestAuth/readSamples), the axios `api.post`, and
 * `secureStorage`. Asserts:
 *  - the POST payload shape (NormalizedSample[] to the stub ingest path),
 *  - lastSyncAt persisted to the per-provider key on success,
 *  - the error path (POST rejects) does NOT advance lastSyncAt,
 *  - first-run backfill window, incremental window from a stored cursor,
 *  - empty-result short-circuit (no POST, no cursor write).
 */

import { Platform } from 'react-native';
import type { HealthKitQueryWindow, HealthKitReadResult } from '../healthKitClient';

// ── api mock (default export is the axios instance) ──
const mockPost = jest.fn();
jest.mock('../../../api', () => ({
  __esModule: true,
  default: { post: (...args: unknown[]) => mockPost(...args) },
}));

// ── secureStorage mock (in-memory) ──
// The backing Map is created INSIDE the factory (jest hoists `jest.mock` above
// top-level `const`s; an out-of-scope, non-`mock`-prefixed reference would be in
// the temporal dead zone and is disallowed). We hang the Map off the mocked
// module as `__store` so tests can seed / read it.
jest.mock('../../../secureStorage', () => {
  const backing = new Map<string, string>();
  return {
    __esModule: true,
    __store: backing,
    secureStorage: {
      getItem: jest.fn(async (k: string) => (backing.has(k) ? backing.get(k)! : null)),
      setItem: jest.fn(async (k: string, v: string) => {
        backing.set(k, v);
      }),
      removeItem: jest.fn(async (k: string) => {
        backing.delete(k);
      }),
    },
  };
});

import { secureStorage } from '../../../secureStorage';
import {
  HealthKitSyncService,
  HEALTHKIT_LAST_SYNC_KEY,
  HEALTHKIT_INGEST_PATH,
  SYNC_OVERLAP_MINUTES,
  floorToLocalHour,
  DEFAULT_BACKFILL_DAYS,
} from '../healthKitSyncService';

// Live handle to the in-memory store the mock created.
const store = (jest.requireMock('../../../secureStorage') as { __store: Map<string, string> })
  .__store;

const NOW = new Date('2026-05-31T12:00:00.000Z');

/** A fake client whose auth/read are jest-controllable. */
function makeClient(read: HealthKitReadResult) {
  return {
    requestAuth: jest.fn(async (_types?: unknown): Promise<void> => undefined),
    readSamples: jest.fn(
      async (_window: HealthKitQueryWindow): Promise<HealthKitReadResult> => read,
    ),
  };
}

const SAMPLE_READ: HealthKitReadResult = {
  steps: [{ value: 8000, startDate: '2026-05-30T00:00:00.000Z', endDate: '2026-05-31T00:00:00.000Z' }],
  heartRate: [{ value: 70, startDate: '2026-05-30T00:00:00.000Z', endDate: '2026-05-30T00:00:00.000Z' }],
};

const OPTS = { connectionId: 'conn-1', now: NOW };

beforeEach(() => {
  store.clear();
  jest.clearAllMocks();
  Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
  mockPost.mockResolvedValue({ data: { accepted: 2 } });
});

describe('HealthKitSyncService.sync — happy path', () => {
  it('requests auth, reads, normalizes, and POSTs NormalizedSample[] to the ingest path', async () => {
    const client = makeClient(SAMPLE_READ);
    const svc = new HealthKitSyncService(client as never);

    const result = await svc.sync(OPTS);

    expect(client.requestAuth).toHaveBeenCalledTimes(1);
    expect(client.readSamples).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledTimes(1);

    const [path, body] = mockPost.mock.calls[0];
    expect(path).toBe(HEALTHKIT_INGEST_PATH);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    // Every element is a NormalizedSample with the canonical fields.
    for (const s of body) {
      // S14: the body never names the subject user.
      expect(s).not.toHaveProperty('userId');
      expect(s).toMatchObject({
        connectionId: 'conn-1',
        provider: 'APPLE_HEALTHKIT',
      });
      expect(typeof s.metric).toBe('string');
      expect(typeof s.value).toBe('number');
      expect(typeof s.unit).toBe('string');
      expect(typeof s.startAt).toBe('string');
    }
    expect(result.postedCount).toBe(body.length);
    expect(result.cursorAdvanced).toBe(true);
  });

  it('persists lastSyncAt = until (the new cursor) on success', async () => {
    const svc = new HealthKitSyncService(makeClient(SAMPLE_READ) as never);
    await svc.sync(OPTS);
    expect(secureStorage.setItem).toHaveBeenCalledWith(
      HEALTHKIT_LAST_SYNC_KEY,
      NOW.toISOString(),
    );
    expect(store.get(HEALTHKIT_LAST_SYNC_KEY)).toBe(NOW.toISOString());
  });
});

describe('HealthKitSyncService.sync — read window', () => {
  it('backfills DEFAULT_BACKFILL_DAYS on the first run (no stored cursor)', async () => {
    const client = makeClient(SAMPLE_READ);
    await new HealthKitSyncService(client as never).sync(OPTS);
    const [{ since, until }] = client.readSamples.mock.calls[0];
    const expectedSince = floorToLocalHour(
      new Date(NOW.getTime() - DEFAULT_BACKFILL_DAYS * 86400000),
    );
    expect(since.toISOString()).toBe(expectedSince.toISOString());
    expect(until.toISOString()).toBe(NOW.toISOString());
  });

  it('S14: re-reads SYNC_OVERLAP_MINUTES behind the stored cursor, floored to the local hour', async () => {
    const cursor = '2026-05-29T10:25:00.000Z';
    store.set(HEALTHKIT_LAST_SYNC_KEY, cursor);
    const client = makeClient(SAMPLE_READ);
    await new HealthKitSyncService(client as never).sync(OPTS);
    const [{ since }] = client.readSamples.mock.calls[0];
    const expected = floorToLocalHour(new Date(Date.parse(cursor) - SYNC_OVERLAP_MINUTES * 60_000));
    expect(since.toISOString()).toBe(expected.toISOString());
    expect(since.getMinutes()).toBe(0);
    expect(since.getTime()).toBeLessThanOrEqual(Date.parse(cursor) - SYNC_OVERLAP_MINUTES * 60_000);
  });

  it('S14: splits a large import into request-sized batches', async () => {
    const heartRate = Array.from({ length: 600 }, (_, i) => ({
      value: 60 + (i % 40),
      startDate: new Date(Date.parse('2026-05-30T00:00:00.000Z') + i * 60_000).toISOString(),
      endDate: new Date(Date.parse('2026-05-30T00:00:00.000Z') + i * 60_000).toISOString(),
    }));
    const svc = new HealthKitSyncService(makeClient({ heartRate }) as never);
    const result = await svc.sync(OPTS);
    expect(result.postedCount).toBe(600);
    expect(mockPost.mock.calls.length).toBeGreaterThanOrEqual(3);
    const posted = mockPost.mock.calls.reduce(
      (n: number, call: unknown[]) => n + (call[1] as unknown[]).length,
      0,
    );
    expect(posted).toBe(600);
    for (const call of mockPost.mock.calls) {
      expect(JSON.stringify(call[1]).length).toBeLessThanOrEqual(90_000);
    }
  });

  it('ignores an unparseable stored cursor and backfills instead', async () => {
    store.set(HEALTHKIT_LAST_SYNC_KEY, 'not-a-date');
    const client = makeClient(SAMPLE_READ);
    await new HealthKitSyncService(client as never).sync(OPTS);
    const [{ since }] = client.readSamples.mock.calls[0];
    const expectedSince = floorToLocalHour(
      new Date(NOW.getTime() - DEFAULT_BACKFILL_DAYS * 86400000),
    );
    expect(since.toISOString()).toBe(expectedSince.toISOString());
  });
});

describe('HealthKitSyncService.sync — error path', () => {
  it('does NOT advance lastSyncAt when the POST rejects', async () => {
    const prior = '2026-05-20T00:00:00.000Z';
    store.set(HEALTHKIT_LAST_SYNC_KEY, prior);
    mockPost.mockRejectedValueOnce(new Error('500 ingest down'));

    const svc = new HealthKitSyncService(makeClient(SAMPLE_READ) as never);
    await expect(svc.sync(OPTS)).rejects.toThrow('500 ingest down');

    // Cursor unchanged — next run safely re-pulls the same window.
    expect(secureStorage.setItem).not.toHaveBeenCalled();
    expect(store.get(HEALTHKIT_LAST_SYNC_KEY)).toBe(prior);
  });

  it('propagates a readSamples failure without POSTing or advancing the cursor', async () => {
    const client = {
      requestAuth: jest.fn(async () => undefined),
      readSamples: jest.fn(async () => {
        throw new Error('read failed');
      }),
    };
    const svc = new HealthKitSyncService(client as never);
    await expect(svc.sync(OPTS)).rejects.toThrow('read failed');
    expect(mockPost).not.toHaveBeenCalled();
    expect(secureStorage.setItem).not.toHaveBeenCalled();
  });

  it('propagates a requestAuth failure (e.g. off-iOS unsupported)', async () => {
    const client = {
      requestAuth: jest.fn(async () => {
        throw new Error('HealthKit unsupported');
      }),
      readSamples: jest.fn(),
    };
    const svc = new HealthKitSyncService(client as never);
    await expect(svc.sync(OPTS)).rejects.toThrow('HealthKit unsupported');
    expect(client.readSamples).not.toHaveBeenCalled();
    expect(mockPost).not.toHaveBeenCalled();
  });
});

describe('HealthKitSyncService.sync — empty result', () => {
  it('does not POST and does not advance the cursor when there are no samples', async () => {
    const svc = new HealthKitSyncService(makeClient({}) as never);
    const result = await svc.sync(OPTS);
    expect(mockPost).not.toHaveBeenCalled();
    expect(secureStorage.setItem).not.toHaveBeenCalled();
    expect(result.postedCount).toBe(0);
    expect(result.cursorAdvanced).toBe(false);
  });
});

describe('HealthKitSyncService.getLastSyncAt', () => {
  it('returns null when no cursor is stored', async () => {
    expect(await new HealthKitSyncService(makeClient({}) as never).getLastSyncAt()).toBeNull();
  });

  it('returns the parsed Date when a valid cursor is stored', async () => {
    store.set(HEALTHKIT_LAST_SYNC_KEY, NOW.toISOString());
    const d = await new HealthKitSyncService(makeClient({}) as never).getLastSyncAt();
    expect(d?.toISOString()).toBe(NOW.toISOString());
  });
});
