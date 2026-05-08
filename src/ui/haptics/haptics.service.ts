/**
 * HapticService — Phase 11 / Track 3
 *
 * Typed singleton wrapping expo-haptics. All methods no-op when
 * HAPTICS_ENABLED is false (read from useSettings / AsyncStorage at startup).
 *
 * Usage:
 *   import { HapticService } from '../ui/haptics/haptics.service';
 *   HapticService.selection();
 *   HapticService.mediumImpact();
 *   HapticService.success();
 */

import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Settings key (mirrors useSettings SETTINGS_KEY) ─────────────────────────
const SETTINGS_KEY = 'gp_client_settings';

// ─── Internal state ───────────────────────────────────────────────────────────

/** Whether haptics are currently enabled. Defaults to true until persisted value loads. */
let _enabled = true;

// Bootstrap: read persisted preference immediately so the service is ready by
// the time the first interaction fires. Re-reads on every app foreground via
// the exported refreshEnabled() call (wired in App.tsx via AppState).
(async () => {
  await refreshEnabled();
})();

/**
 * Re-read the persisted haptics preference from AsyncStorage.
 * Call this after the user toggles the setting so in-flight calls pick it up.
 */
export async function refreshEnabled(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed: { hapticsEnabled?: boolean } = JSON.parse(raw);
      _enabled = parsed.hapticsEnabled !== false; // default true when key absent
    }
  } catch {
    // Leave _enabled as-is on parse failure
  }
}

/**
 * Programmatically override the enabled flag (used by useSettings after a
 * toggle so the service is synchronously up to date without waiting for the
 * next AsyncStorage read cycle).
 */
export function setHapticsEnabled(enabled: boolean): void {
  _enabled = enabled;
}

// ─── Safe haptic wrapper ──────────────────────────────────────────────────────

async function safe(fn: () => Promise<void>): Promise<void> {
  if (!_enabled) return;
  try {
    await fn();
  } catch {
    // Silently ignore: web / unsupported hardware / background state
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Typed singleton haptic service.
 *
 * - selection:    Light selection tick (tab switches, chip selects)
 * - softImpact:   Light impact (subtle button presses)
 * - mediumImpact: Medium impact (primary CTA presses)
 * - heavyImpact:  Heavy impact (workout completion, milestone achievement)
 * - success:      Notification success (form submitted, data saved)
 * - warning:      Notification warning (validation errors, destructive confirms)
 * - error:        Notification error (failed API actions, network errors)
 */
export const HapticService = {
  selection:    (): Promise<void> => safe(() => Haptics.selectionAsync()),
  softImpact:   (): Promise<void> => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  mediumImpact: (): Promise<void> => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  heavyImpact:  (): Promise<void> => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)),
  success:      (): Promise<void> => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warning:      (): Promise<void> => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  error:        (): Promise<void> => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
} as const;

export type HapticServiceType = typeof HapticService;
