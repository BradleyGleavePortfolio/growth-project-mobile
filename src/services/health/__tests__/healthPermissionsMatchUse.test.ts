/**
 * M5 (STORE-06) — the app asks only for the health data it reads.
 *
 * Apple Health: the read set requested on the consent sheet equals the set of
 * types the client actually reads, with no write types and no medical
 * records. Health Connect's manifest == read set is pinned in
 * healthPlatformConfig.test.ts.
 *
 * Motion & Fitness: steps come from Apple Health, and no code or dependency
 * reads Core Motion activity or pedometer data, so the app declares no motion
 * purpose string (the iOS twin of the blocked ACTIVITY_RECOGNITION).
 */

import * as fs from 'fs';
import * as path from 'path';
import { Platform } from 'react-native';

jest.mock('react-native-health', () => {
  const native: Record<string, jest.Mock> = {};
  for (const name of [
    'initHealthKit',
    'getDailyStepCountSamples',
    'getActiveEnergyBurned',
    'getRestingHeartRateSamples',
    'getHeartRateSamples',
    'getVo2MaxSamples',
    'getAnchoredWorkouts',
    'getWeightSamples',
    'getBodyFatPercentageSamples',
    'getBloodPressureSamples',
    'getSleepSamples',
    'getHeartRateVariabilitySamples',
    'getOxygenSaturationSamples',
    'getRespiratoryRateSamples',
    'getBodyTemperatureSamples',
  ]) {
    native[name] = jest.fn();
  }
  return Object.assign(native, { __esModule: true, default: native });
});

import { HEALTHKIT_READ_PERMISSIONS, healthKitClient } from '../healthkit/healthKitClient';

const mockNative = jest.requireMock('react-native-health') as Record<string, jest.Mock>;
const ROOT = path.join(__dirname, '..', '..', '..', '..');
const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8')).expo;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const configure = require('../../../../app.config') as () => typeof app;

/** The HealthKit read permission(s) each native reader needs. */
const READER_PERMISSIONS: Record<string, string[]> = {
  getDailyStepCountSamples: ['StepCount'],
  getActiveEnergyBurned: ['ActiveEnergyBurned'],
  getRestingHeartRateSamples: ['RestingHeartRate'],
  getHeartRateSamples: ['HeartRate'],
  getVo2MaxSamples: ['Vo2Max'],
  getAnchoredWorkouts: ['Workout'],
  getWeightSamples: ['Weight'],
  getBodyFatPercentageSamples: ['BodyFatPercentage'],
  getBloodPressureSamples: ['BloodPressureSystolic', 'BloodPressureDiastolic'],
  getSleepSamples: ['SleepAnalysis'],
  getHeartRateVariabilitySamples: ['HeartRateVariability'],
  getOxygenSaturationSamples: ['OxygenSaturation'],
  getRespiratoryRateSamples: ['RespiratoryRate'],
  getBodyTemperatureSamples: ['BodyTemperature'],
};

beforeAll(() => {
  Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
  for (const [name, fn] of Object.entries(mockNative)) {
    if (typeof fn !== 'function') continue;
    fn.mockImplementation((_o: unknown, cb: (error: string | null, results: unknown) => void) =>
      cb(null, name === 'getAnchoredWorkouts' ? { anchor: '', data: [] } : []),
    );
  }
});

describe('Apple Health: requested types == read types', () => {
  it('requests exactly the types a sync reads, read-only', async () => {
    await healthKitClient.requestAuth();
    await healthKitClient.readSamples({ since: new Date(0), until: new Date(3_600_000) });

    const requested = mockNative.initHealthKit.mock.calls[0][0].permissions;
    expect(requested.write).toEqual([]);

    const read = Object.keys(READER_PERMISSIONS)
      .filter((reader) => mockNative[reader].mock.calls.length > 0)
      .flatMap((reader) => READER_PERMISSIONS[reader]);
    expect([...requested.read].sort()).toEqual([...new Set(read)].sort());
    expect([...HEALTHKIT_READ_PERMISSIONS].sort()).toEqual([...new Set(read)].sort());
  });

  it('asks for no medical health records', () => {
    const entry = app.plugins.find(
      (p: unknown) => Array.isArray(p) && p[0] === 'react-native-health',
    );
    expect(entry[1].isClinicalDataEnabled).toBeFalsy();
    expect(app.ios.infoPlist.NSHealthClinicalHealthRecordsShareUsageDescription).toBeUndefined();
  });
});

describe('Motion & Fitness: not declared, nothing reads it', () => {
  it('no Core Motion activity module is a dependency', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    expect(Object.keys(pkg.dependencies)).not.toContain('expo-sensors');
  });

  test.each([undefined, '1'])(
    'no NSMotionUsageDescription (TGP_ANDROID_HEALTH_CONNECT=%s)',
    (value) => {
      const original = process.env.TGP_ANDROID_HEALTH_CONNECT;
      if (value === undefined) delete process.env.TGP_ANDROID_HEALTH_CONNECT;
      else process.env.TGP_ANDROID_HEALTH_CONNECT = value;
      try {
        expect(app.ios.infoPlist).not.toHaveProperty('NSMotionUsageDescription');
        expect(configure().ios.infoPlist).not.toHaveProperty('NSMotionUsageDescription');
      } finally {
        if (original === undefined) delete process.env.TGP_ANDROID_HEALTH_CONNECT;
        else process.env.TGP_ANDROID_HEALTH_CONNECT = original;
      }
    },
  );
});
