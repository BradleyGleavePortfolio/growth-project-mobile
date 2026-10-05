// H8 — Health Connect late data (C-360-1) and resumable import (C-360-2).
//
// A fake Health Connect store holds records and pages them the way the
// library does (a page token per page). Its `between` filter keeps a record
// only when it lies wholly inside the range (the strictest reading), so a
// late record is found only if the read starts before it. Progress lives in
// the (jest) AsyncStorage via `../../onDeviceState`.

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { healthConnectEnabled: true } } },
}));
jest.mock('../../../../utils/logger', () => ({
  logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { syncHealthConnect, type HealthConnectSyncDeps } from '../healthConnectSyncService';
import { getSyncProgress, setSyncProgress, type OnDeviceScope } from '../../onDeviceState';
import { OnDeviceSessionChangedError, type SessionFence } from '../../sessionFence';

const SCOPE: OnDeviceScope = { userId: 'user-a', connectionId: 'c', source: 'HEALTH_CONNECT' };
const PAGE_SIZE = 2;

interface StoredRecord {
  startTime: string;
  endTime: string;
  count?: number;
}

/** A fake store: `records` by type; reads page PAGE_SIZE records at a time. */
function makeStore(records: Partial<Record<string, StoredRecord[]>>) {
  const failOn = new Map<string, number>();
  const readRecordsPaged = jest.fn(
    async (
      recordType: string,
      range: { startTime: string; endTime: string },
      resumeFrom?: string,
      _stop?: unknown,
      maxPages = 20,
    ) => {
      const inRange = (records[recordType] ?? []).filter(
        (r) => r.startTime >= range.startTime && r.endTime <= range.endTime,
      );
      let offset = resumeFrom ? Number(resumeFrom) : 0;
      const out: StoredRecord[] = [];
      for (let page = 0; page < maxPages; page += 1) {
        const fail = failOn.get(`${recordType}@${offset}`);
        if (fail !== undefined) {
          failOn.delete(`${recordType}@${offset}`);
          throw new Error('native read failed');
        }
        out.push(...inRange.slice(offset, offset + PAGE_SIZE));
        offset += PAGE_SIZE;
        if (offset >= inRange.length) return { records: out };
      }
      return { records: out, nextPageToken: String(offset) };
    },
  );
  const granted = Object.keys(records).map((recordType) => ({ accessType: 'read', recordType }));
  return {
    client: {
      isHealthConnectSupported: jest.fn(() => true),
      buildReadPermissions: jest.fn(() => granted),
      initialize: jest.fn().mockResolvedValue(true),
      requestPermission: jest.fn().mockResolvedValue(granted),
      getGrantedPermissions: jest.fn().mockResolvedValue(granted),
      readRecords: jest.fn().mockResolvedValue([]),
      readRecordsPaged,
      readAllSupportedRecords: jest.fn().mockResolvedValue({}),
    },
    /** Make the page that starts at record `offset` of `recordType` reject once. */
    failPageAt: (recordType: string, offset: number) => failOn.set(`${recordType}@${offset}`, 1),
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

function deps(
  client: unknown,
  now: Date,
  ingest: jest.Mock = jest.fn(async (s: unknown[]) => ({ inserted: s.length, skipped: 0 })),
  extra: Partial<HealthConnectSyncDeps> = {},
): HealthConnectSyncDeps {
  return { client: client as never, ingestApi: { ingest }, now: () => now, fence: okFence(), ...extra };
}

type Posted = { metric: string; value: number; startAt: Date };
const posted = (ingest: jest.Mock): Posted[] => ingest.mock.calls.flatMap((call) => call[0] as Posted[]);

/** `n` one-minute Steps records from `from`, one per minute. */
function stepsRecords(from: string, n: number): StoredRecord[] {
  return Array.from({ length: n }, (_, i) => {
    const s = Date.parse(from) + i * 60_000;
    return { startTime: new Date(s).toISOString(), endTime: new Date(s + 60_000).toISOString(), count: i + 1 };
  });
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  Object.defineProperty(Platform, 'OS', { get: () => 'android', configurable: true });
});

describe('C-360-1: a record written after the last sync is still read', () => {
  it('a night of sleep written after waking is posted on the next refresh', async () => {
    // The last refresh finished at 07:15; the watch wrote the night (23:00 to
    // 07:00) at 07:30. The next refresh runs at 08:00.
    await setSyncProgress(SCOPE, {
      v: 1,
      completedThrough: { SleepSession: '2026-05-10T07:15:00.000Z' },
      resume: {},
    });
    const store = makeStore({
      SleepSession: [{ startTime: '2026-05-09T23:00:00.000Z', endTime: '2026-05-10T07:00:00.000Z' }],
    });
    const ingest = jest.fn(async (s: unknown[]) => ({ inserted: s.length, skipped: 0 }));
    await syncHealthConnect(SCOPE, deps(store.client, new Date('2026-05-10T08:00:00.000Z'), ingest));
    expect(posted(ingest)).toEqual([
      expect.objectContaining({ metric: 'SLEEP_TOTAL_MIN', value: 480, startAt: new Date('2026-05-09T23:00:00.000Z') }),
    ]);
  });

  it('a watch record that synced 20 hours late is posted; progress then ends at now', async () => {
    await setSyncProgress(SCOPE, { v: 1, completedThrough: { Steps: '2026-05-10T12:00:00.000Z' }, resume: {} });
    const store = makeStore({ Steps: stepsRecords('2026-05-09T16:30:00.000Z', 1) });
    const ingest = jest.fn(async (s: unknown[]) => ({ inserted: s.length, skipped: 0 }));
    const now = new Date('2026-05-10T12:30:00.000Z');
    await syncHealthConnect(SCOPE, deps(store.client, now, ingest));
    expect(posted(ingest)).toHaveLength(1);
    expect((await getSyncProgress(SCOPE)).completedThrough.Steps).toBe(now.toISOString());
  });
});

describe('C-360-2: progress is saved after every page, so an interrupted import resumes', () => {
  const NOW = new Date('2026-05-10T12:00:00.000Z');

  it('a failed POST on page 3 keeps pages 1 and 2 saved; the next run reads only page 3 on', async () => {
    const store = makeStore({ Steps: stepsRecords('2026-05-01T00:00:00.000Z', 6) });
    let calls = 0;
    const failing = jest.fn(async (s: unknown[]) => {
      calls += 1;
      if (calls === 3) throw new Error('network');
      return { inserted: s.length, skipped: 0 };
    });
    await expect(syncHealthConnect(SCOPE, deps(store.client, NOW, failing))).rejects.toThrow('network');
    expect(posted(failing)).toHaveLength(6); // pages 1 and 2 posted; page 3 was handed in, then rejected
    const saved = await getSyncProgress(SCOPE);
    expect(saved.resume.Steps).toEqual(expect.objectContaining({ pageToken: '4' }));
    expect(saved.completedThrough.Steps).toBeUndefined();

    const ingest = jest.fn(async (s: unknown[]) => ({ inserted: s.length, skipped: 0 }));
    const res = await syncHealthConnect(SCOPE, deps(store.client, new Date(NOW.getTime() + 60_000), ingest));
    expect(posted(ingest).map((s) => s.value)).toEqual([5, 6]);
    expect(res.complete).toBe(true);
    const after = await getSyncProgress(SCOPE);
    expect(after.resume.Steps).toBeUndefined();
    expect(after.completedThrough.Steps).toBe(NOW.toISOString());
  });

  it('a failed native read on page 3 keeps pages 1 and 2 posted and saved, and the type is incomplete', async () => {
    const store = makeStore({ Steps: stepsRecords('2026-05-01T00:00:00.000Z', 6) });
    store.failPageAt('Steps', 4);
    const ingest = jest.fn(async (s: unknown[]) => ({ inserted: s.length, skipped: 0 }));
    const res = await syncHealthConnect(SCOPE, deps(store.client, NOW, ingest));
    expect(res.complete).toBe(false);
    expect(res.failedRecordTypes).toEqual(['Steps']);
    expect(posted(ingest).map((s) => s.value)).toEqual([1, 2, 3, 4]);
    // The token this run saved is kept: the next run goes on from page 3.
    expect((await getSyncProgress(SCOPE)).resume.Steps).toEqual(expect.objectContaining({ pageToken: '4' }));
    const next = jest.fn(async (s: unknown[]) => ({ inserted: s.length, skipped: 0 }));
    const res2 = await syncHealthConnect(SCOPE, deps(store.client, NOW, next));
    expect(posted(next).map((s) => s.value)).toEqual([5, 6]);
    expect(res2.complete).toBe(true);
  });

  it('sign-out while page 2 is read keeps page 1 saved and saves nothing after the stop', async () => {
    const store = makeStore({ Steps: stepsRecords('2026-05-01T00:00:00.000Z', 6) });
    let stopped = false;
    const fence: SessionFence = {
      userId: SCOPE.userId,
      assertCurrent: jest.fn(async () => {
        if (stopped) throw new OnDeviceSessionChangedError();
      }),
      throwIfStopped: jest.fn(() => {
        if (stopped) throw new OnDeviceSessionChangedError();
      }),
      cancel: jest.fn(),
    };
    const inner = store.client.readRecordsPaged.getMockImplementation()!;
    store.client.readRecordsPaged.mockImplementation(async (...args) => {
      const out = await inner(...args);
      if (args[2] === '2') stopped = true; // Log out tapped while page 2 was being read
      return out;
    });
    const ingest = jest.fn(async (s: unknown[]) => ({ inserted: s.length, skipped: 0 }));
    await expect(syncHealthConnect(SCOPE, deps(store.client, NOW, ingest, { fence }))).rejects.toBeInstanceOf(
      OnDeviceSessionChangedError,
    );
    expect(posted(ingest).map((s) => s.value)).toEqual([1, 2]);
    expect((await getSyncProgress(SCOPE)).resume.Steps).toEqual(expect.objectContaining({ pageToken: '2' }));
  });

  it('a resume-only pass reads only the types that still hold a resume token', async () => {
    await setSyncProgress(SCOPE, {
      v: 1,
      completedThrough: { Weight: NOW.toISOString() },
      resume: { Steps: { startTime: '2026-04-10T12:00:00.000Z', endTime: NOW.toISOString(), pageToken: '2' } },
    });
    const store = makeStore({
      Steps: stepsRecords('2026-05-01T00:00:00.000Z', 4),
      Weight: [],
    });
    const res = await syncHealthConnect(SCOPE, deps(store.client, NOW, undefined, { resumeOnly: true }));
    expect(store.client.readRecordsPaged.mock.calls.map((c) => c[0])).toEqual(['Steps']);
    expect(res.complete).toBe(true);
  });
});
