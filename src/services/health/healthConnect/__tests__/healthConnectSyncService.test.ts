// PR-HK-2.b — healthConnectSyncService tests.
//
// Verifies the orchestration: platform guard, permission-denied path,
// per-scope per-type windowing (S14 B-317-1), page-bound resume and failed
// reads that never count as complete (S14 B-317-2), normalize → POST, and
// progress persisted only after a successful POST. Progress lives in the
// (jest) AsyncStorage via `../../onDeviceState`.

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { healthConnectEnabled: true } } },
}));

jest.mock('../../../../utils/logger', () => ({
  logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// The native Health Connect module (used only by the real-client B-317-7 test).
jest.mock('react-native-health-connect', () => ({
  readRecords: jest.fn(),
}));

// Who the identity cache says is signed in (real fence in the B-317-7 test).
let mockSignedIn: string | null = 'user-a';
jest.mock('../../../../lib/userCache', () => ({
  readUserCache: jest.fn(async () => (mockSignedIn ? { id: mockSignedIn } : null)),
}));

import { HealthConnectPermissionDeniedError, HealthConnectUnsupportedError } from '../errors';
import {
  DEFAULT_BACKFILL_DAYS,
  SYNC_OVERLAP_MINUTES,
  syncHealthConnect,
  type HealthConnectSyncDeps,
} from '../healthConnectSyncService';
import { HEALTH_CONNECT_RECORD_TYPES, type PagedReadResult } from '../healthConnectClient';
import { getSyncProgress, setSyncProgress, type OnDeviceScope } from '../../onDeviceState';
import * as hcNative from 'react-native-health-connect';
import * as realClient from '../healthConnectClient';
import {
  beginSessionFence,
  OnDeviceSessionChangedError,
  stopOnDeviceHealthWork,
  type SessionFence,
} from '../../sessionFence';
import { authEvents } from '../../../../utils/authEvents';

function setPlatform(os: string): void {
  Object.defineProperty(Platform, 'OS', { get: () => os, configurable: true });
}

const NOW = new Date('2026-05-10T12:00:00.000Z');
const SCOPE: OnDeviceScope = { userId: 'user-a', connectionId: 'c', source: 'HEALTH_CONNECT' };
const IMPORT_START = new Date(NOW.getTime() - DEFAULT_BACKFILL_DAYS * 24 * 60 * 60_000).toISOString();

type PagedFn = (rt: string, range: unknown, token?: string) => Promise<PagedReadResult>;

function makeClient(overrides: Partial<Record<string, jest.Mock>> = {}) {
  const grantedAll = HEALTH_CONNECT_RECORD_TYPES.map((rt) => ({
    accessType: 'read',
    recordType: rt,
  }));
  return {
    isHealthConnectSupported: jest.fn(() => true),
    buildReadPermissions: jest.fn(() => grantedAll),
    initialize: overrides.initialize ?? jest.fn().mockResolvedValue(true),
    requestPermission: overrides.requestPermission ?? jest.fn().mockResolvedValue(grantedAll),
    getGrantedPermissions:
      overrides.getGrantedPermissions ?? jest.fn().mockResolvedValue(grantedAll),
    readRecords: jest.fn().mockResolvedValue([]),
    readRecordsPaged:
      overrides.readRecordsPaged ?? jest.fn<ReturnType<PagedFn>, Parameters<PagedFn>>().mockResolvedValue({ records: [] }),
    readAllSupportedRecords: jest.fn().mockResolvedValue({}),
  };
}

function grantOnly(...types: string[]) {
  return jest.fn().mockResolvedValue(types.map((recordType) => ({ accessType: 'read', recordType })));
}

function makeDeps(
  client: ReturnType<typeof makeClient>,
  ingest: jest.Mock = jest.fn().mockResolvedValue({ inserted: 0, skipped: 0 }),
  extra: Partial<HealthConnectSyncDeps> = {},
): HealthConnectSyncDeps {
  return {
    client: client as never,
    ingestApi: { ingest },
    now: () => NOW,
    fence: okFence(),
    ...extra,
  };
}

function okFence(userId: string = SCOPE.userId): SessionFence {
  return {
    userId,
    assertCurrent: jest.fn(async () => undefined),
    throwIfStopped: jest.fn(),
    cancel: jest.fn(),
  };
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  setPlatform('android');
});

describe('platform guard', () => {
  it('throws HealthConnectUnsupportedError on ios', async () => {
    setPlatform('ios');
    await expect(syncHealthConnect(SCOPE, makeDeps(makeClient()))).rejects.toBeInstanceOf(
      HealthConnectUnsupportedError,
    );
  });
});

describe('permission-denied path', () => {
  it('throws HealthConnectPermissionDeniedError when nothing is granted', async () => {
    const client = makeClient({ getGrantedPermissions: jest.fn().mockResolvedValue([]) });
    await expect(syncHealthConnect(SCOPE, makeDeps(client))).rejects.toBeInstanceOf(
      HealthConnectPermissionDeniedError,
    );
    expect((await getSyncProgress(SCOPE)).completedThrough).toEqual({});
  });

  it('proceeds with a partial grant (subset of record types)', async () => {
    const client = makeClient({
      getGrantedPermissions: grantOnly('Steps'),
      readRecordsPaged: jest.fn().mockResolvedValue({
        records: [{ startTime: NOW.toISOString(), endTime: NOW.toISOString(), count: 7 }],
      }),
    });
    const res = await syncHealthConnect(SCOPE, makeDeps(client));
    expect(res.grantedRecordTypes).toEqual(['Steps']);
    expect(client.readRecordsPaged).toHaveBeenCalledTimes(1);
    expect(client.readRecordsPaged).toHaveBeenCalledWith(
      'Steps',
      expect.anything(),
      undefined,
      expect.objectContaining({ throwIfStopped: expect.any(Function) }),
    );
    expect(res.normalizedCount).toBe(1);
    expect(res.complete).toBe(true);
  });
});

describe('windowing (per scope, per type)', () => {
  it('imports DEFAULT_BACKFILL_DAYS on the first sync of a scope', async () => {
    const client = makeClient({ getGrantedPermissions: grantOnly('Steps') });
    await syncHealthConnect(SCOPE, makeDeps(client));
    const range = client.readRecordsPaged.mock.calls[0][1];
    expect(range).toEqual({ startTime: IMPORT_START, endTime: NOW.toISOString() });
  });

  it('reads from the type progress minus overlap on an incremental sync', async () => {
    const last = '2026-05-10T11:00:00.000Z';
    await setSyncProgress(SCOPE, { v: 1, completedThrough: { Steps: last }, resume: {} });
    const client = makeClient({ getGrantedPermissions: grantOnly('Steps') });
    await syncHealthConnect(SCOPE, makeDeps(client));
    expect(client.readRecordsPaged.mock.calls[0][1].startTime).toBe(
      new Date(Date.parse(last) - SYNC_OVERLAP_MINUTES * 60_000).toISOString(),
    );
  });

  it('B-317-1: a second account or a recreated connection starts its own 30-day import', async () => {
    await setSyncProgress(SCOPE, { v: 1, completedThrough: { Steps: NOW.toISOString() }, resume: {} });
    for (const scope of [
      { ...SCOPE, userId: 'user-b' },
      { ...SCOPE, connectionId: 'c-2' },
    ]) {
      const client = makeClient({ getGrantedPermissions: grantOnly('Steps') });
      await syncHealthConnect(scope, makeDeps(client, undefined, { fence: okFence(scope.userId) }));
      expect(client.readRecordsPaged.mock.calls[0][1].startTime).toBe(IMPORT_START);
    }
  });
});

describe('B-317-2 completeness', () => {
  it('a page-bounded read keeps a resume token, is not complete, and resumes next run', async () => {
    const client = makeClient({
      getGrantedPermissions: grantOnly('Steps'),
      readRecordsPaged: jest.fn().mockResolvedValue({
        records: [{ startTime: NOW.toISOString(), endTime: NOW.toISOString(), count: 3 }],
        nextPageToken: 'tok-21',
      }),
    });
    const res = await syncHealthConnect(SCOPE, makeDeps(client));
    expect(res.complete).toBe(false);
    expect(res.truncatedRecordTypes).toEqual(['Steps']);
    const progress = await getSyncProgress(SCOPE);
    expect(progress.completedThrough.Steps).toBeUndefined();
    expect(progress.resume.Steps).toEqual({
      startTime: IMPORT_START,
      endTime: NOW.toISOString(),
      pageToken: 'tok-21',
    });

    // Next run resumes the SAME window from the token, then completes.
    const later = new Date(NOW.getTime() + 60_000);
    const next = makeClient({
      getGrantedPermissions: grantOnly('Steps'),
      readRecordsPaged: jest.fn().mockResolvedValue({ records: [] }),
    });
    const res2 = await syncHealthConnect(SCOPE, makeDeps(next, undefined, { now: () => later }));
    expect(next.readRecordsPaged).toHaveBeenCalledWith(
      'Steps',
      { startTime: IMPORT_START, endTime: NOW.toISOString() },
      'tok-21',
      expect.anything(),
    );
    expect(res2.complete).toBe(true);
    const after = await getSyncProgress(SCOPE);
    expect(after.resume.Steps).toBeUndefined();
    expect(after.completedThrough.Steps).toBe(NOW.toISOString());
  });

  it('a failed read keeps that type\u2019s progress while the others advance', async () => {
    const prior = '2026-05-01T00:00:00.000Z';
    await setSyncProgress(SCOPE, {
      v: 1,
      completedThrough: { Steps: prior, Weight: prior },
      resume: {},
    });
    const client = makeClient({
      getGrantedPermissions: grantOnly('Steps', 'Weight'),
      readRecordsPaged: jest.fn((rt: string) => {
        if (rt === 'Weight') return Promise.reject(new Error('native read failed'));
        return Promise.resolve({ records: [] });
      }),
    });
    const res = await syncHealthConnect(SCOPE, makeDeps(client));
    expect(res.complete).toBe(false);
    expect(res.failedRecordTypes).toEqual(['Weight']);
    const progress = await getSyncProgress(SCOPE);
    expect(progress.completedThrough.Weight).toBe(prior);
    expect(progress.completedThrough.Steps).toBe(NOW.toISOString());
  });

  it('a failed resume drops the token and keeps the old progress', async () => {
    await setSyncProgress(SCOPE, {
      v: 1,
      completedThrough: {},
      resume: { Steps: { startTime: IMPORT_START, endTime: NOW.toISOString(), pageToken: 'stale' } },
    });
    const client = makeClient({
      getGrantedPermissions: grantOnly('Steps'),
      readRecordsPaged: jest.fn().mockRejectedValue(new Error('token expired')),
    });
    const res = await syncHealthConnect(SCOPE, makeDeps(client));
    expect(res.complete).toBe(false);
    const progress = await getSyncProgress(SCOPE);
    expect(progress.resume.Steps).toBeUndefined();
    expect(progress.completedThrough.Steps).toBeUndefined();
  });
});

describe('normalize → POST → persist', () => {
  it('posts normalized samples and persists progress only after success', async () => {
    const client = makeClient({
      getGrantedPermissions: grantOnly('Weight'),
      readRecordsPaged: jest
        .fn()
        .mockResolvedValue({ records: [{ time: NOW.toISOString(), weight: { inKilograms: 80 } }] }),
    });
    const ingest = jest.fn().mockResolvedValue({ inserted: 1, skipped: 0 });
    const res = await syncHealthConnect({ ...SCOPE, connectionId: 'conn-9' }, makeDeps(client, ingest));
    expect(ingest).toHaveBeenCalledTimes(1);
    const posted = ingest.mock.calls[0][0];
    expect(posted).toHaveLength(1);
    expect(posted[0]).not.toHaveProperty('userId');
    expect(posted[0]).toMatchObject({
      connectionId: 'conn-9',
      provider: 'HEALTH_CONNECT',
      metric: 'BODY_WEIGHT_KG',
      value: 80,
    });
    expect(res.inserted).toBe(1);
    const progress = await getSyncProgress({ ...SCOPE, connectionId: 'conn-9' });
    expect(progress.completedThrough.Weight).toBe(NOW.toISOString());
  });

  it('does NOT persist progress if POST throws', async () => {
    const client = makeClient();
    const ingest = jest.fn().mockRejectedValue(new Error('network'));
    await expect(syncHealthConnect(SCOPE, makeDeps(client, ingest))).rejects.toThrow('network');
    expect((await getSyncProgress(SCOPE)).completedThrough).toEqual({});
  });

  it('A-317-1: passes the fence to every request and saves nothing after a session change', async () => {
    const client = makeClient({ getGrantedPermissions: grantOnly('Steps') });
    const fence: SessionFence = {
      userId: SCOPE.userId,
      assertCurrent: jest.fn().mockRejectedValue(new OnDeviceSessionChangedError()),
      throwIfStopped: jest.fn(),
      cancel: jest.fn(),
    };
    const ingest = jest.fn(
      async (_s: unknown[], deps?: { beforeEachRequest?: () => Promise<void> | void }) => {
        if (deps?.beforeEachRequest) await deps.beforeEachRequest();
        return { inserted: 0, skipped: 0 };
      },
    );
    await expect(
      syncHealthConnect(SCOPE, makeDeps(client, ingest as jest.Mock, { fence })),
    ).rejects.toBeInstanceOf(OnDeviceSessionChangedError);
    expect((await getSyncProgress(SCOPE)).completedThrough).toEqual({});
  });
});

describe('A-317-1 round 3: the fence is required and checked before the phone is read', () => {
  it('reads nothing when the fence belongs to another person than the scope', async () => {
    const client = makeClient();
    await expect(
      syncHealthConnect(SCOPE, makeDeps(client, undefined, { fence: okFence('user-b') })),
    ).rejects.toBeInstanceOf(OnDeviceSessionChangedError);
    expect(client.initialize).not.toHaveBeenCalled();
    expect(client.readRecordsPaged).not.toHaveBeenCalled();
  });

  it('reads nothing when the session changes during the permission screen', async () => {
    let calls = 0;
    const fence: SessionFence = {
      userId: SCOPE.userId,
      assertCurrent: jest.fn(async () => {
        calls += 1;
        if (calls >= 2) throw new OnDeviceSessionChangedError();
      }),
      throwIfStopped: jest.fn(),
      cancel: jest.fn(),
    };
    const ingest = jest.fn();
    const client = makeClient({ getGrantedPermissions: grantOnly('Steps') });
    await expect(
      syncHealthConnect(SCOPE, makeDeps(client, ingest, { fence })),
    ).rejects.toBeInstanceOf(OnDeviceSessionChangedError);
    expect(client.readRecordsPaged).not.toHaveBeenCalled();
    expect(ingest).not.toHaveBeenCalled();
  });
});

/**
 * S-WEAR-3 (Sol B-317-7, AUD-SOL-5 reproduction): the REAL paged client, the
 * REAL session fence and the REAL auth events. Grant Steps, HeartRate and
 * Weight; sign out while the first native Steps read is in flight and
 * returns a continuation token. Before the fix the run went on to start
 * Steps page 2, HeartRate and Weight (4 native calls). Now no new page or
 * record type starts: exactly 1 native call, nothing posted, no progress.
 */
describe('B-317-7: no native read starts after sign-out', () => {
  const mockNativeRead = hcNative.readRecords as jest.Mock;
  const client = {
    ...makeClient({ getGrantedPermissions: grantOnly('Steps', 'HeartRate', 'Weight') }),
    readRecordsPaged: realClient.readRecordsPaged,
  };

  beforeEach(() => {
    mockSignedIn = 'user-a';
    mockNativeRead.mockReset();
  });

  it.each([
    ['the start of sign-out (stopOnDeviceHealthWork)', () => stopOnDeviceHealthWork()],
    ['the logout auth event', () => authEvents.emit('logout')],
    ['an account switch', () => {
      mockSignedIn = 'user-b';
      authEvents.emit('login');
    }],
  ])('%s during Steps page 1: 1 native call, nothing sent or saved', async (_label, stop) => {
    mockNativeRead.mockImplementation(async () => {
      stop();
      return { records: [{ startTime: NOW.toISOString(), endTime: NOW.toISOString(), count: 3 }], pageToken: 'p2' };
    });
    const fence = await beginSessionFence();
    expect(fence).not.toBeNull();
    const ingest = jest.fn().mockResolvedValue({ inserted: 0, skipped: 0 });
    await expect(
      syncHealthConnect(SCOPE, {
        client: client as never,
        ingestApi: { ingest },
        now: () => NOW,
        fence: fence as SessionFence,
      }),
    ).rejects.toBeInstanceOf(OnDeviceSessionChangedError);
    expect(mockNativeRead).toHaveBeenCalledTimes(1);
    expect(ingest).not.toHaveBeenCalled();
    expect(await getSyncProgress(SCOPE)).toEqual({ v: 1, completedThrough: {}, resume: {} });
  });

  it('a cancelled Connect (sheet closed) stops between record types too', async () => {
    const fence = (await beginSessionFence()) as SessionFence;
    mockNativeRead.mockImplementation(async () => {
      fence.cancel();
      return { records: [] };
    });
    const ingest = jest.fn();
    await expect(
      syncHealthConnect(SCOPE, {
        client: client as never,
        ingestApi: { ingest },
        now: () => NOW,
        fence,
      }),
    ).rejects.toMatchObject({ reason: 'cancelled' });
    expect(mockNativeRead).toHaveBeenCalledTimes(1);
    expect(ingest).not.toHaveBeenCalled();
  });

  it('control: with no stop, every page and type is read', async () => {
    mockNativeRead
      .mockResolvedValueOnce({ records: [], pageToken: 'p2' })
      .mockResolvedValue({ records: [] });
    const fence = (await beginSessionFence()) as SessionFence;
    const res = await syncHealthConnect(SCOPE, {
      client: client as never,
      ingestApi: { ingest: jest.fn().mockResolvedValue({ inserted: 0, skipped: 0 }) },
      now: () => NOW,
      fence,
    });
    expect(mockNativeRead).toHaveBeenCalledTimes(4);
    expect(res.complete).toBe(true);
  });
});
