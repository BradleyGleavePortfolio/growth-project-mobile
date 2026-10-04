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
 *            and `requestPermission` for our read set. If it is missing or
 *            needs an update the outcome says so and the sheet offers the
 *            Play Store (nothing opens without a tap).
 *   • Samsung Health rides on Health Connect on Android (Samsung writes into
 *            Health Connect), so it shares the Android branch.
 *
 * Every public result is explicit (see {@link OnDeviceConnectOutcome}) so the
 * UI always renders a specific, actionable state and never fails silently.
 *
 * Platform guard: the native modules are absent off-platform, so each branch
 * short-circuits to an `unsupported` outcome instead of throwing.
 */

import { Linking, Platform } from 'react-native';
import type { Permission as HealthConnectPermission } from 'react-native-health-connect';
import type { WearableProvider } from '../../api/wearablesConnectionsApi';
import { isHealthConnectProviderDisabled } from '../../config/healthConnect';
import { HEALTHKIT_READ_PERMISSIONS, healthKitClient } from './healthkit/healthKitClient';
import { buildReadPermissions } from './healthConnect/healthConnectClient';

/**
 * The outcome of an on-device connect attempt. Exhaustive on purpose so the
 * caller renders a deterministic, specific state for every branch
 * (S-WEAR-3: one cause, one message, one working action):
 *   - granted         — the user authorized the requested read access.
 *   - denied          — the permission UI completed but nothing was allowed.
 *   - unavailable     — Health Connect is not installed on this phone; the
 *                       sheet offers Get Health Connect (Play Store).
 *   - update_required — Health Connect is installed but needs an update; the
 *                       sheet offers Update Health Connect (Play Store).
 *   - unsupported     — this provider cannot be connected on this device
 *                       (Apple Health on Android or iPad without Health,
 *                       Health Connect on iOS).
 *   - disabled        — this build ships without Health Connect.
 *   - error           — the native permission screen failed to open; the
 *                       sheet offers Try again with a reference.
 *   - stopped         — the Connect attempt ended (sheet closed, unmounted,
 *                       provider changed, sign-out) during setup, so no
 *                       permission screen was opened. Not a failure: the
 *                       caller shows nothing (S-B2, Sol B-317-9).
 */
export type OnDeviceConnectOutcome =
  | 'stopped'
  | 'granted'
  | 'denied'
  | 'unavailable'
  | 'update_required'
  | 'unsupported'
  | 'disabled'
  | 'error';

/**
 * Play Store entry for Health Connect (Android 13 and lower install it from
 * Play; Android 14+ updates it there). The `url=healthconnect://onboarding`
 * parameter is Google's documented onboarding return link.
 */
export const HEALTH_CONNECT_PLAY_STORE_URL =
  'market://details?id=com.google.android.apps.healthdata&url=healthconnect%3A%2F%2Fonboarding';

/** Web fallback when the Play Store app cannot open the market link. */
export const HEALTH_CONNECT_PLAY_WEB_URL =
  'https://play.google.com/store/apps/details?id=com.google.android.apps.healthdata';

/**
 * Health Connect read set. S14: the SAME set the sync service reads
 * (`buildReadPermissions()`); every entry is declared as an
 * `android.permission.health.READ_*` permission in app.json.
 */
const HEALTH_CONNECT_READ_PERMISSIONS = buildReadPermissions() as HealthConnectPermission[];

/**
 * Asked synchronously after every native setup await and immediately before
 * the permission screen opens (Sol B-317-9). Returns false once the attempt
 * that started this call has ended; then no permission screen opens.
 */
export type OnDeviceAttemptCheck = () => boolean;

const ALWAYS_CURRENT: OnDeviceAttemptCheck = () => true;

/** True when the provider is read on the device's native health store. */
const ANDROID_HEALTH_CONNECT_PROVIDERS: ReadonlySet<WearableProvider> =
  new Set<WearableProvider>(['HEALTH_CONNECT', 'SAMSUNG_HEALTH']);

/**
 * Run the Apple HealthKit permission request. Resolves once the system sheet
 * is dismissed. HealthKit deliberately does not disclose per-type grant state
 * to the app, so a clean (error-free) return is treated as `granted` — the
 * authoritative connection status is then re-read server-side after ingest.
 */
