import AsyncStorage from '@react-native-async-storage/async-storage';
import { isScreenshotMode } from './mode';
import { secureStorage } from '../services/secureStorage';
import { DEMO_USER, DEMO_WORKOUT_PARAMS } from './fixtures';
import { setUserCache } from '../lib/userCache';
import { saveTutorial } from '../tutorial/tutorialStorage';
import { TUTORIAL_STEPS } from '../tutorial/tutorialSteps';
import { clearActiveWorkoutSession, saveActiveWorkoutSession } from '../storage/activeWorkoutSession';
import { routineSessionExercises } from '../utils/workout/workoutLogging';

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
export async function seedDemoUser(audience: 'client' | 'coach' = 'client'): Promise<void> {
  if (!isScreenshotMode()) return;

  await secureStorage.setItem('supabase_token', 'screenshot-mode-token');
  await AsyncStorage.setItem('user_data', JSON.stringify(DEMO_USER));
  await setUserCache(audience === 'coach'
    ? { ...DEMO_USER, id: DEMO_USER.coach_id!, name: 'Sam Carter', firstName: 'Sam', role: 'coach' }
    : DEMO_USER);
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
    `macro_targets:${DEMO_USER.id}`,
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

  // A finished tour plus the onboarding payload the backend returns
  // (coach id + display name), so Home names the coach as it does live.
  if (audience === 'client') {
    await clearActiveWorkoutSession(DEMO_USER.id); // only the workout frame has one
    const done = '2026-04-15T09:30:00Z';
    await saveTutorial(DEMO_USER.id, {
      state: { version: 3, status: 'completed', stepIndex: TUTORIAL_STEPS.length - 1, gateIndex: 0,
        outcomes: {}, startedAt: done, completedAt: done, updatedAt: done },
      payload: {
        macros: { calories: 2200, protein_g: 165, carbs_g: 230, fat_g: 70 },
        program: null, spaces: [], coach: { id: DEMO_USER.coach_id!, display_name: 'Sam Carter' },
      },
    });
  }
}

/** The workout frame opens mid-session: two Bench press sets ticked, 14:32 in. */
export async function seedDemoWorkout(): Promise<void> {
  if (!isScreenshotMode()) return;
  const sessionExercises = routineSessionExercises(DEMO_WORKOUT_PARAMS.exercises);
  sessionExercises[0].sets.slice(0, 2).forEach((set) => { set.completed = true; });
  await saveActiveWorkoutSession(DEMO_USER.id, {
    startedAtMs: Date.now() - (14 * 60 + 32) * 1000,
    routineName: DEMO_WORKOUT_PARAMS.routineName,
    exercisesJson: DEMO_WORKOUT_PARAMS.exercises,
    idempotencyKey: '',
    sessionExercises,
  });
}
