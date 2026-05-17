// Standalone auth helpers that replace the deleted mock-SQLite auth store.
// Kept deliberately tiny: the backend JWT is the source of truth, and these
// helpers only touch AsyncStorage + the authEvents emitter.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { authEvents } from '../utils/authEvents';
import { profileApi, usersApi } from './api';
import { secureStorage } from './secureStorage';
import { setSentryUser } from './sentry';
import { reset as analyticsReset } from '../lib/analytics';

// Tokens live in SecureStore; everything else is plain AsyncStorage.
const SECURE_SIGN_OUT_KEYS = ['supabase_token', 'supabase_refresh_token'];
const ASYNC_SIGN_OUT_KEYS = [
  'user_data',
  'needs_role_selection',
  'onboarding_complete',
  'macro_targets',
  'pending_email',
];
// Exported for any caller that wants the full list of session keys.
export const SIGN_OUT_KEYS = [...SECURE_SIGN_OUT_KEYS, ...ASYNC_SIGN_OUT_KEYS];

export async function signOut(): Promise<void> {
  // Clear all auth + session state and notify the root navigator.
  // We surface failures via console.error instead of Alert because a sign-out
  // button that appears to do nothing is worse than one that logs a warning.

  // Best-effort: clear the push token on the backend before wiping local auth
  // state so the PATCH /users/me/push-token request can still attach a JWT.
  try {
    await usersApi.updatePushToken(null);
  } catch {
    // Non-fatal: the token will remain on the backend but will be inert once
    // the Expo token expires or the device is re-registered on next login.
  }

  try {
    await Promise.all([
      ...SECURE_SIGN_OUT_KEYS.map((k) => secureStorage.removeItem(k)),
      AsyncStorage.multiRemove(ASYNC_SIGN_OUT_KEYS),
    ]);
  } catch (err) {
    console.error('signOut: clear failed', err);
  }
  // Clear Sentry user binding so post-logout errors aren't tagged with the
  // previous user's id. No-ops when Sentry is not configured.
  setSentryUser(null);
  // Psych Report #4: Reset PostHog anonymous ID on sign-out
  analyticsReset();
  authEvents.emit('logout');
}

// Used by the Settings screen's "Reset Onboarding" action. Previously lived on
// the old authStore as `refreshProfile`; kept as a thin async helper so callers
// can await it.
export async function refreshProfile(): Promise<void> {
  try {
    await profileApi.get();
  } catch (err) {
    // Non-critical: the next screen that reads profile will hit the same endpoint.
    console.error('refreshProfile failed', err);
  }
}