async function connectHealthKit(isCurrent: OnDeviceAttemptCheck): Promise<OnDeviceConnectOutcome> {
  // S14: request the SAME read set the sync service reads, through the
  // HealthKit client's single native seam, so the history import never needs a
  // second consent sheet.
  if (!isCurrent()) return 'stopped';
  try {
    await healthKitClient.requestAuth(HEALTHKIT_READ_PERMISSIONS);
    return 'granted';
  } catch (err) {
    // B-360-1: an attempt that ended while the sheet was up reports nothing.
    if (!isCurrent()) return 'stopped';
    // HealthKit never tells an app what was declined, so a failure here is
    // not a refusal. `react-native-health` rejects with "HealthKit data is
    // not available" on devices without Health (some iPads); anything else
    // means the permission screen could not open (S-WEAR-3).
    const message = err instanceof Error ? err.message : String(err);
    return /not available/i.test(message) ? 'unsupported' : 'error';
  }
}

/**
 * Run the Android Health Connect permission request. Checks SDK availability
 * first; when Health Connect is not installed or needs an update it returns
 * `unavailable` or `update_required` and opens nothing on its own (the sheet
 * offers the Play Store on a tap; Opus C-317-7).
 *
 * Sol B-317-9: `isCurrent` is checked after the availability check, after
 * initialization and synchronously right before the permission screen
 * opens, so a Connect attempt that ended during setup opens no new prompt.
 */
async function connectHealthConnect(isCurrent: OnDeviceAttemptCheck): Promise<OnDeviceConnectOutcome> {
  // Never evaluate the Android TurboModule in an OFF build or on iOS.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const hc: typeof import('react-native-health-connect') = require('react-native-health-connect');
  const {
    getSdkStatus,
    initialize: hcInitialize,
    requestPermission: hcRequestPermission,
    SdkAvailabilityStatus,
  } = hc;
  if (!isCurrent()) return 'stopped';
  const status = await getSdkStatus();
  if (!isCurrent()) return 'stopped';
  if (status === SdkAvailabilityStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED) {
    return 'update_required';
  }
  if (status !== SdkAvailabilityStatus.SDK_AVAILABLE) {
    // Not installed (Android 13 and lower). Nothing opens on its own: the
    // sheet explains and offers Get Health Connect.
    return 'unavailable';
  }

  await hcInitialize();
  // No await between this check and the permission screen.
  if (!isCurrent()) return 'stopped';
  const granted = await hcRequestPermission(HEALTH_CONNECT_READ_PERMISSIONS);
  return granted.length > 0 ? 'granted' : 'denied';
}

/**
 * Request on-device health permissions for a provider, driving the real native
 * permission UI for the current platform. Never throws: native errors and
 * off-platform calls resolve to an explicit, renderable outcome.
 *
 * `isCurrent` (Sol B-317-9) is the caller's attempt check: once it returns
 * false no permission screen is opened and the result is `stopped`, also
 * when a setup step failed after the attempt ended.
 */
export async function connectOnDeviceProvider(
  provider: WearableProvider,
  isCurrent: OnDeviceAttemptCheck = ALWAYS_CURRENT,
): Promise<OnDeviceConnectOutcome> {
  if (isHealthConnectProviderDisabled(provider)) return 'disabled';
  try {
    if (provider === 'APPLE_HEALTHKIT') {
      return Platform.OS === 'ios' ? await connectHealthKit(isCurrent) : 'unsupported';
    }
    if (ANDROID_HEALTH_CONNECT_PROVIDERS.has(provider)) {
      return Platform.OS === 'android'
        ? await connectHealthConnect(isCurrent)
        : 'unsupported';
    }
    // Not an on-device provider — caller should have routed to OAuth.
    return 'unsupported';
  } catch {
    // The native permission screen failed to open (not a refusal). The sheet
    // shows Try again with a reference. No token/secret material is involved.
    // An attempt that already ended reports nothing.
    return isCurrent() ? 'error' : 'stopped';
  }
}

/**
 * Open Health Connect's own settings so the person can allow access after a
 * refusal (Android stops showing the permission dialog after two refusals).
 * Resolves false when it could not open (the sheet then says where to go).
 */
export async function openHealthConnectPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android' || isHealthConnectProviderDisabled('HEALTH_CONNECT')) return false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const hc: typeof import('react-native-health-connect') = require('react-native-health-connect');
    hc.openHealthConnectSettings();
    return true;
  } catch {
    return false;
  }
}

/** Open the Health Connect Play Store page (install or update). */
export async function openHealthConnectStore(): Promise<boolean> {
  try {
    await Linking.openURL(HEALTH_CONNECT_PLAY_STORE_URL);
    return true;
  } catch {
    try {
      await Linking.openURL(HEALTH_CONNECT_PLAY_WEB_URL);
      return true;
    } catch {
      return false;
    }
  }
}
