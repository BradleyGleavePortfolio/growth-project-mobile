// PR-HK-2.b — healthConnectSyncService tests.
//
// Verifies the orchestration: platform guard, permission-denied path,
// since-lastSync windowing, normalize → POST, and lastSyncAt persistence
// (written only after a successful POST). secureStorage is mocked in-memory.

import { Platform } from 'react-native';

// In-memory secureStorage mock.
const store: Record<string, string> = {};
jest.mock('../../../secureStorage', () => ({
  secureStorage: {
    getItem: jest.fn((k: string) => Promise.resolve(store[k] ?? null)),
    setItem: jest.fn((k: string, v: string) => {
      store[k] = v;
      return Promise.resolve();
    }),
    removeItem: jest.fn((k: string) => {
      delete store[k];
      return Promise.resolve();
    }),
  },
}));

jest.mock('../../../../utils/logger', () => ({
  logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { HealthConnectPermissionDeniedError, HealthConnectUnsupportedError } from '../errors';
import {
  DEFAULT_BACKFILL_DAYS,
  LAST_SYNC_AT_KEY,
  SYNC_OVERLAP_MINUTES,
  clearLastSyncAt,
  getLastSyncAt,
  setLastSyncAt,
  syncHealthConnect,
  type HealthConnectSyncDeps,
} from '../healthConnectSyncService';
import { HEALTH_CONNECT_RECORD_TYPES } from '../healthConnectClient';

function setPlatform(os: string): void {
  Object.defineProperty(Platform, 'OS', { get: () => os, configurable: true });
}

const NOW = new Date('2026-05-10T12:00:00.000Z');

function makeClient(overrides: Partial<Record<string, jest.Mock>> = {}) {
  const grantedAll = HEALTH_CONNECT_RECORD_TYPES.map((rt) => ({
    accessType: 'read',
    recordType: rt,
  }));
  return {
    isHealthConnectSupported: jest.fn(() => true),
    buildReadPermissions: jest.fn(() => grantedAll),
    initialize: overrides.initialize ?? jest.fn().mockResolvedValue(true),
    requestPermission:
      overrides.requestPermission ?? jest.fn().mockResolvedValue(grantedAll),
    getGrantedPermissions:
      overrides.getGrantedPermissions ?? jest.fn().mockResolvedValue(grantedAll),
    readRecords:
      overrides.readRecords ??
      jest.fn().mockResolvedValue([]),
    readAllSupportedRecords: jest.fn().mockResolvedValue({}),
  };
}

function makeDeps(client: ReturnType<typeof makeClient>, ingest = jest.fn()): HealthConnectSyncDeps {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: client as any,
    ingestApi: { ingest: ingest.mockResolvedValue({ inserted: 0, skipped: 0 }) },
    now: () => NOW,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(store)) delete store[k];
  setPlatform('android');
});

describe('lastSyncAt persistence', () => {
  it('round-trips through secureStorage', async () => {
    expect(await getLastSyncAt()).toBeNull();
    await setLastSyncAt(NOW);
    expect(store[LAST_SYNC_AT_KEY]).toBe(NOW.toISOString());
    expect(await getLastSyncAt()).toEqual(NOW);
    await clearLastSyncAt();
    expect(await getLastSyncAt()).toBeNull();
  });

  it('returns null for a corrupt stored value', async () => {
    store[LAST_SYNC_AT_KEY] = 'not-a-date';
    expect(await getLastSyncAt()).toBeNull();
  });
});

describe('platform guard', () => {
  it('throws HealthConnectUnsupportedError on ios', async () => {
    setPlatform('ios');
    await expect(
      syncHealthConnect('u', 'c', makeDeps(makeClient())),
    ).rejects.toBeInstanceOf(HealthConnectUnsupportedError);
  });
});

describe('permission-denied path', () => {
  it('throws HealthConnectPermissionDeniedError when nothing is granted', async () => {
    const client = makeClient({
      getGrantedPermissions: jest.fn().mockResolvedValue([]),
    });
    await expect(
      syncHealthConnect('u', 'c', makeDeps(client)),
    ).rejects.toBeInstanceOf(HealthConnectPermissionDeniedError);
    // Watermark NOT written on a denied run.
    expect(store[LAST_SYNC_AT_KEY]).toBeUndefined();
  });

  it('proceeds with a partial grant (subset of record types)', async () => {
    const client = makeClient({
      getGrantedPermissions: jest
        .fn()
        .mockResolvedValue([{ accessType: 'read', recordType: 'Steps' }]),
      readRecords: jest.fn().mockResolvedValue([
        { startTime: NOW.toISOString(), endTime: NOW.toISOString(), count: 7 },
      ]),
    });
    const ingest = jest.fn();
    const res = await syncHealthConnect('u', 'c', makeDeps(client, ingest));
    expect(res.grantedRecordTypes).toEqual(['Steps']);
    // Only the granted type was read.
    expect(client.readRecords).toHaveBeenCalledTimes(1);
    expect(client.readRecords).toHaveBeenCalledWith('Steps', expect.anything());
    expect(res.normalizedCount).toBe(1);
  });
});

describe('windowing', () => {
  it('uses now - DEFAULT_BACKFILL_DAYS on first sync', async () => {
    const client = makeClient();
    await syncHealthConnect('u', 'c', makeDeps(client));
    const firstCallRange = client.readRecords.mock.calls[0][1];
    const expectedStart = new Date(
      NOW.getTime() - DEFAULT_BACKFILL_DAYS * 24 * 60 * 60_000,
    ).toISOString();
    expect(firstCallRange.startTime).toBe(expectedStart);
    expect(firstCallRange.endTime).toBe(NOW.toISOString());
  });

  it('uses lastSyncAt minus overlap on incremental sync', async () => {
    const last = new Date('2026-05-10T11:00:00.000Z');
    store[LAST_SYNC_AT_KEY] = last.toISOString();
    const client = makeClient();
    await syncHealthConnect('u', 'c', makeDeps(client));
    const range = client.readRecords.mock.calls[0][1];
    const expectedStart = new Date(
      last.getTime() - SYNC_OVERLAP_MINUTES * 60_000,
    ).toISOString();
    expect(range.startTime).toBe(expectedStart);
  });
});

describe('normalize → POST → persist', () => {
  it('posts normalized samples and persists watermark only after success', async () => {
    const client = makeClient({
      getGrantedPermissions: jest
        .fn()
        .mockResolvedValue([{ accessType: 'read', recordType: 'Weight' }]),
      readRecords: jest
        .fn()
        .mockResolvedValue([{ time: NOW.toISOString(), weight: { inKilograms: 80 } }]),
    });
    const ingest = jest.fn().mockResolvedValue({ inserted: 1, skipped: 0 });
    const res = await syncHealthConnect('user-9', 'conn-9', {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client: client as any,
      ingestApi: { ingest },
      now: () => NOW,
    });
    expect(ingest).toHaveBeenCalledTimes(1);
    const posted = ingest.mock.calls[0][0];
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({
      userId: 'user-9',
      connectionId: 'conn-9',
      provider: 'HEALTH_CONNECT',
      metric: 'BODY_WEIGHT_KG',
      value: 80,
    });
    expect(res.inserted).toBe(1);
    // Watermark persisted to NOW after success.
    expect(store[LAST_SYNC_AT_KEY]).toBe(NOW.toISOString());
  });

  it('does NOT persist watermark if POST throws', async () => {
    const client = makeClient();
    const ingest = jest.fn().mockRejectedValue(new Error('network'));
    await expect(
      syncHealthConnect('u', 'c', {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        client: client as any,
        ingestApi: { ingest },
        now: () => NOW,
      }),
    ).rejects.toThrow('network');
    expect(store[LAST_SYNC_AT_KEY]).toBeUndefined();
  });

  it('isolates a per-type read failure and still posts the rest', async () => {
    const client = makeClient({
      getGrantedPermissions: jest.fn().mockResolvedValue([
        { accessType: 'read', recordType: 'Steps' },
        { accessType: 'read', recordType: 'Weight' },
      ]),
      readRecords: jest.fn((rt: string) => {
        if (rt === 'Steps') return Promise.reject(new Error('read fail'));
        return Promise.resolve([{ time: NOW.toISOString(), weight: { inKilograms: 75 } }]);
      }),
    });
    const ingest = jest.fn().mockResolvedValue({ inserted: 1, skipped: 0 });
    const res = await syncHealthConnect('u', 'c', {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client: client as any,
      ingestApi: { ingest },
      now: () => NOW,
    });
    expect(res.normalizedCount).toBe(1);
    expect(ingest.mock.calls[0][0][0].metric).toBe('BODY_WEIGHT_KG');
  });
});
