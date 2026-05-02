import AsyncStorage from '@react-native-async-storage/async-storage';
import { isScreenshotMode } from './mode';
import { secureStorage } from '../services/secureStorage';
import { DEMO_USER } from './fixtures';

/**
 * Seed AsyncStorage + SecureStore so RootNavigator routes the demo user
 * straight into the client tab navigator.
 *
 * Mirrors what AuthNavigator would write after a successful login:
 *  - secure: supabase_token (any non-empty string passes the auth gate; the
 *    mocked API never validates it)
 *  - async: user_data (full CurrentUser shape, including profile)
 *  - async: onboarding_complete (skips lean onboarding)
 *
 * No-ops when EXPO_PUBLIC_SCREENSHOT_MODE is off.
 */
export async function seedDemoUser(): Promise<void> {
  if (!isScreenshotMode()) return;

  await secureStorage.setItem('supabase_token', 'screenshot-mode-token');
  await AsyncStorage.setItem('user_data', JSON.stringify(DEMO_USER));
  await AsyncStorage.setItem('onboarding_complete', 'true');
  await AsyncStorage.removeItem('needs_role_selection');
}
