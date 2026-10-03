/**
 * onDeviceConnect — unit tests for the on-device health-permission connect
 * flow. Drives every documented outcome (granted / denied / unavailable /
 * unsupported) across both platforms by mocking the two native modules.
 *
 * The global jest.setup mocks provide a granted-path default; these tests
 * reset and reconfigure the mocks per case so each branch is asserted in
 * isolation.
 */

import { Linking, Platform } from 'react-native';
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { healthConnectEnabled: true } } },
}));
import AppleHealthKit from 'react-native-health';
import {
  getSdkStatus,
  initialize as hcInitialize,
  openHealthConnectSettings,
  requestPermission as hcRequestPermission,
  SdkAvailabilityStatus,
} from 'react-native-health-connect';
import {
  connectOnDeviceProvider,
  HEALTH_CONNECT_PLAY_STORE_URL,
  HEALTH_CONNECT_PLAY_WEB_URL,
  openHealthConnectPermissions,
  openHealthConnectStore,
} from '../onDeviceConnect';

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

  // S-WEAR-3: HealthKit never reports a refusal, so an initHealthKit error is
  // a failure to open the permission screen, not a denial.
  it('returns "error" when initHealthKit reports an error', async () => {
    setPlatform('ios');
    (mockedHK.initHealthKit as jest.Mock).mockImplementation(
      (_perms, cb: (e: string) => void) => cb('permission error'),
    );

    await expect(connectOnDeviceProvider('APPLE_HEALTHKIT')).resolves.toBe(
      'error',
    );
  });

  it('returns "unsupported" when the device has no Health data store', async () => {
    setPlatform('ios');
    (mockedHK.initHealthKit as jest.Mock).mockImplementation(
      (_perms, cb: (e: string) => void) => cb('HealthKit data is not available'),
    );

    await expect(connectOnDeviceProvider('APPLE_HEALTHKIT')).resolves.toBe(
      'unsupported',
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

  it('returns "unavailable" when Health Connect is not installed, opening nothing on its own', async () => {
    setPlatform('android');
    mockedGetSdkStatus.mockResolvedValue(
      SdkAvailabilityStatus.SDK_UNAVAILABLE,
    );

    await expect(connectOnDeviceProvider('HEALTH_CONNECT')).resolves.toBe(
      'unavailable',
    );
    expect(mockedOpenSettings).not.toHaveBeenCalled();
    expect(mockedRequestPermission).not.toHaveBeenCalled();
  });

  it('returns "update_required" when Health Connect needs an update', async () => {
    setPlatform('android');
    mockedGetSdkStatus.mockResolvedValue(
      SdkAvailabilityStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED,
    );

    await expect(connectOnDeviceProvider('HEALTH_CONNECT')).resolves.toBe(
      'update_required',
    );
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

  it('returns "error" (never throws) when a native call rejects', async () => {
    setPlatform('android');
    mockedGetSdkStatus.mockRejectedValue(new Error('native boom'));

    await expect(connectOnDeviceProvider('HEALTH_CONNECT')).resolves.toBe(
      'error',
    );
  });
});

describe('S-WEAR-3: opening Health Connect settings and the Play Store', () => {
  it('opens Health Connect settings on Android', async () => {
    setPlatform('android');
    await expect(openHealthConnectPermissions()).resolves.toBe(true);
    expect(mockedOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('does nothing on iOS', async () => {
    setPlatform('ios');
    await expect(openHealthConnectPermissions()).resolves.toBe(false);
    expect(mockedOpenSettings).not.toHaveBeenCalled();
  });

  it('opens the Play Store, falling back to the web page', async () => {
    const open = jest.spyOn(Linking, 'openURL');
    open.mockRejectedValueOnce(new Error('no market')).mockResolvedValueOnce(true);
    await expect(openHealthConnectStore()).resolves.toBe(true);
    expect(open).toHaveBeenNthCalledWith(1, HEALTH_CONNECT_PLAY_STORE_URL);
    expect(open).toHaveBeenNthCalledWith(2, HEALTH_CONNECT_PLAY_WEB_URL);
    open.mockRejectedValue(new Error('none'));
    await expect(openHealthConnectStore()).resolves.toBe(false);
    open.mockRestore();
  });
});

describe('connectOnDeviceProvider — non on-device provider', () => {
  it('returns "unsupported" for a cloud-OAuth provider', async () => {
    setPlatform('ios');
    await expect(connectOnDeviceProvider('OURA')).resolves.toBe('unsupported');
  });
});

describe('Sol B-317-9: the attempt check stops setup before any permission screen', () => {
  it('Health Connect: an attempt that ends during the availability check opens nothing', async () => {
    setPlatform('android');
    let live = true;
    mockedGetSdkStatus.mockImplementationOnce(async () => {
      live = false;
      return SdkAvailabilityStatus.SDK_AVAILABLE;
    });
    await expect(connectOnDeviceProvider('HEALTH_CONNECT', () => live)).resolves.toBe('stopped');
    expect(mockedInitialize).not.toHaveBeenCalled();
    expect(mockedRequestPermission).not.toHaveBeenCalled();
  });

  it('Health Connect: an attempt that ends during initialization opens nothing', async () => {
    setPlatform('android');
    let live = true;
    mockedGetSdkStatus.mockResolvedValueOnce(SdkAvailabilityStatus.SDK_AVAILABLE);
    mockedInitialize.mockImplementationOnce(async () => {
      live = false;
      return true;
    });
    await expect(connectOnDeviceProvider('SAMSUNG_HEALTH', () => live)).resolves.toBe('stopped');
    expect(mockedRequestPermission).not.toHaveBeenCalled();
  });

  it('a setup failure after the attempt ended is a stop, not an error', async () => {
    setPlatform('android');
    let live = true;
    mockedGetSdkStatus.mockImplementationOnce(async () => {
      live = false;
      throw new Error('binder died');
    });
    await expect(connectOnDeviceProvider('HEALTH_CONNECT', () => live)).resolves.toBe('stopped');
  });

  it('Apple Health: an attempt that already ended opens no HealthKit sheet', async () => {
    setPlatform('ios');
    await expect(connectOnDeviceProvider('APPLE_HEALTHKIT', () => false)).resolves.toBe('stopped');
    expect(mockedHK.initHealthKit).not.toHaveBeenCalled();
  });

  it('control: a live attempt still reaches the permission screen', async () => {
    setPlatform('android');
    mockedGetSdkStatus.mockResolvedValueOnce(SdkAvailabilityStatus.SDK_AVAILABLE);
    mockedInitialize.mockResolvedValueOnce(true);
    mockedRequestPermission.mockResolvedValueOnce([{ accessType: 'read', recordType: 'Steps' }]);
    await expect(connectOnDeviceProvider('HEALTH_CONNECT', () => true)).resolves.toBe('granted');
    expect(mockedRequestPermission).toHaveBeenCalledTimes(1);
  });
});
