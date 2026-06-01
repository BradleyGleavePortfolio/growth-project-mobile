/**
 * onDeviceConnect — the real on-device health-permission connect flow for the
 * Connections Hub (PR-HK-1-mobile).
 *
 * The three on-device providers (Apple HealthKit, Health Connect, Samsung
 * Health) have no server OAuth round-trip: the user grants access through the
 * platform's native permission UI. This module is the single seam that drives
 * that native permission request from the Connect sheet, so the sheet's
 * on-device CTA performs a real, complete action rather than a placeholder.
 *
 * Design (mirrors PR-HK-2.b's connector-client convention — one module owns the
 * native import so the native surface is mockable in exactly one place):
 *
 *   • iOS  → Apple HealthKit via `react-native-health`. `initHealthKit` presents
 *            the system permission sheet for our read set; the resolved status
 *            is reported back so the hub can re-read connection state.
 *   • Android → Health Connect via `react-native-health-connect`. We check the
 *            SDK status first; if Health Connect is installed we `initialize`
 *            and `requestPermission` for our read set, otherwise we route the
 *            user to the Health Connect settings/store entry point so the path
 *            is never a dead end.
 *   • Samsung Health rides on Health Connect on Android (Samsung writes into
 *            Health Connect), so it shares the Android branch.
 *
 * Every public result is explicit — `granted`, `denied`, `unavailable`, or
 * `unsupported` — so the UI always renders a polished, actionable state and
 * never fails silently. Native errors are caught and surfaced as a typed
 * failure the sheet turns into a user-visible message with a retry.
 *
 * Platform guard: the native modules are absent off-platform, so each branch
 * short-circuits to an `unsupported` outcome instead of throwing.
 */

import { Platform } from 'react-native';
import AppleHealthKit, {
  type HealthKitPermissions,
  type HealthPermission,
} from 'react-native-health';
import {
  getSdkStatus,
  initialize as hcInitialize,
  openHealthConnectSettings,
  requestPermission as hcRequestPermission,
  SdkAvailabilityStatus,
  type Permission as HealthConnectPermission,
} from 'react-native-health-connect';
import type { WearableProvider } from '../../api/wearablesConnectionsApi';

/**
 * The outcome of an on-device connect attempt. Exhaustive on purpose so the
 * caller renders a deterministic, polished state for every branch:
 *   - granted     — the user authorized the requested read access.
 *   - denied      — the permission UI completed but access was not granted.
 *   - unavailable — the platform health store is not installed / not set up;
 *                   the user has been routed to where they can enable it.
 *   - unsupported — this provider cannot be connected on the current platform
 *                   (e.g. an Android-only source on iOS); render as informative.
 */
export type OnDeviceConnectOutcome =
  | 'granted'
  | 'denied'
  | 'unavailable'
  | 'unsupported';

/** Apple HealthKit read set — the canonical signals the hub ingests. */
const HEALTHKIT_READ_PERMISSIONS: HealthPermission[] = [
  AppleHealthKit.Constants.Permissions.Steps,
  AppleHealthKit.Constants.Permissions.StepCount,
  AppleHealthKit.Constants.Permissions.HeartRate,
  AppleHealthKit.Constants.Permissions.RestingHeartRate,
  AppleHealthKit.Constants.Permissions.HeartRateVariability,
  AppleHealthKit.Constants.Permissions.ActiveEnergyBurned,
  AppleHealthKit.Constants.Permissions.SleepAnalysis,
  AppleHealthKit.Constants.Permissions.Workout,
];

const HEALTHKIT_PERMISSIONS: HealthKitPermissions = {
  permissions: {
    read: HEALTHKIT_READ_PERMISSIONS,
    write: [],
  },
};

/** Health Connect read set — mirrors the Android READ_* permissions in CFG. */
const HEALTH_CONNECT_READ_PERMISSIONS: HealthConnectPermission[] = [
  { accessType: 'read', recordType: 'Steps' },
  { accessType: 'read', recordType: 'HeartRate' },
  { accessType: 'read', recordType: 'RestingHeartRate' },
  { accessType: 'read', recordType: 'HeartRateVariabilityRmssd' },
  { accessType: 'read', recordType: 'ActiveCaloriesBurned' },
  { accessType: 'read', recordType: 'ExerciseSession' },
  { accessType: 'read', recordType: 'SleepSession' },
];

/** True when the provider is read on the device's native health store. */
const ANDROID_HEALTH_CONNECT_PROVIDERS: ReadonlySet<WearableProvider> =
  new Set<WearableProvider>(['HEALTH_CONNECT', 'SAMSUNG_HEALTH']);

/**
 * Run the Apple HealthKit permission request. Resolves once the system sheet
 * is dismissed. HealthKit deliberately does not disclose per-type grant state
 * to the app, so a clean (error-free) return is treated as `granted` — the
 * authoritative connection status is then re-read server-side after ingest.
 */
function connectHealthKit(): Promise<OnDeviceConnectOutcome> {
  return new Promise<OnDeviceConnectOutcome>((resolve) => {
    AppleHealthKit.initHealthKit(HEALTHKIT_PERMISSIONS, (error: string) => {
      if (error) {
        resolve('denied');
        return;
      }
      resolve('granted');
    });
  });
}

/**
 * Run the Android Health Connect permission request. Checks SDK availability
 * first; when Health Connect is not installed/ready we open its settings entry
 * point and report `unavailable` so the user has a concrete next step rather
 * than a silent failure.
 */
async function connectHealthConnect(): Promise<OnDeviceConnectOutcome> {
  const status = await getSdkStatus();
  if (status !== SdkAvailabilityStatus.SDK_AVAILABLE) {
    // Not installed or needs a provider update — route the user there.
    openHealthConnectSettings();
    return 'unavailable';
  }

  await hcInitialize();
  const granted = await hcRequestPermission(HEALTH_CONNECT_READ_PERMISSIONS);
  return granted.length > 0 ? 'granted' : 'denied';
}

/**
 * Request on-device health permissions for a provider, driving the real native
 * permission UI for the current platform. Never throws: native errors and
 * off-platform calls resolve to an explicit, renderable outcome.
 */
export async function connectOnDeviceProvider(
  provider: WearableProvider,
): Promise<OnDeviceConnectOutcome> {
  try {
    if (provider === 'APPLE_HEALTHKIT') {
      return Platform.OS === 'ios' ? await connectHealthKit() : 'unsupported';
    }
    if (ANDROID_HEALTH_CONNECT_PROVIDERS.has(provider)) {
      return Platform.OS === 'android'
        ? await connectHealthConnect()
        : 'unsupported';
    }
    // Not an on-device provider — caller should have routed to OAuth.
    return 'unsupported';
  } catch {
    // Surface as a denied/needs-retry outcome; the sheet renders a polished,
    // user-visible error with a retry. No token/secret material is involved.
    return 'denied';
  }
}
