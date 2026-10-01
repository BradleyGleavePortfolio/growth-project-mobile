/**
 * PR-HK-2.a — healthKitSyncService tests.
 *
 * Stubs the client (requestAuth/readSamples) and the axios `api.post`;
 * progress lives in the (jest) AsyncStorage via `../../onDeviceState`.
 * Asserts:
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

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  HealthKitSyncService,
  HEALTHKIT_INGEST_PATH,
  HEALTHKIT_METRIC_KEYS,
  SYNC_OVERLAP_MINUTES,
  floorToLocalHour,
  DEFAULT_BACKFILL_DAYS,
} from '../healthKitSyncService';
import {
  getSyncProgress,
  setSyncProgress,
  type OnDeviceScope,
} from '../../onDeviceState';
import { OnDeviceSessionChangedError, type SessionFence } from '../../sessionFence';

const SCOPE: OnDeviceScope = { userId: 'user-a', connectionId: 'conn-1', source: 'APPLE_HEALTHKIT' };

/** Seed progress where every metric completed through `iso`. */
async function seedAllThrough(iso: string, scope: OnDeviceScope = SCOPE) {
  const completedThrough: Record<string, string> = {};
  for (const k of HEALTHKIT_METRIC_KEYS) completedThrough[k] = iso;
  await setSyncProgress(scope, { v: 1, completedThrough, resume: {} });
}

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

const OPTS = { scope: SCOPE, now: NOW };

beforeEach(async () => {
  await AsyncStorage.clear();
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

  it('persists per-metric progress = until for the scope on success', async () => {
    const svc = new HealthKitSyncService(makeClient(SAMPLE_READ) as never);
    const result = await svc.sync(OPTS);
    const progress = await getSyncProgress(SCOPE);
    for (const k of HEALTHKIT_METRIC_KEYS) expect(progress.completedThrough[k]).toBe(NOW.toISOString());
    expect(result.complete).toBe(true);
    expect(result.failedMetrics).toEqual([]);
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
    await seedAllThrough(cursor);
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

  it('B-317-1: progress is per account and connection, never provider-global', async () => {
    // Account A imported up to NOW.
    await seedAllThrough(NOW.toISOString());
    // Account B (same phone) and a recreated connection for A both start a
    // full 30-day import.
    const expectedSince = floorToLocalHour(
      new Date(NOW.getTime() - DEFAULT_BACKFILL_DAYS * 86400000),
    ).toISOString();
    for (const scope of [
      { ...SCOPE, userId: 'user-b' },
      { ...SCOPE, connectionId: 'conn-2' },
    ]) {
      const client = makeClient(SAMPLE_READ);
      await new HealthKitSyncService(client as never).sync({ scope, now: NOW });
      expect(client.readSamples.mock.calls[0][0].since.toISOString()).toBe(expectedSince);
    }
  });

  it('B-317-1: ignores the legacy provider-global secureStorage cursor', async () => {
    // A legacy cursor from before S14 must not shorten a new account's import.
    await AsyncStorage.setItem('healthkit_last_sync_at', NOW.toISOString());
    const client = makeClient(SAMPLE_READ);
    await new HealthKitSyncService(client as never).sync(OPTS);
    const expectedSince = floorToLocalHour(
      new Date(NOW.getTime() - DEFAULT_BACKFILL_DAYS * 86400000),
    );
    expect(client.readSamples.mock.calls[0][0].since.toISOString()).toBe(expectedSince.toISOString());
  });

  it('B-317-2: a failed metric keeps its progress and the run is not complete', async () => {
    const prior = '2026-05-20T00:00:00.000Z';
    await seedAllThrough(prior);
    const client = makeClient({ ...SAMPLE_READ, failed: ['weight'] });
    const result = await new HealthKitSyncService(client as never).sync(OPTS);
    expect(result.complete).toBe(false);
    expect(result.failedMetrics).toEqual(['weight']);
    const progress = await getSyncProgress(SCOPE);
    expect(progress.completedThrough.weight).toBe(prior);
    expect(progress.completedThrough.steps).toBe(NOW.toISOString());
    // The next run re-reads from the failed metric's progress.
    const again = makeClient(SAMPLE_READ);
    await new HealthKitSyncService(again as never).sync({ ...OPTS, now: new Date(NOW.getTime() + 3600_000) });
    const expected = floorToLocalHour(new Date(Date.parse(prior) - SYNC_OVERLAP_MINUTES * 60_000));
    expect(again.readSamples.mock.calls[0][0].since.toISOString()).toBe(expected.toISOString());
  });

  it('A-317-1: a session change stops the upload and saves no progress', async () => {
    const heartRate = Array.from({ length: 600 }, (_, i) => ({
      value: 60,
      startDate: new Date(Date.parse('2026-05-30T00:00:00.000Z') + i * 60_000).toISOString(),
      endDate: new Date(Date.parse('2026-05-30T00:00:00.000Z') + i * 60_000).toISOString(),
    }));
    let checks = 0;
    const fence: SessionFence = {
      userId: SCOPE.userId,
      assertCurrent: jest.fn(async () => {
        checks += 1;
        if (checks >= 2) throw new OnDeviceSessionChangedError();
      }),
    };
    const svc = new HealthKitSyncService(makeClient({ heartRate }) as never);
    await expect(svc.sync({ ...OPTS, fence })).rejects.toBeInstanceOf(OnDeviceSessionChangedError);
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect((await getSyncProgress(SCOPE)).completedThrough).toEqual({});
  });
});

describe('HealthKitSyncService.sync — error path', () => {
  it('does NOT advance lastSyncAt when the POST rejects', async () => {
    const prior = '2026-05-20T00:00:00.000Z';
    await seedAllThrough(prior);
    mockPost.mockRejectedValueOnce(new Error('500 ingest down'));

    const svc = new HealthKitSyncService(makeClient(SAMPLE_READ) as never);
    await expect(svc.sync(OPTS)).rejects.toThrow('500 ingest down');

    // Progress unchanged — next run safely re-pulls the same window.
    expect((await getSyncProgress(SCOPE)).completedThrough.steps).toBe(prior);
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
    expect((await getSyncProgress(SCOPE)).completedThrough).toEqual({});
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
    expect((await getSyncProgress(SCOPE)).completedThrough).toEqual({});
    expect(result.postedCount).toBe(0);
    expect(result.cursorAdvanced).toBe(false);
  });
});
