/**
 * PR-HK-2.c — `samsungHealthSyncService` unit tests.
 *
 * Covers the orchestration contract:
 *   • PLATFORM GUARD — `sync` throws `SamsungHealthUnsupportedError` off Android;
 *   • graceful degrade — a `SamsungHealthUnavailableError` from init returns a
 *     no-op result (does NOT throw, does NOT advance lastSyncAt);
 *   • permission-denied path — zero granted types throws
 *     `SamsungHealthPermissionDeniedError` and does NOT advance lastSyncAt;
 *   • lastSyncAt persistence — persisted under
 *     `wearable:samsung-health:lastSyncAt` ONLY after a successful ingest;
 *   • a failed ingest does NOT advance lastSyncAt (re-reads same window);
 *   • the ingest POSTs a single batch to `/v1/wearables/samples/ingest` with
 *     `provider: SAMSUNG_HEALTH`;
 *   • first-run backfill uses a 30-day window.
 *
 * `react-native-health-connect` is mocked at the client seam (we mock the
 * whole client module), and the axios-backed `api` default export is mocked so
 * no network is touched.
 */

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const mockApiPost = jest.fn();
jest.mock('../../../api', () => ({
  __esModule: true,
  default: { post: (...args: unknown[]) => mockApiPost(...args) },
}));

const mockInitialize = jest.fn();
const mockGetGrantedRecordTypes = jest.fn();
const mockReadRecords = jest.fn();
jest.mock('../samsungHealthClient', () => ({
  __esModule: true,
  samsungHealthClient: {
    initialize: (...a: unknown[]) => mockInitialize(...a),
    getGrantedRecordTypes: (...a: unknown[]) => mockGetGrantedRecordTypes(...a),
    readRecords: (...a: unknown[]) => mockReadRecords(...a),
  },
}));

import {
  sync,
  getLastSyncAt,
  setLastSyncAt,
  clearLastSyncAt,
  SAMSUNG_LAST_SYNC_KEY,
  SAMSUNG_INGEST_PATH,
  DEFAULT_BACKFILL_DAYS,
} from '../samsungHealthSyncService';
import {
  SamsungHealthPermissionDeniedError,
  SamsungHealthUnavailableError,
  SamsungHealthUnsupportedError,
} from '../errors';
import {
  SAMSUNG_HEALTH_PACKAGE_NAME,
  type SamsungHealthRecord,
} from '../types';

const SAMSUNG_META = {
  id: 'm1',
  dataOrigin: { packageName: SAMSUNG_HEALTH_PACKAGE_NAME },
};

function stepsRecord(count: number): SamsungHealthRecord {
  return {
    recordType: 'Steps',
    metadata: SAMSUNG_META,
    startTime: '2026-05-30T10:00:00.000Z',
    endTime: '2026-05-30T11:00:00.000Z',
    count,
  } as SamsungHealthRecord;
}

const FIXED_NOW = new Date('2026-05-31T00:00:00.000Z');
const now = () => FIXED_NOW;

