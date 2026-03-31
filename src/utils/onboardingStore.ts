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
    console.error('saveOnboardingData error:', err);
  }
}

export async function clearOnboardingData(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
}
