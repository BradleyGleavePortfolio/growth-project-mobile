import AsyncStorage from '@react-native-async-storage/async-storage';
import { isScreenshotMode } from './mode';
import { secureStorage } from '../services/secureStorage';
import { DEMO_USER } from './fixtures';

/**
 * Seed AsyncStorage + SecureStore so RootNavigator routes the demo user
 * straight into the client tab navigator.
 *
 * Mirrors what AuthNavigator + OnboardingResults write after a successful
 * login + lean onboarding:
 *  - secure: supabase_token (any non-empty string passes the auth gate; the
 *    mocked API never validates it)
 *  - async: user_data (full CurrentUser shape, including profile)
 *  - async: onboarding_complete (skips lean onboarding)
 *  - async: macro_targets (read by Progress + macro target hooks; without
 *    this, Progress renders 0/0g rings and the goal stat shows '--')
 *
 * No-ops when EXPO_PUBLIC_SCREENSHOT_MODE is off.
 */
export async function seedDemoUser(): Promise<void> {
  if (!isScreenshotMode()) return;

  await secureStorage.setItem('supabase_token', 'screenshot-mode-token');
  await AsyncStorage.setItem('user_data', JSON.stringify(DEMO_USER));
  await AsyncStorage.setItem('onboarding_complete', 'true');
  await AsyncStorage.removeItem('needs_role_selection');

  // ProgressScreen reads `macro_targets` from AsyncStorage rather than from
  // the user profile. Mirror what OnboardingResults writes plus the extras
  // ProgressScreen consumes (goalWeight, height in inches for BMI).
  const profile = DEMO_USER.profile;
  const heightInches = profile?.height_cm
    ? Math.round((profile.height_cm / 2.54) * 10) / 10
    : undefined;
  await AsyncStorage.setItem(
    'macro_targets',
    JSON.stringify({
      calories: profile?.calorie_target ?? 2200,
      protein: profile?.protein_target ?? 165,
      carbs: profile?.carbs_target ?? 230,
      fat: profile?.fat_target ?? 70,
      tdee: profile?.tdee ?? 2580,
      goalWeight: profile?.target_weight ?? 170,
      height: heightInches,
    }),
  );
}
