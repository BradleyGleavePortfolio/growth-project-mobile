/**
 * PR-HK-2.a — healthKitClient tests.
 *
 * Mocks the `react-native-health` native module entirely so the client's
 * promisification, platform guard, and read fan-out can be asserted without a
 * device. Platform.OS is toggled per-block to exercise the iOS / non-iOS
 * branches.
 */

import { Platform } from 'react-native';

// ── Native module mock ──
// The connector does `import AppleHealthKit from 'react-native-health'`; the
// real package is CommonJS (`module.exports = HealthKit`). We build the mock
// native module INSIDE the factory (jest hoists `jest.mock` above this file's
// top-level `const`s, so a closed-over variable would be in the temporal dead
// zone when the factory runs). Each reader is a jest.fn with the callback-style
// `(error, results)` signature. Exposed as both the module object and its
// `default` to satisfy whichever interop jest-expo applies.
jest.mock('react-native-health', () => {
  const native = {
    initHealthKit: jest.fn(),
    getStepCount: jest.fn(),
    getActiveEnergyBurned: jest.fn(),
    getRestingHeartRateSamples: jest.fn(),
    getHeartRateSamples: jest.fn(),
    getVo2MaxSamples: jest.fn(),
    getAnchoredWorkouts: jest.fn(),
    getWeightSamples: jest.fn(),
    getBodyFatPercentageSamples: jest.fn(),
    getBloodPressureSamples: jest.fn(),
    getSleepSamples: jest.fn(),
    getHeartRateVariabilitySamples: jest.fn(),
    getOxygenSaturationSamples: jest.fn(),
    getRespiratoryRateSamples: jest.fn(),
    getBodyTemperatureSamples: jest.fn(),
  };
  return Object.assign(native, { __esModule: true, default: native });
});

import {
  HealthKitClient,
  HealthKitUnsupportedError,
  HEALTHKIT_READ_PERMISSIONS,
  healthKitClient,
} from '../healthKitClient';

// Grab the live mock instance the connector imported (same object reference).
type MockNative = Record<string, jest.Mock>;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockNative = jest.requireMock('react-native-health') as unknown as MockNative;

/** Set Platform.OS for a test block. */
function setPlatform(os: string): void {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
}

/** Make a reader resolve with `results`. */
function resolveWith(fn: jest.Mock, results: unknown): void {
  fn.mockImplementation((_o: unknown, cb: (e: string | null, r: unknown) => void) =>
    cb(null, results),
  );
}

/** Make a reader fail with `error`. */
function rejectWith(fn: jest.Mock, error: string): void {
  fn.mockImplementation((_o: unknown, cb: (e: string | null, r: unknown) => void) =>
    cb(error, undefined),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  // Default: all readers resolve with empty arrays.
  resolveWith(mockNative.getStepCount, { value: 0, startDate: '', endDate: '' });
  resolveWith(mockNative.getActiveEnergyBurned, []);
  resolveWith(mockNative.getRestingHeartRateSamples, []);
  resolveWith(mockNative.getHeartRateSamples, []);
  resolveWith(mockNative.getVo2MaxSamples, []);
  resolveWith(mockNative.getAnchoredWorkouts, { anchor: '', data: [] });
  resolveWith(mockNative.getWeightSamples, []);
  resolveWith(mockNative.getBodyFatPercentageSamples, []);
  resolveWith(mockNative.getBloodPressureSamples, []);
  resolveWith(mockNative.getSleepSamples, []);
  resolveWith(mockNative.getHeartRateVariabilitySamples, []);
  resolveWith(mockNative.getOxygenSaturationSamples, []);
  resolveWith(mockNative.getRespiratoryRateSamples, []);
  resolveWith(mockNative.getBodyTemperatureSamples, []);
  mockNative.initHealthKit.mockImplementation(
    (_p: unknown, cb: (e: string | null, r: unknown) => void) => cb(null, true),
  );
});

afterAll(() => {
  setPlatform('ios');
});

describe('HealthKitClient platform guard', () => {
  it('isSupported is true on iOS', () => {
    setPlatform('ios');
    expect(new HealthKitClient().isSupported).toBe(true);
  });

  it('isSupported is false on android', () => {
    setPlatform('android');
    expect(new HealthKitClient().isSupported).toBe(false);
  });

  it('requestAuth resolves on iOS', async () => {
    setPlatform('ios');
    await expect(new HealthKitClient().requestAuth()).resolves.toBeUndefined();
    expect(mockNative.initHealthKit).toHaveBeenCalledTimes(1);
  });

  it('requestAuth throws HealthKitUnsupportedError on android', async () => {
    setPlatform('android');
    await expect(new HealthKitClient().requestAuth()).rejects.toBeInstanceOf(
      HealthKitUnsupportedError,
    );
    expect(mockNative.initHealthKit).not.toHaveBeenCalled();
  });

  it('readSamples throws HealthKitUnsupportedError on android', async () => {
    setPlatform('android');
    await expect(
      new HealthKitClient().readSamples({ since: new Date(0), until: new Date() }),
    ).rejects.toBeInstanceOf(HealthKitUnsupportedError);
  });

  it('readSamples throws on web too', async () => {
    setPlatform('web');
    await expect(
      new HealthKitClient().readSamples({ since: new Date(0), until: new Date() }),
    ).rejects.toBeInstanceOf(HealthKitUnsupportedError);
  });
});

