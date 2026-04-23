// Standalone auth helpers that replace the deleted mock-SQLite auth store.
// Kept deliberately tiny: the backend JWT is the source of truth, and these
// helpers only touch AsyncStorage + the authEvents emitter.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { authEvents } from '../utils/authEvents';
import { profileApi } from './api';

// Keys owned by the app. `needs_role_selection` is cleared here because it is
// a per-session flag from the Supabase flow; `onboarding_complete`, `user_data`,
// and `macro_targets` are intentionally left alone unless the caller is wiping
// the whole account — see the security/critical-fixes-round-1 branch for why
// we now keep those across 401s.
const SIGN_OUT_KEYS = [
  'supabase_token',
  'supabase_refresh_token',
  'user_data',
  'needs_role_selection',
  'onboarding_complete',
  'macro_targets',
  'pending_email',
];

export async function signOut(): Promise<void> {
  // Clear all auth + session state and notify the root navigator.
  // We surface failures via console.error instead of Alert because a sign-out
  // button that appears to do nothing is worse than one that logs a warning.
  try {
    await AsyncStorage.multiRemove(SIGN_OUT_KEYS);
  } catch (err) {
    console.error('signOut: multiRemove failed', err);
  }
  authEvents.emit();
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
