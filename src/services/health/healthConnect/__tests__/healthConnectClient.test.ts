// PR-HK-2.b — healthConnectClient tests.
//
// Verifies the SDK wrapper: platform guard, initialize, permission read/
// request, readRecords time-range wiring, and the graceful per-type read in
// readAllSupportedRecords. The native library is mocked at the module seam.

import { Platform } from 'react-native';

jest.mock('react-native-health-connect', () => ({
  initialize: jest.fn(),
  getGrantedPermissions: jest.fn(),
  requestPermission: jest.fn(),
  readRecords: jest.fn(),
}));

import * as hc from 'react-native-health-connect';
import {
  HealthConnectUnavailableError,
  HealthConnectUnsupportedError,
} from '../errors';
import {
  HEALTH_CONNECT_RECORD_TYPES,
  buildReadPermissions,
  getGrantedPermissions,
  getHealthConnectStatus,
  initialize,
  isHealthConnectSupported,
  readAllSupportedRecords,
  readRecords,
  requestPermission,
} from '../healthConnectClient';

const mockInit = hc.initialize as jest.Mock;
const mockGranted = hc.getGrantedPermissions as jest.Mock;
const mockRequest = hc.requestPermission as jest.Mock;
const mockRead = hc.readRecords as jest.Mock;

function setPlatform(os: string): void {
  Object.defineProperty(Platform, 'OS', { get: () => os, configurable: true });
}

beforeEach(() => {
  jest.clearAllMocks();
  setPlatform('android');
});

describe('buildReadPermissions', () => {
  it('requests read access for every supported record type', () => {
    const perms = buildReadPermissions();
    expect(perms).toHaveLength(HEALTH_CONNECT_RECORD_TYPES.length);
    expect(perms.every((p) => p.accessType === 'read')).toBe(true);
    expect(perms.map((p) => p.recordType)).toEqual([...HEALTH_CONNECT_RECORD_TYPES]);
  });
});

describe('platform guard', () => {
  it('isHealthConnectSupported is true only on android', () => {
    setPlatform('android');
    expect(isHealthConnectSupported()).toBe(true);
    setPlatform('ios');
    expect(isHealthConnectSupported()).toBe(false);
    setPlatform('web');
    expect(isHealthConnectSupported()).toBe(false);
  });

  it('getHealthConnectStatus reports a supported status on android', () => {
    setPlatform('android');
    const status = getHealthConnectStatus();
    expect(status.supported).toBe(true);
    expect(status.platform).toBe('android');
    expect(status.reason).toBe('supported');
    expect(status.message.length).toBeGreaterThan(0);
  });

  it('getHealthConnectStatus reports a structured platform-unsupported status on ios', () => {
    setPlatform('ios');
    const status = getHealthConnectStatus();
    expect(status.supported).toBe(false);
    expect(status.platform).toBe('ios');
    expect(status.reason).toBe('platform-unsupported');
    // Real, renderable copy — not an empty/silent fallback.
    expect(status.message).toMatch(/Android only/i);
  });

  it('initialize throws HealthConnectUnsupportedError on ios', async () => {
    setPlatform('ios');
    await expect(initialize()).rejects.toBeInstanceOf(HealthConnectUnsupportedError);
    expect(mockInit).not.toHaveBeenCalled();
  });

  it('readRecords throws HealthConnectUnsupportedError on web', async () => {
    setPlatform('web');
    await expect(
      readRecords('Steps', { startTime: 'a', endTime: 'b' }),
    ).rejects.toBeInstanceOf(HealthConnectUnsupportedError);
  });
});

describe('initialize', () => {
  it('returns true when the SDK initializes', async () => {
    mockInit.mockResolvedValue(true);
    await expect(initialize()).resolves.toBe(true);
    expect(mockInit).toHaveBeenCalledTimes(1);
  });

  it('throws HealthConnectUnavailableError when the SDK reports failure', async () => {
    mockInit.mockResolvedValue(false);
    await expect(initialize()).rejects.toBeInstanceOf(HealthConnectUnavailableError);
  });
});

describe('permissions', () => {
  it('getGrantedPermissions returns the granted array', async () => {
    const granted = [{ accessType: 'read', recordType: 'Steps' }];
    mockGranted.mockResolvedValue(granted);
    await expect(getGrantedPermissions()).resolves.toEqual(granted);
  });

  it('getGrantedPermissions coerces a non-array to []', async () => {
    mockGranted.mockResolvedValue(undefined);
    await expect(getGrantedPermissions()).resolves.toEqual([]);
  });

  it('requestPermission forwards the full read-permission set', async () => {
    mockRequest.mockResolvedValue([{ accessType: 'read', recordType: 'Steps' }]);
    const granted = await requestPermission();
    expect(mockRequest).toHaveBeenCalledWith(buildReadPermissions());
    expect(granted).toEqual([{ accessType: 'read', recordType: 'Steps' }]);
  });
});

describe('readRecords', () => {
  it('passes a between time-range filter and returns the records array', async () => {
    const records = [{ count: 100 }];
    mockRead.mockResolvedValue({ records });
    const out = await readRecords('Steps', {
      startTime: '2026-05-01T00:00:00.000Z',
      endTime: '2026-05-02T00:00:00.000Z',
    });
    expect(out).toBe(records);
    expect(mockRead).toHaveBeenCalledWith('Steps', {
      timeRangeFilter: {
        operator: 'between',
        startTime: '2026-05-01T00:00:00.000Z',
        endTime: '2026-05-02T00:00:00.000Z',
      },
    });
  });

  it('coerces a missing records field to []', async () => {
    mockRead.mockResolvedValue({});
    await expect(
      readRecords('Steps', { startTime: 'a', endTime: 'b' }),
    ).resolves.toEqual([]);
  });
});

describe('readAllSupportedRecords', () => {
  it('reads every supported type and isolates a per-type read failure', async () => {
    mockRead.mockImplementation((rt: string) => {
      if (rt === 'HeartRate') return Promise.reject(new Error('boom'));
      return Promise.resolve({ records: [{ type: rt }] });
    });
    const range = { startTime: 'a', endTime: 'b' };
    const byType = await readAllSupportedRecords(range);
    // Every record type is present as a key.
    expect(Object.keys(byType).sort()).toEqual([...HEALTH_CONNECT_RECORD_TYPES].sort());
    // The failing type degrades to [] rather than aborting the whole read.
    expect(byType.HeartRate).toEqual([]);
    expect(byType.Steps).toEqual([{ type: 'Steps' }]);
  });
});
