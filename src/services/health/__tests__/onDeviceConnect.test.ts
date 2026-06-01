/**
 * onDeviceConnect — unit tests for the on-device health-permission connect
 * flow. Drives every documented outcome (granted / denied / unavailable /
 * unsupported) across both platforms by mocking the two native modules.
 *
 * The global jest.setup mocks provide a granted-path default; these tests
 * reset and reconfigure the mocks per case so each branch is asserted in
 * isolation.
 */

import { Platform } from 'react-native';
import AppleHealthKit from 'react-native-health';
import {
  getSdkStatus,
  initialize as hcInitialize,
  openHealthConnectSettings,
  requestPermission as hcRequestPermission,
  SdkAvailabilityStatus,
} from 'react-native-health-connect';
import { connectOnDeviceProvider } from '../onDeviceConnect';

const mockedHK = AppleHealthKit as jest.Mocked<typeof AppleHealthKit>;
const mockedGetSdkStatus = getSdkStatus as jest.Mock;
const mockedInitialize = hcInitialize as jest.Mock;
const mockedOpenSettings = openHealthConnectSettings as jest.Mock;
const mockedRequestPermission = hcRequestPermission as jest.Mock;

function setPlatform(os: 'ios' | 'android') {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: os });
}

const originalOS = Platform.OS;

afterEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(Platform, 'OS', {
    configurable: true,
    value: originalOS,
  });
});

describe('connectOnDeviceProvider — Apple HealthKit (iOS)', () => {
  it('returns "granted" when initHealthKit succeeds', async () => {
    setPlatform('ios');
    (mockedHK.initHealthKit as jest.Mock).mockImplementation(
      (_perms, cb: (e: string) => void) => cb(''),
    );

    await expect(connectOnDeviceProvider('APPLE_HEALTHKIT')).resolves.toBe(
      'granted',
    );
    expect(mockedHK.initHealthKit).toHaveBeenCalledTimes(1);
  });

  it('returns "denied" when initHealthKit reports an error', async () => {
    setPlatform('ios');
    (mockedHK.initHealthKit as jest.Mock).mockImplementation(
      (_perms, cb: (e: string) => void) => cb('permission error'),
    );

    await expect(connectOnDeviceProvider('APPLE_HEALTHKIT')).resolves.toBe(
      'denied',
    );
  });

  it('returns "unsupported" for Apple Health on Android', async () => {
    setPlatform('android');

    await expect(connectOnDeviceProvider('APPLE_HEALTHKIT')).resolves.toBe(
      'unsupported',
    );
    expect(mockedHK.initHealthKit).not.toHaveBeenCalled();
  });
});

describe('connectOnDeviceProvider — Health Connect / Samsung (Android)', () => {
  it('returns "granted" when permissions are granted', async () => {
    setPlatform('android');
    mockedGetSdkStatus.mockResolvedValue(SdkAvailabilityStatus.SDK_AVAILABLE);
    mockedInitialize.mockResolvedValue(true);
    mockedRequestPermission.mockResolvedValue([
      { accessType: 'read', recordType: 'Steps' },
    ]);

    await expect(connectOnDeviceProvider('HEALTH_CONNECT')).resolves.toBe(
      'granted',
    );
    expect(mockedInitialize).toHaveBeenCalledTimes(1);
    expect(mockedRequestPermission).toHaveBeenCalledTimes(1);
  });

  it('returns "denied" when no permission is granted', async () => {
    setPlatform('android');
    mockedGetSdkStatus.mockResolvedValue(SdkAvailabilityStatus.SDK_AVAILABLE);
    mockedInitialize.mockResolvedValue(true);
    mockedRequestPermission.mockResolvedValue([]);

    await expect(connectOnDeviceProvider('HEALTH_CONNECT')).resolves.toBe(
      'denied',
    );
  });

  it('returns "unavailable" and opens settings when the SDK is not available', async () => {
    setPlatform('android');
    mockedGetSdkStatus.mockResolvedValue(
      SdkAvailabilityStatus.SDK_UNAVAILABLE,
    );

    await expect(connectOnDeviceProvider('HEALTH_CONNECT')).resolves.toBe(
      'unavailable',
    );
    expect(mockedOpenSettings).toHaveBeenCalledTimes(1);
    expect(mockedRequestPermission).not.toHaveBeenCalled();
  });

  it('routes Samsung Health through the Health Connect branch', async () => {
    setPlatform('android');
    mockedGetSdkStatus.mockResolvedValue(SdkAvailabilityStatus.SDK_AVAILABLE);
    mockedInitialize.mockResolvedValue(true);
    mockedRequestPermission.mockResolvedValue([
      { accessType: 'read', recordType: 'HeartRate' },
    ]);

    await expect(connectOnDeviceProvider('SAMSUNG_HEALTH')).resolves.toBe(
      'granted',
    );
  });

  it('returns "unsupported" for Health Connect on iOS', async () => {
    setPlatform('ios');

    await expect(connectOnDeviceProvider('HEALTH_CONNECT')).resolves.toBe(
      'unsupported',
    );
    expect(mockedGetSdkStatus).not.toHaveBeenCalled();
  });

  it('returns "denied" (never throws) when a native call rejects', async () => {
    setPlatform('android');
    mockedGetSdkStatus.mockRejectedValue(new Error('native boom'));

    await expect(connectOnDeviceProvider('HEALTH_CONNECT')).resolves.toBe(
      'denied',
    );
  });
});

describe('connectOnDeviceProvider — non on-device provider', () => {
  it('returns "unsupported" for a cloud-OAuth provider', async () => {
    setPlatform('ios');
    await expect(connectOnDeviceProvider('OURA')).resolves.toBe('unsupported');
  });
});
