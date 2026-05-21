// Standalone auth helpers that replace the deleted mock-SQLite auth store.
// Kept deliberately tiny: the backend JWT is the source of truth, and these
// helpers only touch AsyncStorage + the authEvents emitter.

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { authEvents } from '../utils/authEvents';
import { profileApi, usersApi } from './api';
import { secureStorage } from './secureStorage';
import { setSentryUser } from './sentry';
import { reset as analyticsReset } from '../lib/analytics';
import { logger } from '../utils/logger';
import { readUserCacheSync } from '../lib/userCache';
import { clearAllStorage } from '../storage/mmkv';
import { deleteWorkoutLogsForUser } from '../offline/sync/sync-engine';
import { useCoachStore } from '../store/coachStore';
import { useClientStore } from '../store/clientStore';
import { useFastingStore } from '../store/fastingStore';
import { foregroundBannerStore } from '../store/foregroundBannerStore';

// Tokens live in SecureStore; everything else is plain AsyncStorage.
const SECURE_SIGN_OUT_KEYS = ['supabase_token', 'supabase_refresh_token'];
const ASYNC_SIGN_OUT_KEYS = [
  'user_data',
  'needs_role_selection',
  'onboarding_complete',
  'macro_targets',
  'pending_email',
  'day_one_completed',
  'lean_onboarding_done',
  'lean_onboarding_intent',
  'lean_onboarding_synced',
  'analytics_onboarding_completed_fired',
  'pending_invite_code',
];

// Prefixes whose every matching AsyncStorage key should be wiped on signOut.
// Per-user namespaced data lives behind these prefixes; without enumeration the
// per-user suffixed keys persist across sign-outs and a second user on the
// same device inherits them (R15 / R16).
const ASYNC_SIGN_OUT_PREFIXES = [
  'pending_food_logs_',
  'gp_coach_bio_',
];

// Belt-and-braces wipe for the cacheStorage MMKV namespace. clearAllStorage()
// (called below) already drops the entire cache namespace at runtime, but in
// the Expo Go / Jest AsyncStorage shim the cache lives behind `cache:` keys in
// the same AsyncStorage backing store — enumerating those keys here ensures
// any `messages_thread_*` (Hunt #2 P0-1) or stray `pending_*` cache rows are
// gone even if clearNamespace partial-fails or a refactor changes the surface.
// Hunt #2 specifically calls out the messages thread surface as R15 + R16.
const CACHE_SHIM_PREFIX = 'cache:';
const CACHE_SIGN_OUT_SUBPREFIXES = [
  'messages_thread_',
  'pending_',
];

// Exported for any caller that wants the full list of session keys (does not
// include the prefix-matched keys, which are enumerated at signOut time).
export const SIGN_OUT_KEYS = [...SECURE_SIGN_OUT_KEYS, ...ASYNC_SIGN_OUT_KEYS];

async function collectPrefixedKeys(): Promise<string[]> {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    return allKeys.filter((k) => {
      if (ASYNC_SIGN_OUT_PREFIXES.some((prefix) => k.startsWith(prefix))) {
        return true;
      }
      // Also pick up cache-namespaced keys the shim writes; on MMKV native
      // they live in a separate store and are cleared by clearAllStorage().
      if (k.startsWith(CACHE_SHIM_PREFIX)) {
        const rest = k.slice(CACHE_SHIM_PREFIX.length);
        return CACHE_SIGN_OUT_SUBPREFIXES.some((p) => rest.startsWith(p));
      }
      return false;
    });
  } catch (err) {
    logger.warn('AuthActions', 'collectPrefixedKeys failed', err);
    return [];
  }
}

export async function signOut(): Promise<void> {
  // Clear all auth + session state and notify the root navigator.
  // We surface failures via console.error instead of Alert because a sign-out
  // button that appears to do nothing is worse than one that logs a warning.

  // Capture the signing-out user BEFORE we wipe state so we can scope the
  // offline workout-log delete to just their rows.
  const signingOutUserId = readUserCacheSync()?.id;

  // Best-effort: clear the push token on the backend before wiping local auth
  // state so the PATCH /users/me/push-token request can still attach a JWT.
  try {
    await usersApi.updatePushToken(null);
  } catch {
    // Non-fatal: the token will remain on the backend but will be inert once
    // the Expo token expires or the device is re-registered on next login.
  }

  // Best-effort: unregister this device's push registration so notifications
  // queued for the signing-out user can't deliver to a subsequent signed-in
  // user on the same hardware. Idempotent if already unregistered.
  try {
    await Notifications.unregisterForNotificationsAsync();
  } catch {
    // Non-fatal — see comment above.
  }

  // Drop the signing-out user's offline workout rows (keeps other users'
  // rows intact for the shared-device account-switching scenario).
  if (signingOutUserId) {
    try {
      await deleteWorkoutLogsForUser(signingOutUserId);
    } catch (err) {
      logger.warn('AuthActions', 'deleteWorkoutLogsForUser failed', err);
    }
  }

  const prefixedKeys = await collectPrefixedKeys();

  try {
    await Promise.all([
      ...SECURE_SIGN_OUT_KEYS.map((k) => secureStorage.removeItem(k)),
      AsyncStorage.multiRemove([...ASYNC_SIGN_OUT_KEYS, ...prefixedKeys]),
      clearAllStorage(),
    ]);
  } catch (err) {
    logger.error('AuthActions', 'signOut: clear failed', err);
  }
  // Clear Sentry user binding so post-logout errors aren't tagged with the
  // previous user's id. No-ops when Sentry is not configured.
  setSentryUser(null);
  // Psych Report #4: Reset PostHog anonymous ID on sign-out
  analyticsReset();

  // Hunter #2 P1-7 (R15): wipe every zustand store that carries user-scoped
  // state. AsyncStorage + MMKV are wiped above, but the zustand stores live
  // in module memory and survive the navigator teardown, so without an
  // explicit reset the next user on the same device sees the previous
  // user's clients/foodLogs/active fast/notification banner flash through
  // before the post-login fetches complete.
  resetUserScopedStores();

  authEvents.emit('logout');
}

// Exported so the next-user sign-in path (or tests) can re-assert a clean
// slate without duplicating the store list. Order is intentional: pure
// in-memory `set()` calls; no awaits, no I/O.
// Each reset() is isolated in its own try/catch so a throw from one store
// (e.g. a bad slice or test stub) does not short-circuit the remaining
// resets and leak the previous user's state across signOut.
export function resetUserScopedStores(): void {
  const stores: Array<readonly [string, () => void]> = [
    ['coachStore', () => useCoachStore.getState().reset()],
    ['clientStore', () => useClientStore.getState().reset()],
    ['fastingStore', () => useFastingStore.getState().reset()],
    ['foregroundBannerStore', () => foregroundBannerStore.getState().reset()],
  ];
  for (const [name, reset] of stores) {
    try {
      reset();
    } catch (err) {
      logger.warn('AuthActions', `resetUserScopedStores: ${name} reset failed`, err);
    }
  }
}

// Used by the Settings screen's "Reset Onboarding" action. Previously lived on
// the old authStore as `refreshProfile`; kept as a thin async helper so callers
// can await it.
export async function refreshProfile(): Promise<void> {
  try {
    await profileApi.get();
  } catch (err) {
    // Non-critical: the next screen that reads profile will hit the same endpoint.
    logger.error('AuthActions', 'refreshProfile failed', err);
  }
}
