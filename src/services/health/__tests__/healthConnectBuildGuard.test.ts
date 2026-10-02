import Constants from 'expo-constants';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { healthConnectEnabled: false } } },
}));

const mockNativeEvaluation = jest.fn();
jest.mock('react-native-health-connect', () => {
  mockNativeEvaluation();
  throw new Error('Health Connect native module is not linked');
});

const mockPost = jest.fn();
jest.mock('../../api', () => ({
  __esModule: true,
  default: { post: (...args: unknown[]) => mockPost(...args) },
}));

import {
  HEALTH_CONNECT_DISABLED_MESSAGE,
  HealthConnectDisabledError,
  isAndroidHealthConnectEnabled,
  isHealthConnectProviderDisabled,
} from '../../../config/healthConnect';
import { connectOnDeviceProvider } from '../onDeviceConnect';
import * as hc from '../healthConnect/healthConnectClient';
import { syncHealthConnect } from '../healthConnect/healthConnectSyncService';
import * as samsung from '../samsungHealth/samsungHealthClient';
import { sync as syncSamsung } from '../samsungHealth/samsungHealthSyncService';

const originalOS = Platform.OS;
const storageRead = jest.spyOn(AsyncStorage, 'getItem');
function setPlatform(os: string): void {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: os });
}
function setMetadata(value: unknown): void {
  Object.defineProperty(Constants, 'expoConfig', {
    configurable: true,
    value: value,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  setPlatform('android');
  setMetadata({ extra: { healthConnectEnabled: false } });
});
afterEach(() => setPlatform(originalOS));

test.each([
  undefined,
  null,
  {},
  { extra: {} },
  { extra: { healthConnectEnabled: 'true' } },
])('missing or non-boolean build metadata fails closed: %j', (metadata) => {
  setMetadata(metadata);
  expect(isAndroidHealthConnectEnabled()).toBe(false);
  expect(hc.isHealthConnectSupported()).toBe(false);
  expect(isHealthConnectProviderDisabled('HEALTH_CONNECT')).toBe(true);
  expect(isHealthConnectProviderDisabled('SAMSUNG_HEALTH')).toBe(true);
  expect(isHealthConnectProviderDisabled('OURA')).toBe(false);
  expect(isHealthConnectProviderDisabled('APPLE_HEALTHKIT')).toBe(false);
});

test('Android OFF status contains the specific update message without evaluating native code', () => {
  expect(hc.getHealthConnectStatus()).toEqual({
    supported: false,
    platform: 'android',
    reason: 'build-disabled',
    message: HEALTH_CONNECT_DISABLED_MESSAGE,
  });
  expect(mockNativeEvaluation).not.toHaveBeenCalled();
});

test.each(['HEALTH_CONNECT', 'SAMSUNG_HEALTH'] as const)(
  '%s connect returns disabled instead of loading the unlinked module',
  async (provider) => {
    await expect(connectOnDeviceProvider(provider)).resolves.toBe('disabled');
    expect(mockNativeEvaluation).not.toHaveBeenCalled();
  },
);

test('every HC read/permission entry point rejects before the unlinked native module is evaluated', async () => {
  const range = {
    startTime: '2026-10-01T00:00:00Z',
    endTime: '2026-10-01T01:00:00Z',
  };
  for (const call of [
    () => hc.initialize(),
    () => hc.getGrantedPermissions(),
    () => hc.requestPermission(),
    () => hc.readRecords('Steps', range),
    () => hc.readAllSupportedRecords(range),
    () => syncHealthConnect('u1', 'c1'),
  ]) {
    await expect(call()).rejects.toBeInstanceOf(HealthConnectDisabledError);
  }
  expect(mockNativeEvaluation).not.toHaveBeenCalled();
  expect(mockPost).not.toHaveBeenCalled();
});

test('every Samsung bridge/read/sync entry point is also guarded', async () => {
  expect(() => samsung.getBridge()).toThrow(HealthConnectDisabledError);
  for (const call of [
    () => samsung.initialize(),
    () => samsung.getGrantedRecordTypes(),
    () =>
      samsung.readRecords('Steps', {
        timeRangeFilter: { operator: 'between', startTime: 'a', endTime: 'b' },
      }),
    () => syncSamsung(),
  ]) {
    await expect(call()).rejects.toBeInstanceOf(HealthConnectDisabledError);
  }
  expect(mockNativeEvaluation).not.toHaveBeenCalled();
  expect(mockPost).not.toHaveBeenCalled();
  expect(storageRead).not.toHaveBeenCalled();
});

test('ON metadata enables only Android; iOS still connects Apple Health without evaluating HC', async () => {
  setMetadata({ extra: { healthConnectEnabled: true } });
  expect(isAndroidHealthConnectEnabled()).toBe(true);
  expect(hc.isHealthConnectSupported()).toBe(true);
  expect(isHealthConnectProviderDisabled('HEALTH_CONNECT')).toBe(false);
  setPlatform('ios');
  expect(isAndroidHealthConnectEnabled()).toBe(false);
  expect(isHealthConnectProviderDisabled('HEALTH_CONNECT')).toBe(false);
  await expect(connectOnDeviceProvider('APPLE_HEALTHKIT')).resolves.toBe(
    'granted',
  );
  await expect(connectOnDeviceProvider('HEALTH_CONNECT')).resolves.toBe(
    'unsupported',
  );
  expect(mockNativeEvaluation).not.toHaveBeenCalled();
});