describe('HealthKitClient.requestAuth', () => {
  beforeEach(() => setPlatform('ios'));

  it('passes the default permission set as read perms with empty write', async () => {
    await new HealthKitClient().requestAuth();
    const [perms] = mockNative.initHealthKit.mock.calls[0];
    expect(perms).toEqual({
      permissions: { read: HEALTHKIT_READ_PERMISSIONS, write: [] },
    });
  });

  it('passes a caller-supplied subset', async () => {
    await new HealthKitClient().requestAuth(['StepCount', 'HeartRate']);
    const [perms] = mockNative.initHealthKit.mock.calls[0];
    expect(perms.permissions.read).toEqual(['StepCount', 'HeartRate']);
  });

  it('rejects when the native init callback returns an error', async () => {
    rejectWith(mockNative.initHealthKit, 'auth denied');
    await expect(new HealthKitClient().requestAuth()).rejects.toThrow('auth denied');
  });
});

describe('HealthKitClient.readSamples', () => {
  const window = { since: new Date('2026-05-01T00:00:00Z'), until: new Date('2026-05-31T00:00:00Z') };

  beforeEach(() => setPlatform('ios'));

  it('wraps the single getStepCount value into an array', async () => {
    resolveWith(mockNative.getStepCount, {
      value: 1234,
      startDate: '2026-05-30T00:00:00Z',
      endDate: '2026-05-31T00:00:00Z',
    });
    const res = await new HealthKitClient().readSamples(window);
    expect(res.steps).toHaveLength(1);
    expect(res.steps?.[0].value).toBe(1234);
  });

  it('maps anchored workouts to the workouts field (data array)', async () => {
    resolveWith(mockNative.getAnchoredWorkouts, {
      anchor: 'a',
      data: [
        {
          id: 'w1',
          activityName: 'Running',
          calories: 300,
          distance: 5000,
          duration: 1800,
          start: '2026-05-30T06:00:00Z',
          end: '2026-05-30T06:30:00Z',
        },
      ],
    });
    const res = await new HealthKitClient().readSamples(window);
    expect(res.workouts).toHaveLength(1);
    expect(res.workouts?.[0].id).toBe('w1');
  });

  it('forwards an ISO start/end window to each reader', async () => {
    await new HealthKitClient().readSamples(window);
    const [opts] = mockNative.getHeartRateSamples.mock.calls[0];
    expect(opts.startDate).toBe(window.since.toISOString());
    expect(opts.endDate).toBe(window.until.toISOString());
  });

  it('tolerates a single metric reader failing (omits that field, keeps others)', async () => {
    rejectWith(mockNative.getHeartRateSamples, 'no permission');
    resolveWith(mockNative.getRestingHeartRateSamples, [
      { value: 55, startDate: '2026-05-30T00:00:00Z', endDate: '2026-05-30T00:00:00Z' },
    ]);
    const res = await new HealthKitClient().readSamples(window);
    expect(res.heartRate).toBeUndefined();
    expect(res.restingHeartRate).toHaveLength(1);
  });

  it('runs all 14 readers in one pass', async () => {
    await new HealthKitClient().readSamples(window);
    expect(mockNative.getStepCount).toHaveBeenCalledTimes(1);
    expect(mockNative.getActiveEnergyBurned).toHaveBeenCalledTimes(1);
    expect(mockNative.getRestingHeartRateSamples).toHaveBeenCalledTimes(1);
    expect(mockNative.getHeartRateSamples).toHaveBeenCalledTimes(1);
    expect(mockNative.getVo2MaxSamples).toHaveBeenCalledTimes(1);
    expect(mockNative.getAnchoredWorkouts).toHaveBeenCalledTimes(1);
    expect(mockNative.getWeightSamples).toHaveBeenCalledTimes(1);
    expect(mockNative.getBodyFatPercentageSamples).toHaveBeenCalledTimes(1);
    expect(mockNative.getBloodPressureSamples).toHaveBeenCalledTimes(1);
    expect(mockNative.getSleepSamples).toHaveBeenCalledTimes(1);
    expect(mockNative.getHeartRateVariabilitySamples).toHaveBeenCalledTimes(1);
    expect(mockNative.getOxygenSaturationSamples).toHaveBeenCalledTimes(1);
    expect(mockNative.getRespiratoryRateSamples).toHaveBeenCalledTimes(1);
    expect(mockNative.getBodyTemperatureSamples).toHaveBeenCalledTimes(1);
  });
});

describe('healthKitClient singleton', () => {
  it('is a HealthKitClient instance', () => {
    expect(healthKitClient).toBeInstanceOf(HealthKitClient);
  });
});
