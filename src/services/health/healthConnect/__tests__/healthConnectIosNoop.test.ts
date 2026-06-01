// PR-HK-2.b — iOS graceful no-op regression (R2 fix for R1 Finding 1, P1).
//
// Under the project's enabled new architecture (`newArchEnabled=true`,
// `global.__turboModuleProxy != null`), `react-native-health-connect@3.5.3`
// resolves its native module EAGERLY at module-evaluation time:
//
//   const HealthConnectModule = Platform.select({
//     android: isTurboModuleEnabled
//       ? require('./NativeHealthConnect').default   // ← evaluated on ALL platforms
//       : NativeModules.HealthConnect,
//     ios: moduleProxy(PLATFORM_NOT_SUPPORTED_ERROR),
//     default: moduleProxy(PLATFORM_NOT_SUPPORTED_ERROR),
//   });
//
// JavaScript evaluates every value of that object literal before
// `Platform.select` picks one, so `require('./NativeHealthConnect').default`
// — `TurboModuleRegistry.getEnforcing('HealthConnect')` — runs on iOS too and
// THROWS (the native module is absent).
//
// This test models that hazard directly: the `react-native-health-connect`
// mock factory THROWS the instant the module is evaluated (i.e. the instant
// any code `require`s/imports it) — exactly the failure mode the real library
// exhibits on iOS under the new architecture. The connector must therefore
// NEVER touch the library at module scope on iOS.
//
// We force `Platform.OS === 'ios'` and assert:
//   1. importing the connector barrel / client on iOS does NOT throw,
//   2. the connector reports the structured platform-unsupported shape, and
//   3. every public method rejects with HealthConnectUnsupportedError (a real,
//      surfaceable error) — NOT a silent empty result, and NOT the eager
//      native-module throw.
//
// Before the fix (static top-level import), step 1 threw HC_EAGER_THROW at
// module-evaluation time, breaking the required Android-only graceful no-op.

import { Platform } from 'react-native';

const HC_EAGER_THROW =
  'Platform not supported. This package only supports Android.';

// A factory that throws the moment the module is evaluated — exactly what the
// real library does on iOS under the new architecture (eager getEnforcing).
// If the connector ever imports/requires the lib on iOS, these tests fail.
jest.mock('react-native-health-connect', () => {
  throw new Error(HC_EAGER_THROW);
});

// Force iOS via the same Platform-override pattern the rest of the connector
// tests use (no whole-module remock — that eagerly evaluates deprecated RN
// getters and crashes under jest-expo). `jest.isolateModules` resets the
// module registry, so the connector re-`require`s a FRESH `react-native`; we
// must set `OS` on that fresh instance inside each isolate block. `forceIos`
// does exactly that.
function setPlatformOS(p: { OS: string }, os: string): void {
  Object.defineProperty(p, 'OS', { get: () => os, configurable: true });
}

function forceIos(): void {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  setPlatformOS(require('react-native').Platform, 'ios');
}

describe('Health Connect iOS graceful no-op (new architecture)', () => {
  beforeEach(() => {
    setPlatformOS(Platform, 'ios');
  });

  it('importing the connector barrel on iOS does not throw at module-evaluation time', () => {
    jest.isolateModules(() => {
      forceIos();
      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        require('../index');
      }).not.toThrow();
    });
  });

  it('importing the client module directly on iOS does not throw', () => {
    jest.isolateModules(() => {
      forceIos();
      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        require('../healthConnectClient');
      }).not.toThrow();
    });
  });

  it('reports the structured platform-unsupported shape on iOS', () => {
    jest.isolateModules(() => {
      forceIos();
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const client = require('../healthConnectClient');
      expect(client.isHealthConnectSupported()).toBe(false);

      // A real, structured status the calling UI can render — NOT an empty
      // list pretending the user simply has no data.
      const status = client.getHealthConnectStatus();
      expect(status.supported).toBe(false);
      expect(status.platform).toBe('ios');
      expect(status.reason).toBe('platform-unsupported');
      expect(typeof status.message).toBe('string');
      expect(status.message.length).toBeGreaterThan(0);

      // buildReadPermissions never touches the native lib — safe on iOS.
      expect(client.buildReadPermissions()).toHaveLength(
        client.HEALTH_CONNECT_RECORD_TYPES.length,
      );
    });
  });

  it('public methods reject with HealthConnectUnsupportedError on iOS without evaluating the native lib', async () => {
    await jest.isolateModulesAsync(async () => {
      forceIos();
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const client = require('../healthConnectClient');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { HealthConnectUnsupportedError } = require('../errors');

      // Each rejects with the platform guard error (a real, surfaceable error)
      // — NOT the eager HC_EAGER_THROW that would appear if the lib were
      // evaluated, and NOT a swallowed/empty success.
      await expect(client.initialize()).rejects.toBeInstanceOf(
        HealthConnectUnsupportedError,
      );
      await expect(client.getGrantedPermissions()).rejects.toBeInstanceOf(
        HealthConnectUnsupportedError,
      );
      await expect(client.requestPermission()).rejects.toBeInstanceOf(
        HealthConnectUnsupportedError,
      );
      await expect(
        client.readRecords('Steps', { startTime: 'a', endTime: 'b' }),
      ).rejects.toBeInstanceOf(HealthConnectUnsupportedError);
      await expect(
        client.readAllSupportedRecords({ startTime: 'a', endTime: 'b' }),
      ).rejects.toBeInstanceOf(HealthConnectUnsupportedError);
    });
  });
});
