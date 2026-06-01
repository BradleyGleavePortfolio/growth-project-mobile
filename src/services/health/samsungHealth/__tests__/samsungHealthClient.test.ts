/**
 * PR-HK-2.c — `samsungHealthClient` unit tests.
 *
 * Covers the connector's reason to exist:
 *   • the Samsung-origin FILTER drops non-Samsung records and keeps Samsung
 *     ones (both the `{ packageName }` object shape and the bare-string shape
 *     the native wrapper sometimes surfaces);
 *   • the PLATFORM GUARD throws `SamsungHealthUnsupportedError` off Android;
 *   • the permission-denied path throws `SamsungHealthPermissionDeniedError`;
 *   • a missing/failed Health Connect install surfaces as
 *     `SamsungHealthUnavailableError` (graceful-degrade signal);
 *   • `getGrantedRecordTypes` returns only granted, Samsung-eligible types.
 *
 * `react-native-health-connect` is not installed in this environment (it is an
 * Android-native package), so the client resolves it lazily via `require`. We
 * inject a fake through the `__setBridgeForTests` seam rather than mocking the
 * unresolvable module.
 */

import { Platform } from 'react-native';
import {
  __setBridgeForTests,
  getGrantedRecordTypes,
  initialize,
  readRecords,
  SAMSUNG_REQUIRED_RECORD_TYPES,
  type SamsungHealthBridge,
} from '../samsungHealthClient';
import {
  SamsungHealthPermissionDeniedError,
  SamsungHealthUnavailableError,
  SamsungHealthUnsupportedError,
} from '../errors';
import {
  SAMSUNG_HEALTH_PACKAGE_NAME,
  type SamsungHealthRecord,
} from '../types';

const OTHER_PACKAGE = 'com.google.android.apps.fitness';

/** Build a Steps record from a given data origin (object or bare string). */
function stepsRecord(
  origin: string | { packageName: string },
  count: number,
  id = 'rec-1',
): SamsungHealthRecord {
  return {
    recordType: 'Steps',
    metadata: { id, dataOrigin: origin },
    startTime: '2026-05-30T10:00:00.000Z',
    endTime: '2026-05-30T11:00:00.000Z',
    count,
  } as SamsungHealthRecord;
}

/** A bridge whose readRecords returns a fixed set, with read perms granted. */
function makeBridge(
  records: SamsungHealthRecord[],
  grantedTypes: string[] = [...SAMSUNG_REQUIRED_RECORD_TYPES],
): SamsungHealthBridge {
  return {
    initialize: jest.fn(async () => true),
    getGrantedPermissions: jest.fn(async () =>
      grantedTypes.map((recordType) => ({ accessType: 'read', recordType })),
    ),
    readRecords: jest.fn(async () => ({ records })),
  };
}

