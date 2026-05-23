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
  // Legacy global macro cache (no user suffix). Per-user macro_targets:<id>
  // keys are wiped via PER_USER_KEY_PREFIXES with the exact signing-out id.
  'macro_targets',
  'pending_email',
  'day_one_completed',
  'lean_onboarding_done',
  'lean_onboarding_intent',
  'lean_onboarding_synced',
  'analytics_onboarding_completed_fired',
  'pending_invite_code',
  // Pre-R15 global active workout session. Upgrading users may still have
  // a payload at this key from before the per-user namespace landed; if it
  // survives signOut, loadActiveWorkoutSession() on the next user will
  // migrate it into their namespace and surface the previous user's
  // working set. See audit #2 / R15.
  '@activeWorkoutSession/v1',
];
// Prefixes whose every matching AsyncStorage key should be wiped on signOut.
// Per-user namespaced data lives behind these prefixes; without enumeration the
// per-user suffixed keys persist across sign-outs and a second user on the
// same device inherits them (R15 / R16).
const ASYNC_SIGN_OUT_PREFIXES = [
  'pending_food_logs_',
  'gp_coach_bio_',
  // Per-user in-progress workout sessions (R15). The active workout
  // persistence layer keys entries as `active_workout_session:<userId>`;
  // sweeping the prefix on signOut prevents a second user on the same
  // device from inheriting the previous user's session and seeing a
  // "Resume?" prompt with someone else's working state.
  'active_workout_session:',
  // Per-user deep-link landing for invite acceptance (R15). The deep-link
  // handler writes `pending_invite_code:<userId>` (or `:anonymous`); the
  // bare `pending_invite_code` legacy key is wiped via ASYNC_SIGN_OUT_KEYS.
  // The trailing colon keeps unrelated keys like `pending_invite_codex_*`
  // from being swept.
  'pending_invite_code:',
];

// Per-user AsyncStorage key prefixes for nutrition/fasting state. R15 requires
// signOut to wipe ONLY the signing-out user's keys; each prefix is concatenated
// with the resolved userId at sweep time to form an EXACT key (no getAllKeys
// scan), so bystander users on a shared device keep their data.
const PER_USER_KEY_PREFIXES = [
  'fasting:scheduled_notification_id:', // FastingScreen — scheduled push id
  'macro_targets:', // useMacroTargets — per-user macro cache
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
export const SIGN_OUT_PREFIXES = PER_USER_KEY_PREFIXES;

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

/**
 * Resolve the signing-out user's id. Falls back to the cached user object
 * (MMKV `auth.user_data`, legacy `user_data` in AsyncStorage) when the caller
 * doesn't pass an explicit id.
 */
async function resolveSigningOutUserId(explicit?: string | null): Promise<string | null> {
  if (explicit) return explicit;
  try {
    const cached = readUserCacheSync();
    if (cached?.id) return cached.id;
  } catch {
    // Fall through to AsyncStorage legacy read.
  }
  try {
    const raw = await AsyncStorage.getItem('user_data');
    if (raw) {
      const parsed = JSON.parse(raw) as { id?: string };
      if (parsed?.id) return parsed.id;
    }
  } catch {
    // Non-fatal: per-user wipe will be skipped if we can't resolve the id.
  }
  return null;
}

export async function signOut(userId?: string | null): Promise<void> {
  // Clear all auth + session state and notify the root navigator.
  // We surface failures via console.error instead of Alert because a sign-out
  // button that appears to do nothing is worse than one that logs a warning.

  // R15: only touch the signing-out user's per-user keys. If we can't resolve
  // a userId, we skip the per-user wipe rather than fall back to a global
  // sweep that would clobber bystander users on a shared device.
  const signingOutUserId = await resolveSigningOutUserId(userId);

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

  // Best-effort: cancel the signing-out user's fasting notification (if any)
  // so a "Fast Complete" push can't fire hours after they log out. Read the
  // id from the exact per-user key (no getAllKeys scan) before the
  // multiRemove below clears it.
  if (signingOutUserId) {
    try {
      const fastingNotifKey = `fasting:scheduled_notification_id:${signingOutUserId}`;
      const storedId = await AsyncStorage.getItem(fastingNotifKey);
      if (storedId) {
        try {
          await Notifications.cancelScheduledNotificationAsync(storedId);
        } catch {
          // Orphan push is annoying, not broken. Don't block sign-out.
        }
      }
    } catch (err) {
      logger.error('AuthActions', 'signOut: cancel fasting notif failed', err);
    }
  }

  const prefixedKeys = await collectPrefixedKeys();
  const perUserKeys = signingOutUserId
    ? PER_USER_KEY_PREFIXES.map((p) => `${p}${signingOutUserId}`)
    : [];

  try {
    await Promise.all([
      ...SECURE_SIGN_OUT_KEYS.map((k) => secureStorage.removeItem(k)),
      AsyncStorage.multiRemove([...ASYNC_SIGN_OUT_KEYS, ...prefixedKeys, ...perUserKeys]),
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
