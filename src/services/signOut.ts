// Central sign-out helper.
//
// Security: Zustand stores were not being reset on logout, leaking the
// previous user's cached data (clients, client day data, fasting history)
// into the next login on the same device. This helper is the single place
// that clears tokens, clears AsyncStorage keys, and resets every in-memory
// store before emitting the logout event.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { secureStorage } from './secureStorage';
import { authEvents } from '../utils/authEvents';
import { useClientStore } from '../store/clientStore';
import { useCoachStore } from '../store/coachStore';
import { useFastingStore } from '../store/fastingStore';
import { useAuthStore } from '../store/authStore';

const LEGACY_AUTH_KEYS = [
  'gp_auth_token',
  'gp_auth_user',
  'user_data',
  'needs_role_selection',
  'onboarding_complete',
  'macro_targets',
  'pending_email',
];

export async function signOut(): Promise<void> {
  // Clear secure tokens first so a stray request mid-logout can't re-auth.
  await secureStorage.removeItem('supabase_token');
  await secureStorage.removeItem('supabase_refresh_token');

  // Clear remaining non-secret auth state in AsyncStorage.
  await AsyncStorage.multiRemove(LEGACY_AUTH_KEYS);

  // Reset every Zustand store so the next user doesn't see the previous
  // user's cached data on first render.
  useClientStore.getState().reset();
  useCoachStore.getState().reset();
  useFastingStore.getState().reset();
  useAuthStore.getState().reset();

  // Tell RootNavigator to re-evaluate auth state.
  authEvents.emit('logout');
}