describe('samsungHealthClient', () => {
  const originalOS = Platform.OS;

  beforeEach(() => {
    Platform.OS = 'android';
    __setBridgeForTests(null);
  });

  afterEach(() => {
    Platform.OS = originalOS;
    __setBridgeForTests(null);
  });

  describe('PLATFORM GUARD', () => {
    it('initialize throws SamsungHealthUnsupportedError off Android (ios)', async () => {
      Platform.OS = 'ios';
      await expect(initialize()).rejects.toBeInstanceOf(
        SamsungHealthUnsupportedError,
      );
    });

    it('readRecords throws SamsungHealthUnsupportedError off Android (web)', async () => {
      Platform.OS = 'web';
      await expect(
        readRecords('Steps', {
          timeRangeFilter: { operator: 'between', startTime: 'a', endTime: 'b' },
        }),
      ).rejects.toBeInstanceOf(SamsungHealthUnsupportedError);
    });

    it('the unsupported error names the offending platform', async () => {
      Platform.OS = 'ios';
      await expect(initialize()).rejects.toThrow(/'ios'/);
    });
  });

  describe('readRecords — Samsung-origin FILTER', () => {
    it('keeps records whose dataOrigin.packageName is Samsung Health', async () => {
      const samsung = stepsRecord({ packageName: SAMSUNG_HEALTH_PACKAGE_NAME }, 1200, 'keep');
      __setBridgeForTests(makeBridge([samsung]));

      const out = await readRecords('Steps', {
        timeRangeFilter: { operator: 'between', startTime: 'a', endTime: 'b' },
      });

      expect(out).toHaveLength(1);
      expect(out[0].metadata.id).toBe('keep');
      expect(out[0].count).toBe(1200);
    });

    it('drops records from a non-Samsung data origin', async () => {
      const google = stepsRecord({ packageName: OTHER_PACKAGE }, 999, 'drop');
      __setBridgeForTests(makeBridge([google]));

      const out = await readRecords('Steps', {
        timeRangeFilter: { operator: 'between', startTime: 'a', endTime: 'b' },
      });

      expect(out).toHaveLength(0);
    });

    it('keeps only the Samsung subset from a mixed batch', async () => {
      const records = [
        stepsRecord({ packageName: SAMSUNG_HEALTH_PACKAGE_NAME }, 100, 's1'),
        stepsRecord({ packageName: OTHER_PACKAGE }, 200, 'g1'),
        stepsRecord({ packageName: SAMSUNG_HEALTH_PACKAGE_NAME }, 300, 's2'),
        stepsRecord({ packageName: 'com.fitbit.FitbitMobile' }, 400, 'f1'),
      ];
      __setBridgeForTests(makeBridge(records));

      const out = await readRecords('Steps', {
        timeRangeFilter: { operator: 'between', startTime: 'a', endTime: 'b' },
      });

      expect(out.map((r) => r.metadata.id)).toEqual(['s1', 's2']);
      expect(out.map((r) => r.count)).toEqual([100, 300]);
    });

    it('tolerates dataOrigin surfaced as a bare package-name string', async () => {
      const records = [
        stepsRecord(SAMSUNG_HEALTH_PACKAGE_NAME, 500, 'bare-samsung'),
        stepsRecord(OTHER_PACKAGE, 600, 'bare-google'),
      ];
      __setBridgeForTests(makeBridge(records));

      const out = await readRecords('Steps', {
        timeRangeFilter: { operator: 'between', startTime: 'a', endTime: 'b' },
      });

      expect(out).toHaveLength(1);
      expect(out[0].metadata.id).toBe('bare-samsung');
    });

    it('stamps the requested recordType on every returned record', async () => {
      const samsung = stepsRecord({ packageName: SAMSUNG_HEALTH_PACKAGE_NAME }, 10, 'x');
      __setBridgeForTests(makeBridge([samsung]));

      const out = await readRecords('Steps', {
        timeRangeFilter: { operator: 'between', startTime: 'a', endTime: 'b' },
      });

      expect(out[0].recordType).toBe('Steps');
    });
  });

  describe('readRecords — permission-denied path', () => {
    it('throws SamsungHealthPermissionDeniedError when the type is not granted', async () => {
      // Granted set does NOT include 'HeartRate'.
      __setBridgeForTests(makeBridge([], ['Steps']));

      await expect(
        readRecords('HeartRate', {
          timeRangeFilter: { operator: 'between', startTime: 'a', endTime: 'b' },
        }),
      ).rejects.toBeInstanceOf(SamsungHealthPermissionDeniedError);
    });

    it('reports the denied record type on the error', async () => {
      __setBridgeForTests(makeBridge([], ['Steps']));

      await expect(
        readRecords('HeartRate', {
          timeRangeFilter: { operator: 'between', startTime: 'a', endTime: 'b' },
        }),
      ).rejects.toMatchObject({ missingRecordTypes: ['HeartRate'] });
    });
  });

  describe('readRecords — graceful degrade on bridge failure', () => {
    it('wraps a thrown bridge read as SamsungHealthUnavailableError', async () => {
      const bridge = makeBridge([]);
      (bridge.readRecords as jest.Mock).mockRejectedValueOnce(
        new Error('Health Connect crashed'),
      );
      __setBridgeForTests(bridge);

      await expect(
        readRecords('Steps', {
          timeRangeFilter: { operator: 'between', startTime: 'a', endTime: 'b' },
        }),
      ).rejects.toBeInstanceOf(SamsungHealthUnavailableError);
    });
  });

  describe('initialize', () => {
    it('returns the bridge when initialize resolves true', async () => {
      const bridge = makeBridge([]);
      __setBridgeForTests(bridge);

      await expect(initialize()).resolves.toBe(bridge);
      expect(bridge.initialize).toHaveBeenCalledTimes(1);
    });

    it('throws SamsungHealthUnavailableError when initialize resolves false', async () => {
      const bridge = makeBridge([]);
      (bridge.initialize as jest.Mock).mockResolvedValueOnce(false);
      __setBridgeForTests(bridge);

      await expect(initialize()).rejects.toBeInstanceOf(
        SamsungHealthUnavailableError,
      );
    });

    it('throws SamsungHealthUnavailableError when initialize throws', async () => {
      const bridge = makeBridge([]);
      (bridge.initialize as jest.Mock).mockRejectedValueOnce(
        new Error('no module'),
      );
      __setBridgeForTests(bridge);

      await expect(initialize()).rejects.toBeInstanceOf(
        SamsungHealthUnavailableError,
      );
    });
  });

  describe('getGrantedRecordTypes', () => {
    it('returns only granted, Samsung-eligible record types', async () => {
      __setBridgeForTests(
        makeBridge([], ['Steps', 'HeartRate', 'SomeUnsupportedType']),
      );

      const granted = await getGrantedRecordTypes();

      expect(granted).toEqual(['Steps', 'HeartRate']);
    });

    it('ignores write-only permissions (accessType !== read)', async () => {
      const bridge: SamsungHealthBridge = {
        initialize: jest.fn(async () => true),
        getGrantedPermissions: jest.fn(async () => [
          { accessType: 'write', recordType: 'Steps' },
          { accessType: 'read', recordType: 'Weight' },
        ]),
        readRecords: jest.fn(async () => ({ records: [] })),
      };
      __setBridgeForTests(bridge);

      const granted = await getGrantedRecordTypes();

      expect(granted).toEqual(['Weight']);
    });

    it('returns an empty array when nothing is granted', async () => {
      __setBridgeForTests(makeBridge([], []));

      await expect(getGrantedRecordTypes()).resolves.toEqual([]);
    });
  });
});
