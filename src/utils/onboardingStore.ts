/**
 * Onboarding data store — uses AsyncStorage instead of SQLite.
 * Replaces the old profileDb/useAuthStore dependency for onboarding steps.
 * All answers are accumulated here and saved to the backend on completion.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'onboarding_data';

export type OnboardingData = {
  firstName?: string;
  lastName?: string;
  sex?: 'male' | 'female';
  dob?: string;
  currentWeight?: number;
  targetWeight?: number;
  height?: number;
  // 5-bucket TDEE multiplier enum: sedentary | light | moderate | active | very_active.
  // The lean flow MUST NOT write to this — it has no signal for activity level.
  // It defaults to 'moderate' until EditProfile captures a real answer.
  activityLevel?: string;
  primaryGoal?: string;
  eatHabits?: string;
  dietType?: string;
  foodPrefs?: string[];
  restrictions?: string[];
  mealsPerDay?: number;
  timeline?: number;
  gymMembership?: string;
  fitnessLevel?: string;
  preferredSnacks?: string[];
  // Lean Q3 — "today's intent" (workout | track_meals | explore). NOT TDEE
  // activity level. Used only to tailor the first-screen surface; not sent
  // to the backend as activity_level.
  intent?: string;
};

export async function getOnboardingData(): Promise<OnboardingData> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export async function saveOnboardingData(updates: Partial<OnboardingData>): Promise<void> {
  try {
    const existing = await getOnboardingData();
    await AsyncStorage.setItem(KEY, JSON.stringify({ ...existing, ...updates }));
  } catch (err) {
    // Write-side failure: the next onboarding step will retry. We don't alert
    // here because it would interrupt the flow for every step; onboarding
    // results screen will surface a final "couldn't save" alert instead.
    console.error('onboardingStore: saveOnboardingData failed', err);
  }
}

export async function clearOnboardingData(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
}
