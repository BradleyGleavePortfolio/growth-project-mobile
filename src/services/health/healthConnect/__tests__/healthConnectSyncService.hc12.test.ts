// B-HC12-121 — Health Connect refresh cost (C-370-2) and one sleep session
// per night (C-370-3).
//
// A fake Health Connect store pages records the way the library does (a page
// token per page); its `between` filter keeps a record only when it lies
// wholly inside the range. Records carry `metadata.lastModifiedTime` as
// Health Connect stamps it. Posting runs through the REAL ingest API and
// batching with the shared axios instance mocked, so the request count is
// what the backend would see. Synthetic data only.

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AxiosError, AxiosHeaders } from 'axios';

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { healthConnectEnabled: true } } },
}));
jest.mock('../../../../utils/logger', () => ({
  logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
const mockPost = jest.fn();
jest.mock('../../../api', () => ({
  __esModule: true,
  default: { post: (...args: unknown[]) => mockPost(...args) },
}));

import { syncHealthConnect, type HealthConnectSyncDeps } from '../healthConnectSyncService';
import { createIngestPacer, INGEST_REQUESTS_PER_WINDOW, WEARABLES_INGEST_PATH } from '../../ingestBatching';
import { getSyncProgress, setSyncProgress, type OnDeviceScope } from '../../onDeviceState';
import type { SessionFence } from '../../sessionFence';

const SCOPE: OnDeviceScope = { userId: 'user-hc12', connectionId: 'c', source: 'HEALTH_CONNECT' };
const MIN = 60_000;
const iso = (t: number): string => new Date(t).toISOString();

type StoredRecord = Record<string, unknown> & { metadata?: { id: string; lastModifiedTime?: string } };

function recordTimes(r: StoredRecord): { start: string; end: string } {
  const start = (r.startTime ?? r.time) as string;
  const end = (r.endTime ?? r.time) as string;
  return { start, end };
}

function makeStore(records: Partial<Record<string, StoredRecord[]>>, pageSize = 1000) {
  const readRecordsPaged = jest.fn(
    async (recordType: string, range: { startTime: string; endTime: string }, resumeFrom?: string) => {
      const inRange = (records[recordType] ?? []).filter((r) => {
        const { start, end } = recordTimes(r);
        return start >= range.startTime && end <= range.endTime;
      });
      const offset = resumeFrom ? Number(resumeFrom) : 0;
      const page = inRange.slice(offset, offset + pageSize);
      const next = offset + pageSize;
      return next < inRange.length ? { records: page, nextPageToken: String(next) } : { records: page };
    },
  );
  const granted = Object.keys(records).map((recordType) => ({ accessType: 'read', recordType }));
  return {
    isHealthConnectSupported: jest.fn(() => true),
    buildReadPermissions: jest.fn(() => granted),
    initialize: jest.fn().mockResolvedValue(true),
    requestPermission: jest.fn().mockResolvedValue(granted),
    getGrantedPermissions: jest.fn().mockResolvedValue(granted),
    readRecords: jest.fn().mockResolvedValue([]),
    readRecordsPaged,
    readAllSupportedRecords: jest.fn().mockResolvedValue({}),
  };
}

function okFence(): SessionFence {
  return {
    userId: SCOPE.userId,
    assertCurrent: jest.fn(async () => undefined),
    throwIfStopped: jest.fn(),
    cancel: jest.fn(),
  };
}

function deps(client: unknown, now: Date, extra: Partial<HealthConnectSyncDeps> = {}): HealthConnectSyncDeps {
  return { client: client as never, now: () => now, fence: okFence(), ...extra };
}

type Wire = { metric: string; value: number; startAt: string; endAt: string; sourceRecordId?: string };
const posted = (): Wire[] => mockPost.mock.calls.flatMap((call) => call[1] as Wire[]);

/** Five-minute HeartRate records, one sample every 5 s, written `writtenAfterMs` after each ends. */
function heartRate(fromMs: number, toMs: number, writtenAfterMs: number, idPrefix: string): StoredRecord[] {
  const out: StoredRecord[] = [];
  for (let s = fromMs; s + 5 * MIN <= toMs; s += 5 * MIN) {
    const samples = Array.from({ length: 60 }, (_, i) => ({ time: iso(s + i * 5_000), beatsPerMinute: 60 + (i % 20) }));
    out.push({
      startTime: iso(s),
      endTime: iso(s + 5 * MIN),
      samples,
      metadata: { id: `${idPrefix}-${s}`, lastModifiedTime: iso(s + 5 * MIN + writtenAfterMs) },
    });
  }
  return out;
}

async function seed(completedThrough: Record<string, string>) {
  await setSyncProgress(SCOPE, { v: 1, completedThrough, resume: {} });
}

function rateLimited(retryAfterSeconds: string): AxiosError {
  const headers = new AxiosHeaders();
  headers.set('retry-after', retryAfterSeconds);
  return new AxiosError('rate limited', '429', undefined, undefined, {
    status: 429,
    statusText: 'Too Many Requests',
    headers,
    config: { headers: new AxiosHeaders() },
    data: {},
  });
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
  mockPost.mockImplementation(async (_path: string, body: unknown[]) => ({ data: { inserted: body.length, skipped: 0 } }));
});

describe('HC12-HC-1 (C-370-2, failing before): a refresh posts only what changed since the last read', () => {
  it('a day of 5-second heart rate already posted is not posted again; the new hour is', async () => {
    const T = Date.parse('2026-10-05T18:00:00.000Z'); // last completed read
    const NOW = new Date('2026-10-05T19:00:00.000Z');
    await seed({ HeartRate: iso(T) });
    const old = heartRate(T - 24 * 60 * MIN, T, 2 * MIN, 'old'); // 288 records, 17,280 samples
    const fresh = heartRate(T, T + 55 * MIN, MIN, 'new'); // 11 records written after the last read
    const client = makeStore({ HeartRate: [...old, ...fresh] });

    const res = await syncHealthConnect(SCOPE, deps(client, NOW));

    // Before the fix: 17,940 samples in 72 requests, over the backend's 60 per minute.
    const requests = mockPost.mock.calls.length;
    expect(requests).toBeLessThanOrEqual(50);
    expect(requests).toBe(4);
    expect(INGEST_REQUESTS_PER_WINDOW).toBe(50);
    // Posted: the 11 new records plus the 4 old ones written within the margin before the last read.
    const ids = new Set(posted().map((s) => s.sourceRecordId));
    for (const r of fresh) expect(ids.has(r.metadata!.id)).toBe(true);
    expect(posted()).toHaveLength(15 * 60);
    expect(res.complete).toBe(true);
    expect(res.normalizedCount).toBe(15 * 60);
    expect((await getSyncProgress(SCOPE)).completedThrough.HeartRate).toBe(NOW.toISOString());
    for (const call of mockPost.mock.calls) expect(call[0]).toBe(WEARABLES_INGEST_PATH);
  });
});

describe('HC12-HC-2: nothing that may be unposted is skipped', () => {
  const T = Date.parse('2026-10-05T18:00:00.000Z');
  const NOW = new Date('2026-10-05T19:00:00.000Z');
  const weight = (at: number, id: string, lastModified?: number): StoredRecord => ({
    time: iso(at),
    weight: { inKilograms: 80 },
    metadata: lastModified === undefined ? { id } : { id, lastModifiedTime: iso(lastModified) },
  });

  it('posts a record changed after the last read, one without a modification time, and one at the progress edge', async () => {
    await seed({ Weight: iso(T) });
    const client = makeStore({
      Weight: [
        weight(T - 10 * 60 * MIN, 'seen', T - 9 * 60 * MIN), // posted by the last read: skipped
        weight(T - 10 * 60 * MIN + MIN, 'changed', T + 10 * MIN), // rewritten after the last read
        weight(T - 9 * 60 * MIN, 'no-mtime'), // no modification time: never skipped
        weight(T, 'edge', T - 60 * MIN), // at the saved progress: not wholly inside the last read
        weight(T - 30 * MIN, 'margin', T - 10 * MIN), // written within the margin before the last read
      ],
    });
    await syncHealthConnect(SCOPE, deps(client, NOW));
    expect(posted().map((s) => s.sourceRecordId).sort()).toEqual(['changed', 'edge', 'margin', 'no-mtime']);
  });

  it('a first import (no progress) and a resumed page post every record', async () => {
    const client = makeStore(
      { Weight: [weight(T - 3 * MIN, 'a', T - 2 * MIN), weight(T - 2 * MIN, 'b', T - MIN), weight(T - MIN, 'c', T - MIN)] },
      2,
    );
    await syncHealthConnect(SCOPE, deps(client, new Date(T), { resumeOnly: false }));
    expect(posted().map((s) => s.sourceRecordId)).toEqual(['a', 'b', 'c']);

    mockPost.mockClear();
    await setSyncProgress(SCOPE, {
      v: 1,
      completedThrough: { Weight: iso(T) },
      resume: { Weight: { startTime: iso(T - 24 * 60 * MIN), endTime: iso(T), pageToken: '0' } },
    });
    await syncHealthConnect(SCOPE, deps(client, NOW));
    // The resumed range is posted whole (it was never completed), then progress is the range end.
    expect(posted().map((s) => s.sourceRecordId)).toEqual(['a', 'b', 'c']);
  });
});

describe('HC12-HC-3 (C-370-3, failing before): one sleep session per night', () => {
  const night = (id: string, start: string, end: string, lastModified: string, stages = 0): StoredRecord => ({
    startTime: start,
    endTime: end,
    stages: Array.from({ length: stages }, (_, i) => {
      const s = Date.parse(start) + i * 30 * MIN;
      return { startTime: iso(s), endTime: iso(s + 30 * MIN), stage: 4 };
    }),
    metadata: { id, lastModifiedTime: lastModified },
  });
  const totals = (): Array<[string, number]> =>
    posted()
      .filter((s) => s.metric === 'SLEEP_TOTAL_MIN')
      .map((s) => [s.sourceRecordId ?? '', s.value]);

  it('330 + 180 minutes for one night from two apps counts once; a separate nap still counts', async () => {
    const client = makeStore({
      SleepSession: [
        night('watch', '2026-10-05T00:30:00.000Z', '2026-10-05T06:00:00.000Z', '2026-10-05T06:10:00.000Z', 4), // 330
        night('phone', '2026-10-05T03:00:00.000Z', '2026-10-05T06:00:00.000Z', '2026-10-05T06:20:00.000Z'), // 180
        night('nap', '2026-10-05T14:00:00.000Z', '2026-10-05T14:40:00.000Z', '2026-10-05T14:45:00.000Z'), // 40
      ],
    });
    await syncHealthConnect(SCOPE, deps(client, new Date('2026-10-05T19:00:00.000Z')));
    expect(totals()).toEqual([
      ['watch', 330],
      ['nap', 40],
    ]);
    // Every sleep sample of the night comes from the one kept session.
    expect(posted().filter((s) => s.sourceRecordId === 'phone')).toEqual([]);
  });

  it('a session that arrives after the night was posted does not count the night again', async () => {
    await seed({ SleepSession: '2026-10-05T08:00:00.000Z' });
    const client = makeStore({
      SleepSession: [
        night('posted', '2026-10-05T00:30:00.000Z', '2026-10-05T06:00:00.000Z', '2026-10-05T06:10:00.000Z'),
        night('late', '2026-10-05T03:00:00.000Z', '2026-10-05T06:00:00.000Z', '2026-10-05T09:00:00.000Z', 6),
      ],
    });
    await syncHealthConnect(SCOPE, deps(client, new Date('2026-10-05T12:00:00.000Z')));
    expect(totals()).toEqual([]);
  });
});

describe('HC12-HC-4 (C-370-2): a 429 keeps progress and the next run resumes after a Retry-After hold', () => {
  it('stops after the bounded retries with the saved page kept, then resumes there without re-posting', async () => {
    let clock = Date.parse('2026-10-05T19:00:00.000Z');
    const times: number[] = [];
    const pacer = createIngestPacer({
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    });
    const steps = Array.from({ length: 6 }, (_, i): StoredRecord => {
      const s = Date.parse('2026-10-05T10:00:00.000Z') + i * MIN;
      return { startTime: iso(s), endTime: iso(s + MIN), count: i + 1, metadata: { id: `s${i}` } };
    });
    const client = makeStore({ Steps: steps }, 2);
    mockPost.mockImplementation(async (_p: string, body: unknown[]) => {
      times.push(clock);
      if (times.length >= 2 && times.length <= 4) throw rateLimited('30');
      return { data: { inserted: body.length, skipped: 0 } };
    });
    const now = new Date('2026-10-05T19:00:00.000Z');

    await expect(syncHealthConnect(SCOPE, deps(client, now, { pacer }))).rejects.toBeInstanceOf(AxiosError);
    const saved = await getSyncProgress(SCOPE);
    expect(saved.resume.Steps?.pageToken).toBe('2');
    expect(saved.completedThrough.Steps).toBeUndefined();

    await syncHealthConnect(SCOPE, deps(client, now, { pacer }));
    // Page 1 once, page 2 three times (429), then pages 2 and 3; each retry and the next run waited 30 s.
    expect(posted().map((s) => s.sourceRecordId)).toEqual(['s0', 's1', 's2', 's3', 's2', 's3', 's2', 's3', 's2', 's3', 's4', 's5']);
    expect(times.map((t) => (t - times[0]) / 1000)).toEqual([0, 0, 30, 60, 90, 90]);
    expect((await getSyncProgress(SCOPE)).completedThrough.Steps).toBe(now.toISOString());
  });
});