describe('samsungHealthSyncService', () => {
  const originalOS = Platform.OS;

  beforeEach(async () => {
    Platform.OS = 'android';
    await AsyncStorage.clear();
    mockApiPost.mockReset().mockResolvedValue({ data: { accepted: 0 } });
    mockInitialize.mockReset().mockResolvedValue(undefined);
    mockGetGrantedRecordTypes.mockReset().mockResolvedValue(['Steps']);
    mockReadRecords.mockReset().mockResolvedValue([]);
  });

  afterEach(() => {
    Platform.OS = originalOS;
  });

  describe('lastSyncAt persistence helpers', () => {
    it('round-trips a valid ISO timestamp through AsyncStorage', async () => {
      await setLastSyncAt('2026-05-30T12:00:00.000Z');
      await expect(getLastSyncAt()).resolves.toBe('2026-05-30T12:00:00.000Z');
      await expect(
        AsyncStorage.getItem(SAMSUNG_LAST_SYNC_KEY),
      ).resolves.toBe('2026-05-30T12:00:00.000Z');
    });

    it('returns null when nothing is persisted', async () => {
      await expect(getLastSyncAt()).resolves.toBeNull();
    });

    it('returns null for an unparseable stored value', async () => {
      await AsyncStorage.setItem(SAMSUNG_LAST_SYNC_KEY, 'not-a-date');
      await expect(getLastSyncAt()).resolves.toBeNull();
    });

    it('clearLastSyncAt removes the key', async () => {
      await setLastSyncAt('2026-05-30T12:00:00.000Z');
      await clearLastSyncAt();
      await expect(
        AsyncStorage.getItem(SAMSUNG_LAST_SYNC_KEY),
      ).resolves.toBeNull();
    });

    it('uses the contract storage key', () => {
      expect(SAMSUNG_LAST_SYNC_KEY).toBe('wearable:samsung-health:lastSyncAt');
    });
  });

  describe('PLATFORM GUARD', () => {
    it('throws SamsungHealthUnsupportedError off Android', async () => {
      Platform.OS = 'ios';
      await expect(sync(now)).rejects.toBeInstanceOf(
        SamsungHealthUnsupportedError,
      );
    });

    it('does not persist lastSyncAt when off Android', async () => {
      Platform.OS = 'ios';
      await expect(sync(now)).rejects.toBeInstanceOf(SamsungHealthUnsupportedError);
      await expect(
        AsyncStorage.getItem(SAMSUNG_LAST_SYNC_KEY),
      ).resolves.toBeNull();
    });
  });

  describe('graceful degrade — Health Connect unavailable', () => {
    it('returns a no-op result instead of throwing', async () => {
      mockInitialize.mockRejectedValueOnce(
        new SamsungHealthUnavailableError('not installed'),
      );

      const result = await sync(now);

      expect(result.ingested).toBe(false);
      expect(result.sampleCount).toBe(0);
      expect(result.recordTypesRead).toEqual([]);
      expect(result.lastSyncAt).toBeNull();
      expect(mockApiPost).not.toHaveBeenCalled();
    });

    it('does not advance lastSyncAt when unavailable', async () => {
      mockInitialize.mockRejectedValueOnce(new SamsungHealthUnavailableError());
      await sync(now);
      await expect(
        AsyncStorage.getItem(SAMSUNG_LAST_SYNC_KEY),
      ).resolves.toBeNull();
    });

    it('rethrows non-unavailable init errors', async () => {
      mockInitialize.mockRejectedValueOnce(new Error('unexpected'));
      await expect(sync(now)).rejects.toThrow('unexpected');
    });
  });

  describe('permission-denied path', () => {
    it('throws SamsungHealthPermissionDeniedError when no types are granted', async () => {
      mockGetGrantedRecordTypes.mockResolvedValueOnce([]);
      await expect(sync(now)).rejects.toBeInstanceOf(
        SamsungHealthPermissionDeniedError,
      );
    });

    it('does not advance lastSyncAt on permission denial', async () => {
      mockGetGrantedRecordTypes.mockResolvedValueOnce([]);
      await expect(sync(now)).rejects.toBeInstanceOf(
        SamsungHealthPermissionDeniedError,
      );
      await expect(
        AsyncStorage.getItem(SAMSUNG_LAST_SYNC_KEY),
      ).resolves.toBeNull();
    });
  });

  describe('successful sync', () => {
    it('reads, normalizes, POSTs a single batch, and persists lastSyncAt', async () => {
      mockReadRecords.mockResolvedValueOnce([stepsRecord(1000), stepsRecord(2000)]);

      const result = await sync(now);

      // One batched POST, never one-per-sample.
      expect(mockApiPost).toHaveBeenCalledTimes(1);
      const [path, body] = mockApiPost.mock.calls[0];
      expect(path).toBe(SAMSUNG_INGEST_PATH);
      expect(path).toBe('/v1/wearables/samples/ingest');
      expect(body.provider).toBe('SAMSUNG_HEALTH');
      expect(body.samples).toHaveLength(2);
      expect(body.samples[0]).toMatchObject({
        provider: 'SAMSUNG_HEALTH',
        metric: 'STEPS',
        value: 1000,
      });

      expect(result.ingested).toBe(true);
      expect(result.sampleCount).toBe(2);
      expect(result.lastSyncAt).toBe(FIXED_NOW.toISOString());

      await expect(
        AsyncStorage.getItem(SAMSUNG_LAST_SYNC_KEY),
      ).resolves.toBe(FIXED_NOW.toISOString());
    });

    it('first-run window is a 30-day backfill', async () => {
      await sync(now);

      // No POST (empty read) but the window is still computed; assert via the
      // readRecords time filter.
      const [, options] = mockReadRecords.mock.calls[0];
      const expectedStart = new Date(
        FIXED_NOW.getTime() - DEFAULT_BACKFILL_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString();
      expect(options.timeRangeFilter.startTime).toBe(expectedStart);
      expect(options.timeRangeFilter.endTime).toBe(FIXED_NOW.toISOString());
    });

    it('subsequent run reads from the persisted lastSyncAt', async () => {
      await AsyncStorage.setItem(
        SAMSUNG_LAST_SYNC_KEY,
        '2026-05-30T18:00:00.000Z',
      );

      await sync(now);

      const [, options] = mockReadRecords.mock.calls[0];
      expect(options.timeRangeFilter.startTime).toBe('2026-05-30T18:00:00.000Z');
    });

    it('persists lastSyncAt even when the read is empty (clean no-op)', async () => {
      mockReadRecords.mockResolvedValue([]);

      const result = await sync(now);

      expect(mockApiPost).not.toHaveBeenCalled();
      expect(result.ingested).toBe(false);
      await expect(
        AsyncStorage.getItem(SAMSUNG_LAST_SYNC_KEY),
      ).resolves.toBe(FIXED_NOW.toISOString());
    });

    it('reads every granted record type', async () => {
      mockGetGrantedRecordTypes.mockResolvedValueOnce(['Steps', 'HeartRate', 'Weight']);

      await sync(now);

      expect(mockReadRecords).toHaveBeenCalledTimes(3);
      expect(mockReadRecords.mock.calls.map((c) => c[0])).toEqual([
        'Steps',
        'HeartRate',
        'Weight',
      ]);
    });
  });

  describe('failed ingest does not advance lastSyncAt', () => {
    it('rethrows the POST error and leaves lastSyncAt unset', async () => {
      mockReadRecords.mockResolvedValueOnce([stepsRecord(1000)]);
      mockApiPost.mockRejectedValueOnce(new Error('500 ingest failed'));

      await expect(sync(now)).rejects.toThrow('500 ingest failed');

      await expect(
        AsyncStorage.getItem(SAMSUNG_LAST_SYNC_KEY),
      ).resolves.toBeNull();
    });

    it('keeps a prior lastSyncAt unchanged on a failed ingest', async () => {
      await AsyncStorage.setItem(
        SAMSUNG_LAST_SYNC_KEY,
        '2026-05-30T18:00:00.000Z',
      );
      mockReadRecords.mockResolvedValueOnce([stepsRecord(1000)]);
      mockApiPost.mockRejectedValueOnce(new Error('boom'));

      await expect(sync(now)).rejects.toThrow('boom');

      await expect(
        AsyncStorage.getItem(SAMSUNG_LAST_SYNC_KEY),
      ).resolves.toBe('2026-05-30T18:00:00.000Z');
    });
  });
});
